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
const profiles = new Map(); // username -> { status, bio, avatar, color }
const pins = new Map(); // chatKey -> Set<messageId>
const bookmarks = new Map(); // username -> Set<messageKey>
const callHistory = new Map(); // username -> [{ with, direction, status, startedAt, endedAt }]
const slowModeState = new Map(); // key: groupId::username -> { ts }
const stats = {
  users: 0,
  groups: 0,
  messages: 0,
  files: 0,
  calls: 0,
};

function sanitizeUsername(input) {
  if (typeof input !== "string") return null;
  const name = input.trim();
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) return null;
  return name;
}

function validPassword(input) {
  return typeof input === "string" && input.length >= 4 && input.length <= 100;
}

function sanitizeProfileText(input, maxLen) {
  if (typeof input !== "string") return "";
  return input.trim().slice(0, maxLen);
}

function colorFromName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function ensureProfile(username) {
  if (profiles.has(username)) return profiles.get(username);
  const profile = {
    status: "Available",
    bio: "",
    avatar: "",
    color: colorFromName(username),
  };
  profiles.set(username, profile);
  return profile;
}

function roleRank(role) {
  if (role === "owner") return 3;
  if (role === "admin") return 2;
  if (role === "mod") return 1;
  return 0;
}

function getRole(group, username) {
  return group.roles.get(username) || "member";
}

function canModerate(group, username) {
  return roleRank(getRole(group, username)) >= 1;
}

function canAdmin(group, username) {
  return roleRank(getRole(group, username)) >= 2;
}

function isOwner(group, username) {
  return roleRank(getRole(group, username)) >= 3;
}

function issueToken() {
  return crypto.randomBytes(24).toString("hex");
}

function publicUsers() {
  return Array.from(users.values()).map((u) => ({
    username: u.username,
    online: u.online,
    profile: ensureProfile(u.username),
  }));
}

function emitToUser(username, event, payload) {
  const user = users.get(username);
  if (!user) return;
  for (const sid of user.sockets) {
    io.to(sid).emit(event, payload);
  }
}

function emitStats() {
  stats.online = Array.from(users.values()).filter((u) => u.online).length;
  io.emit("stats:update", stats);
}

function addCallHistory(username, record) {
  const list = callHistory.get(username) || [];
  list.unshift(record);
  if (list.length > 50) list.pop();
  callHistory.set(username, list);
}

