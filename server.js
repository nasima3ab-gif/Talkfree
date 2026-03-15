const express = require("express");
const http = require("http");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "http://localhost:5500,http://127.0.0.1:5500,http://localhost:3000";
const allowedOrigins = FRONTEND_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3000;

app.use(express.static(__dirname));
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "talkfree-socket-server" });
});

const users = new Map(); // username -> { username, passwordHash, online, sockets:Set<string> }
const sessions = new Map(); // token -> username
const groups = new Map(); // groupId -> { id, name, members:Set<string> }
const messages = new Map(); // chatKey -> [{ from, text, ts }]
const typingState = new Map(); // chatKey -> Set<username>
const rateState = new Map(); // socket.id -> { count, ts }
const calls = new Map(); // sessionId -> { id, caller, callee, accepted }
const activeCallByUser = new Map(); // username -> sessionId

function sanitizeUsername(input) {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) return null;
  return name;
}

function validPassword(input) {
  return typeof input === "string" && input.length >= 4 && input.length <= 100;
}

function issueToken() {
  return crypto.randomBytes(24).toString("hex");
}

function publicUsers() {
  return Array.from(users.values()).map((u) => ({
    username: u.username,
    online: u.online,
  }));
}

function emitToUser(username, event, payload) {
  const user = users.get(username);
  if (!user) return;
  for (const sid of user.sockets) {
    io.to(sid).emit(event, payload);
  }
}

function cleanupCall(sessionId) {
  const session = calls.get(sessionId);
  if (!session) return;
  calls.delete(sessionId);
  activeCallByUser.delete(session.caller);
  activeCallByUser.delete(session.callee);
}

function groupsForUser(username) {
  return Array.from(groups.values()).map((g) => ({
    id: g.id,
    name: g.name,
    joined: g.members.has(username),
    members: Array.from(g.members),
  }));
}

function privateKey(a, b) {
  return [a, b].sort().join("::");
}

function groupKey(groupId) {
  return `group::${groupId}`;
}

function readMessages(key) {
  return messages.get(key) || [];
}

function addMessage(key, from, text) {
  const clean = String(text || "").trim().slice(0, 2000);
  if (!clean) return;
  const entry = { from, text: clean, ts: Date.now() };
  const arr = readMessages(key);
  arr.push(entry);
  if (arr.length > 200) arr.shift();
  messages.set(key, arr);
}

function getUsernameByToken(token) {
  return sessions.get(token);
}

function authorize(token) {
  const username = getUsernameByToken(token);
  if (!username) return null;
  const user = users.get(username);
  if (!user) return null;
  return user;
}

function canAccessChat(username, chat) {
  if (!chat || !chat.type || !chat.target) return { ok: false };

  if (chat.type === "private") {
    if (!users.has(chat.target)) return { ok: false };
    return { ok: true, key: privateKey(username, chat.target), recipients: [username, chat.target] };
  }

  if (chat.type === "group") {
    const group = groups.get(chat.target);
    if (!group) return { ok: false };
    if (!group.members.has(username)) return { ok: false };
    return { ok: true, key: groupKey(group.id), recipients: Array.from(group.members) };
  }

  return { ok: false };
}

function publishUsers() {
  io.emit("users:update", publicUsers());
}

function emitGroupsForUser(username) {
  const user = users.get(username);
  if (!user) return;
  const payload = groupsForUser(username);
  for (const sid of user.sockets) {
    io.to(sid).emit("groups:update", payload);
  }
}

function emitGroupsForAll() {
  for (const username of users.keys()) {
    emitGroupsForUser(username);
  }
}

function emitTyping(chat, chatKey) {
  const who = Array.from(typingState.get(chatKey) || []);
  io.emit("typing:update", { chat, users: who });
}

function consumeRate(socketId) {
  const now = Date.now();
  const slot = rateState.get(socketId) || { count: 0, ts: now };
  if (now - slot.ts > 1000) {
    slot.count = 0;
    slot.ts = now;
  }
  slot.count += 1;
  rateState.set(socketId, slot);
  return slot.count <= 15;
}