function emitCallHistory(username) {
  emitToUser(username, "call:history", callHistory.get(username) || []);
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
    memberCount: g.members.size,
    onlineCount: Array.from(g.members).filter((m) => users.get(m)?.online).length,
    role: g.members.has(username) ? getRole(g, username) : "member",
    canModerate: g.members.has(username) ? canModerate(g, username) : false,
    canAdmin: g.members.has(username) ? canAdmin(g, username) : false,
    slowModeSeconds: g.slowModeSeconds || 0,
    mutedUntil: g.mutes.get(username) || 0,
    roles: g.members.has(username) && canModerate(g, username) ? Object.fromEntries(g.roles) : {},
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

function sanitizeFile(file) {
  if (!file || typeof file !== "object") return null;
  const name = String(file.name || "").trim().slice(0, 80);
  const type = String(file.type || "").trim().slice(0, 80);
  const size = Number(file.size || 0);
  const dataUrl = String(file.dataUrl || "");
  if (!name || !dataUrl.startsWith("data:")) return null;
  if (!Number.isFinite(size) || size <= 0 || size > 2 * 1024 * 1024) return null;
  if (dataUrl.length > 3 * 1024 * 1024) return null;
  return { name, type, size, dataUrl };
}

function addMessage(key, from, text, file) {
  const clean = String(text || "").trim().slice(0, 2000);
  const safeFile = sanitizeFile(file);
  if (!clean && !safeFile) return null;
  const entry = {
    id: crypto.randomUUID(),
    from,
    text: clean,
    ts: Date.now(),
    editedAt: 0,
    deleted: false,
    file: safeFile,
    reactions: {},
    reads: [from],
  };
  const arr = readMessages(key);
  arr.push(entry);
  if (arr.length > 300) arr.shift();
  messages.set(key, arr);
  if (safeFile) stats.files += 1;
  stats.messages += 1;
  return entry;
}

function serializeMessage(msg) {
  return {
    ...msg,
    reactions: Object.fromEntries(
      Object.entries(msg.reactions || {}).map(([emoji, usersArr]) => [emoji, Array.from(new Set(usersArr))])
    ),
    reads: Array.from(new Set(msg.reads || [])),
  };
}

function serializeMessages(key) {
  return readMessages(key).map(serializeMessage);
}

function findMessage(key, messageId) {
  const arr = readMessages(key);
  return arr.find((m) => m.id === messageId) || null;
}

function markRead(key, username) {
  const arr = readMessages(key);
  let changed = false;
  for (const msg of arr) {
    if (!msg.reads.includes(username)) {
      msg.reads.push(username);
      changed = true;
    }
  }
  return changed;
}

function toggleReaction(key, messageId, emoji, username) {
  const msg = findMessage(key, messageId);
  if (!msg || msg.deleted) return false;
  const cleanEmoji = String(emoji || "").trim().slice(0, 10);
  if (!cleanEmoji) return false;
  const list = msg.reactions[cleanEmoji] || [];
  if (list.includes(username)) {
    msg.reactions[cleanEmoji] = list.filter((u) => u !== username);
    if (!msg.reactions[cleanEmoji].length) delete msg.reactions[cleanEmoji];
  } else {
    list.push(username);
    msg.reactions[cleanEmoji] = list;
  }
  return true;
}

function togglePin(key, messageId) {
  const set = pins.get(key) || new Set();
  if (set.has(messageId)) {
    set.delete(messageId);
  } else {
    set.add(messageId);
  }
  pins.set(key, set);
  return Array.from(set);
}

function toggleBookmark(username, key, messageId) {
  const set = bookmarks.get(username) || new Set();
  const token = `${key}::${messageId}`;
  if (set.has(token)) {
    set.delete(token);
  } else {
    set.add(token);
  }
  bookmarks.set(username, set);
  return Array.from(set);
}

function getBookmarks(username) {
  return Array.from(bookmarks.get(username) || new Set());
}

function getPins(key) {
  return Array.from(pins.get(key) || new Set());
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
  emitStats();
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
  if (chat.type === "private") {
    const parts = chatKey.split("::");
    parts.forEach((recipient) => {
      const other = parts.find((p) => p !== recipient);
      emitToUser(recipient, "typing:update", { chat: { type: "private", target: other }, users: who });
    });
    return;
  }
  io.emit("typing:update", { chat, users: who });
}

function emitChatUpdate(chat, access, opts = {}) {
  const payload = serializeMessages(access.key);
  for (const recipient of access.recipients) {
    const target = users.get(recipient);
    if (!target) continue;
    let chatPayload = chat;
    if (chat.type === "private") {
      const other = access.recipients.find((r) => r !== recipient);
      chatPayload = { type: "private", target: other, label: `@${other}` };
    }
    const envelope = {
      chat: chatPayload,
      messages: payload,
      pins: getPins(access.key),
      bookmarks: getBookmarks(recipient),
      silent: Boolean(opts.silent),
    };
    for (const sid of target.sockets) {
      io.to(sid).emit("messages:data", envelope);
    }
  }
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
    ensureProfile(cleanUser);
    stats.users += 1;
    emitStats();

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
      profile: ensureProfile(cleanUser),
      bookmarks: getBookmarks(cleanUser),
      stats,
    });

    publishUsers();
    emitCallHistory(cleanUser);
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
      roles: new Map([[user.username, "owner"]]),
      bans: new Set(),
      mutes: new Map(),
      slowModeSeconds: 0,
      invites: new Set(),
    });
    stats.groups += 1;
    emitStats();

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
    if (group.bans.has(user.username)) {
      socket.emit("system:error", { message: "You are banned from this group." });
      return;
    }

    group.members.add(user.username);
    if (!group.roles.has(user.username)) {
      group.roles.set(user.username, "member");
    }
    emitGroupsForAll();
  });

  socket.on("group:invite", ({ token, groupId }) => {
    const user = authorize(token);
    if (!user) return;

    const group = groups.get(groupId);
    if (!group) return;
    if (!canModerate(group, user.username)) {
      socket.emit("system:error", { message: "Not allowed to create invites." });
      return;
    }

    const code = crypto.randomUUID().slice(0, 8);
    group.invites.add(code);
    socket.emit("group:invite", { groupId, code });
  });

  socket.on("group:joinInvite", ({ token, code }) => {
    const user = authorize(token);
    if (!user) return;
    const cleanCode = String(code || "").trim().slice(0, 20);
    if (!cleanCode) return;

    const group = Array.from(groups.values()).find((g) => g.invites.has(cleanCode));
    if (!group) {
      socket.emit("system:error", { message: "Invite code not found." });
      return;
    }
    if (group.bans.has(user.username)) {
      socket.emit("system:error", { message: "You are banned from this group." });
      return;
    }
    group.members.add(user.username);
    if (!group.roles.has(user.username)) {
      group.roles.set(user.username, "member");
    }
    emitGroupsForAll();
  });

  socket.on("group:role", ({ token, groupId, target, role }) => {
    const user = authorize(token);
    if (!user) return;
    const group = groups.get(groupId);
    if (!group) return;
    if (!isOwner(group, user.username)) {
      socket.emit("system:error", { message: "Only the owner can change roles." });
      return;
    }
    const cleanTarget = sanitizeUsername(target);
    const cleanRole = String(role || "").trim();
    if (!cleanTarget || !group.members.has(cleanTarget)) return;
    if (!["owner", "admin", "mod", "member"].includes(cleanRole)) return;

    group.roles.set(cleanTarget, cleanRole);
    emitGroupsForAll();
  });

  socket.on("group:mute", ({ token, groupId, target, seconds }) => {
    const user = authorize(token);
    if (!user) return;
    const group = groups.get(groupId);
    if (!group) return;
    if (!canModerate(group, user.username)) {
      socket.emit("system:error", { message: "Not allowed to mute." });
      return;
    }
    const cleanTarget = sanitizeUsername(target);
    if (!cleanTarget || !group.members.has(cleanTarget)) return;
    const duration = Math.max(0, Math.min(Number(seconds || 0), 24 * 3600));
    const until = duration ? Date.now() + duration * 1000 : Date.now() + 10 * 60 * 1000;
    group.mutes.set(cleanTarget, until);
    emitGroupsForAll();
  });

  socket.on("group:unmute", ({ token, groupId, target }) => {
    const user = authorize(token);
    if (!user) return;
    const group = groups.get(groupId);
    if (!group) return;
    if (!canModerate(group, user.username)) return;
    const cleanTarget = sanitizeUsername(target);
    if (!cleanTarget) return;
    group.mutes.delete(cleanTarget);
    emitGroupsForAll();
  });

  socket.on("group:ban", ({ token, groupId, target }) => {
    const user = authorize(token);
    if (!user) return;
    const group = groups.get(groupId);
    if (!group) return;
    if (!canAdmin(group, user.username)) {
      socket.emit("system:error", { message: "Not allowed to ban." });
      return;
    }
    const cleanTarget = sanitizeUsername(target);
    if (!cleanTarget) return;
    group.bans.add(cleanTarget);
    group.members.delete(cleanTarget);
    group.roles.delete(cleanTarget);
    emitGroupsForAll();
  });

  socket.on("group:unban", ({ token, groupId, target }) => {
    const user = authorize(token);
    if (!user) return;
    const group = groups.get(groupId);
    if (!group) return;
    if (!canAdmin(group, user.username)) return;
    const cleanTarget = sanitizeUsername(target);
    if (!cleanTarget) return;
    group.bans.delete(cleanTarget);
    emitGroupsForAll();
  });

  socket.on("group:slowmode", ({ token, groupId, seconds }) => {
    const user = authorize(token);
    if (!user) return;
    const group = groups.get(groupId);
    if (!group) return;
    if (!canAdmin(group, user.username)) {
      socket.emit("system:error", { message: "Not allowed to change slow mode." });
      return;
    }
    const duration = Math.max(0, Math.min(Number(seconds || 0), 60));
    group.slowModeSeconds = duration;
    emitGroupsForAll();
  });

  socket.on("profile:update", ({ token, status, bio, avatar }) => {
    const user = authorize(token);
    if (!user) return;
    const profile = ensureProfile(user.username);
    profile.status = sanitizeProfileText(status, 60) || profile.status;
    profile.bio = sanitizeProfileText(bio, 160);
    const safeAvatar = typeof avatar === "string" && avatar.startsWith("data:") && avatar.length < 200000 ? avatar : "";
    profile.avatar = safeAvatar || profile.avatar || "";
    profiles.set(user.username, profile);
    socket.emit("profile:updated", { profile });
    publishUsers();
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

    markRead(access.key, user.username);
    emitChatUpdate(chat, access, { silent: true });
  });

  socket.on("message:send", ({ token, chat, text, file }) => {
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

    if (chat.type === "group") {
      const group = groups.get(chat.target);
      if (!group) return;
      const mutedUntil = group.mutes.get(user.username) || 0;
      if (mutedUntil > Date.now()) {
        socket.emit("system:error", { message: "You are muted in this group." });
        return;
      }
      const slowSeconds = group.slowModeSeconds || 0;
      if (slowSeconds > 0) {
        const key = `${group.id}::${user.username}`;
        const last = slowModeState.get(key) || { ts: 0 };
        if (Date.now() - last.ts < slowSeconds * 1000) {
          socket.emit("system:error", { message: `Slow mode: wait ${slowSeconds}s.` });
          return;
        }
        slowModeState.set(key, { ts: Date.now() });
      }
    }

    const entry = addMessage(access.key, user.username, text, file);
    if (!entry) return;
    emitChatUpdate(chat, access);
    emitStats();
  });

  socket.on("message:edit", ({ token, chat, messageId, text }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    const msg = findMessage(access.key, messageId);
    if (!msg || msg.deleted) return;
    if (msg.from !== user.username) {
      socket.emit("system:error", { message: "You can only edit your own messages." });
      return;
    }
    const clean = String(text || "").trim().slice(0, 2000);
    if (!clean) return;
    msg.text = clean;
    msg.editedAt = Date.now();
    emitChatUpdate(chat, access);
  });

  socket.on("message:delete", ({ token, chat, messageId }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    const msg = findMessage(access.key, messageId);
    if (!msg || msg.deleted) return;
    let allowed = msg.from === user.username;
    if (!allowed && chat.type === "group") {
      const group = groups.get(chat.target);
      if (group && canModerate(group, user.username)) allowed = true;
    }
    if (!allowed) {
      socket.emit("system:error", { message: "Not allowed to delete this message." });
      return;
    }
    msg.deleted = true;
    msg.text = "";
    msg.file = null;
    msg.reactions = {};
    emitChatUpdate(chat, access);
  });

  socket.on("message:react", ({ token, chat, messageId, emoji }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    const ok = toggleReaction(access.key, messageId, emoji, user.username);
    if (ok) emitChatUpdate(chat, access);
  });

  socket.on("message:pin", ({ token, chat, messageId }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    if (chat.type === "group") {
      const group = groups.get(chat.target);
      if (!group || !canModerate(group, user.username)) {
        socket.emit("system:error", { message: "Not allowed to pin in this group." });
        return;
      }
    }
    togglePin(access.key, messageId);
    emitChatUpdate(chat, access);
  });

  socket.on("message:bookmark", ({ token, chat, messageId }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    toggleBookmark(user.username, access.key, messageId);
    emitChatUpdate(chat, access);
  });

  socket.on("messages:read", ({ token, chat }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    const changed = markRead(access.key, user.username);
    if (changed) emitChatUpdate(chat, access, { silent: true });
  });

  socket.on("messages:search", ({ token, chat, query, from, dateFrom, dateTo }) => {
    const user = authorize(token);
    if (!user) return;
    const access = canAccessChat(user.username, chat);
    if (!access.ok) return;
    const cleanQuery = String(query || "").trim().toLowerCase();
    const cleanFrom = sanitizeUsername(from);
    const start = dateFrom ? Date.parse(dateFrom) : 0;
    const end = dateTo ? Date.parse(dateTo) + 24 * 3600 * 1000 : Number.MAX_SAFE_INTEGER;
    const results = readMessages(access.key)
      .filter((m) => {
        if (cleanFrom && m.from !== cleanFrom) return false;
        if (m.ts < start || m.ts > end) return false;
        if (!cleanQuery) return true;
        const hay = `${m.text || ""} ${(m.file && m.file.name) || ""}`.toLowerCase();
        return hay.includes(cleanQuery);
      })
      .map(serializeMessage);
    socket.emit("messages:search", { chat, results });
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
      startedAt: 0,
      ended: false,
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
    if (!session.ended) {
      const now = Date.now();
      addCallHistory(session.caller, {
        with: session.callee,
        direction: "outgoing",
        status: "canceled",
        startedAt: session.startedAt || now,
        endedAt: now,
      });
      addCallHistory(session.callee, {
        with: session.caller,
        direction: "incoming",
        status: "missed",
        startedAt: session.startedAt || now,
        endedAt: now,
      });
      emitCallHistory(session.caller);
      emitCallHistory(session.callee);
      session.ended = true;
    }
    cleanupCall(sessionId);
  });

  socket.on("call:reject", ({ token, sessionId }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.callee !== user.username) return;

    emitToUser(session.caller, "call:rejected", { sessionId, from: user.username });
    if (!session.ended) {
      const now = Date.now();
      addCallHistory(session.caller, {
        with: session.callee,
        direction: "outgoing",
        status: "rejected",
        startedAt: session.startedAt || now,
        endedAt: now,
      });
      addCallHistory(session.callee, {
        with: session.caller,
        direction: "incoming",
        status: "rejected",
        startedAt: session.startedAt || now,
        endedAt: now,
      });
      emitCallHistory(session.caller);
      emitCallHistory(session.callee);
      session.ended = true;
    }
    cleanupCall(sessionId);
  });

  socket.on("call:accept", ({ token, sessionId }) => {
    const user = authorize(token);
    if (!user) return;

    const session = calls.get(sessionId);
    if (!session || session.callee !== user.username) return;

    session.accepted = true;
    session.startedAt = Date.now();
    stats.calls += 1;
    emitStats();
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
    if (!session.ended) {
      const now = Date.now();
      addCallHistory(session.caller, {
        with: session.callee,
        direction: "outgoing",
        status: "completed",
        startedAt: session.startedAt || now,
        endedAt: now,
      });
      addCallHistory(session.callee, {
        with: session.caller,
        direction: "incoming",
        status: "completed",
        startedAt: session.startedAt || now,
        endedAt: now,
      });
      emitCallHistory(session.caller);
      emitCallHistory(session.callee);
      session.ended = true;
    }
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
          if (!session.ended) {
            const now = Date.now();
            addCallHistory(session.caller, {
              with: session.callee,
              direction: "outgoing",
              status: "disconnected",
              startedAt: session.startedAt || now,
              endedAt: now,
            });
            addCallHistory(session.callee, {
              with: session.caller,
              direction: "incoming",
              status: "disconnected",
              startedAt: session.startedAt || now,
              endedAt: now,
            });
            emitCallHistory(session.caller);
            emitCallHistory(session.callee);
            session.ended = true;
          }
        }
        cleanupCall(sessionId);
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Talkfree socket server running on http://localhost:${PORT}`);
});