io.on("connection", (socket) => {
  socket.on("auth:register", async ({ username, password }) => {
    const cleanUser = sanitizeUsername(username);
    if (!cleanUser || !validPassword(password)) {
      socket.emit("auth:error", { message: "Invalid username/password format." });
      return;
    }
    if (users.has(cleanUser)) {
      socket.emit("auth:error", { message: "Username already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    users.set(cleanUser, {
      username: cleanUser,
      passwordHash,
      online: false,
      sockets: new Set(),
    });

    socket.emit("auth:notice", { message: "Registration successful. Please login." });
  });

  socket.on("auth:login", async ({ username, password }) => {
    const cleanUser = sanitizeUsername(username);
    const user = cleanUser ? users.get(cleanUser) : null;
    if (!user) {
      socket.emit("auth:error", { message: "User not found." });
      return;
    }

    const ok = await bcrypt.compare(password || "", user.passwordHash);
    if (!ok) {
      socket.emit("auth:error", { message: "Wrong password." });
      return;
    }

    const token = issueToken();
    sessions.set(token, cleanUser);

    user.online = true;
    user.sockets.add(socket.id);

    socket.data.username = cleanUser;
    socket.data.token = token;

    socket.emit("auth:ok", {
      token,
      username: cleanUser,
      users: publicUsers(),
      groups: groupsForUser(cleanUser),
    });

    publishUsers();
  });

  socket.on("group:create", ({ token, name }) => {
    const user = authorize(token);
    if (!user) return;

    const clean = String(name || "").trim().slice(0, 30);
    if (!clean) return;

    const id = crypto.randomUUID();
    groups.set(id, {
      id,
      name: clean,
      members: new Set([user.username]),
    });

    emitGroupsForAll();
  });

  socket.on("group:join", ({ token, groupId }) => {
    const user = authorize(token);
    if (!user) return;

    const group = groups.get(groupId);
    if (!group) {
      socket.emit("system:error", { message: "Group not found." });
      return;
    }

    group.members.add(user.username);
    emitGroupsForAll();
  });

  socket.on("messages:get", ({ token, chat }) => {
    const user = authorize(token);
    if (!user) return;

    const access = canAccessChat(user.username, chat);
    if (!access.ok) {
      socket.emit("system:error", { message: "Unauthorized chat access." });
      return;
    }

    socket.emit("messages:data", readMessages(access.key));
  });

  socket.on("message:send", ({ token, chat, text }) => {
    if (!consumeRate(socket.id)) {
      socket.emit("system:error", { message: "Rate limit exceeded. Slow down." });
      return;
    }

    const user = authorize(token);
    if (!user) return;

    const access = canAccessChat(user.username, chat);
    if (!access.ok) {
      socket.emit("system:error", { message: "Unauthorized chat access." });
      return;
    }

    addMessage(access.key, user.username, text);
    const payload = readMessages(access.key);

    for (const recipient of access.recipients) {
      const target = users.get(recipient);
      if (!target) continue;
      for (const sid of target.sockets) {
        io.to(sid).emit("messages:data", payload);
      }
    }
  });

  socket.on("typing:start", ({ token, chat }) => {
    const user = authorize(token);
    if (!user) return;

    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;

    const set = typingState.get(access.key) || new Set();
    set.add(user.username);
    typingState.set(access.key, set);
    emitTyping(chat, access.key);
  });

  socket.on("typing:stop", ({ token, chat }) => {
    const user = authorize(token);
    if (!user) return;

    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;

    const set = typingState.get(access.key);
    if (!set) return;
    set.delete(user.username);
    if (!set.size) typingState.delete(access.key);
    emitTyping(chat, access.key);
  });

  socket.on("call:request", ({ token, target }) => {
    const user = authorize(token);
    if (!user) return;

    const cleanTarget = sanitizeUsername(target);
    if (!cleanTarget || !users.has(cleanTarget)) {
      socket.emit("call:error", { message: "User not found." });
      return;
    }
    if (cleanTarget === user.username) {
      socket.emit("call:error", { message: "Cannot call yourself." });
      return;
    }
    if (activeCallByUser.has(user.username) || activeCallByUser.has(cleanTarget)) {
      socket.emit("call:error", { message: "User is busy." });
      return;
    }

    const targetUser = users.get(cleanTarget);
    if (!targetUser || !targetUser.online) {
      socket.emit("call:error", { message: "User is offline." });
      return;
    }

    const sessionId = crypto.randomUUID();
    calls.set(sessionId, {
      id: sessionId,
      caller: user.username,
      callee: cleanTarget,
      accepted: false,
    });
    activeCallByUser.set(user.username, sessionId);
    activeCallByUser.set(cleanTarget, sessionId);

    emitToUser(cleanTarget, "call:incoming", { sessionId, from: user.username });
    emitToUser(user.username, "call:ringing", { sessionId, to: cleanTarget });
  });

  socket.on("call:cancel", ({ token, sessionId }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.caller !== user.username) return;

    emitToUser(session.callee, "call:canceled", { sessionId, from: user.username });
    cleanupCall(sessionId);
  });

  socket.on("call:reject", ({ token, sessionId }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.callee !== user.username) return;

    emitToUser(session.caller, "call:rejected", { sessionId, from: user.username });
    cleanupCall(sessionId);
  });

  socket.on("call:accept", ({ token, sessionId }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.callee !== user.username) return;

    session.accepted = true;
    emitToUser(session.caller, "call:accepted", { sessionId, from: user.username });
  });

  socket.on("call:offer", ({ token, sessionId, offer }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.caller !== user.username) return;

    emitToUser(session.callee, "call:offer", { sessionId, from: user.username, offer });
  });

  socket.on("call:answer", ({ token, sessionId, answer }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.callee !== user.username) return;

    emitToUser(session.caller, "call:answer", { sessionId, from: user.username, answer });
  });

  socket.on("call:ice", ({ token, sessionId, candidate }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session) return;

    if (session.caller !== user.username && session.callee !== user.username) return;
    const target = session.caller === user.username ? session.callee : session.caller;
    emitToUser(target, "call:ice", { sessionId, candidate });
  });

  socket.on("call:end", ({ token, sessionId }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session) return;
    if (session.caller !== user.username && session.callee !== user.username) return;

    const target = session.caller === user.username ? session.callee : session.caller;
    emitToUser(target, "call:ended", { sessionId, reason: "peer-ended" });
    cleanupCall(sessionId);
  });

  socket.on("disconnect", () => {
    rateState.delete(socket.id);

    const username = socket.data.username;
    if (!username) return;

    const user = users.get(username);
    if (!user) return;

    user.sockets.delete(socket.id);
    if (!user.sockets.size) {
      user.online = false;
      publishUsers();
      const sessionId = activeCallByUser.get(username);
      if (sessionId) {
        const session = calls.get(sessionId);
        if (session) {
          const target = session.caller === username ? session.callee : session.caller;
          emitToUser(target, "call:ended", { sessionId, reason: "peer-disconnected" });
        }
        cleanupCall(sessionId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Talkfree socket server running on http://localhost:${PORT}`);
});
