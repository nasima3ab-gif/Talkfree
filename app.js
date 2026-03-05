const backendMeta = document.querySelector('meta[name="backend-url"]');
const configuredBackendUrl = backendMeta ? backendMeta.content.trim() : "";
const localFallback =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";
const backendUrl = configuredBackendUrl || localFallback;

const socket = io(backendUrl, {
  transports: ["websocket", "polling"],
});

const authSection = document.getElementById("authSection");
const chatSection = document.getElementById("chatSection");
const authMessage = document.getElementById("authMessage");
const meBadge = document.getElementById("meBadge");
const groupList = document.getElementById("groupList");
const userList = document.getElementById("userList");
const chatTitle = document.getElementById("chatTitle");
const presenceText = document.getElementById("presenceText");
const messageList = document.getElementById("messageList");
const typingText = document.getElementById("typingText");
const messageInput = document.getElementById("messageInput");

const state = {
  token: null,
  username: null,
  users: [],
  groups: [],
  activeChat: null,
  typingTimer: null,
};

function renderUsers() {
  userList.innerHTML = "";
  state.users
    .filter((u) => u.username !== state.username)
    .forEach((u) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.innerHTML = `<span class="status-dot ${u.online ? "status-online" : "status-offline"}"></span>@${u.username}`;
      btn.className = state.activeChat?.type === "private" && state.activeChat.target === u.username ? "active" : "";
      btn.onclick = () => {
        state.activeChat = { type: "private", target: u.username, label: `@${u.username}` };
        chatTitle.textContent = `Private: @${u.username}`;
        presenceText.textContent = u.online ? "Online" : "Offline";
        typingText.textContent = "";
        renderUsers();
        renderGroups();
        loadMessages();
      };
      li.appendChild(btn);
      userList.appendChild(li);
    });
}

function renderGroups() {
  groupList.innerHTML = "";
  state.groups.forEach((g) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = g.joined ? `# ${g.name}` : `Join # ${g.name}`;
    btn.className = state.activeChat?.type === "group" && state.activeChat.target === g.id ? "active" : "";
    btn.onclick = () => {
      if (!g.joined) {
        socket.emit("group:join", { token: state.token, groupId: g.id });
        return;
      }
      state.activeChat = { type: "group", target: g.id, label: `#${g.name}` };
      chatTitle.textContent = `Group: #${g.name}`;
      presenceText.textContent = `${g.members.length} members`;
      typingText.textContent = "";
      renderUsers();
      renderGroups();
      loadMessages();
    };
    li.appendChild(btn);
    groupList.appendChild(li);
  });
}

function renderMessages(messages) {
  messageList.innerHTML = "";
  messages.forEach((m) => {
    const div = document.createElement("div");
    div.className = "message";
    const time = new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    div.innerHTML = `<div class="meta">${m.from} - ${time}</div><div>${escapeHtml(m.text)}</div>`;
    messageList.appendChild(div);
  });
  messageList.scrollTop = messageList.scrollHeight;
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function loadMessages() {
  if (!state.activeChat) {
    messageList.innerHTML = "";
    return;
  }
  socket.emit("messages:get", { token: state.token, chat: state.activeChat });
}

function setAuthMessage(msg, error = false) {
  authMessage.textContent = msg;
  authMessage.style.color = error ? "var(--danger)" : "var(--muted)";
}

document.getElementById("registerBtn").onclick = () => {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  socket.emit("auth:register", { username, password });
};

document.getElementById("loginBtn").onclick = () => {
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  socket.emit("auth:login", { username, password });
};

document.getElementById("createGroupBtn").onclick = () => {
  const input = document.getElementById("newGroupName");
  const name = input.value.trim();
  if (!name || !state.token) return;
  socket.emit("group:create", { token: state.token, name });
  input.value = "";
};

document.getElementById("messageForm").onsubmit = (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !state.activeChat) return;
  socket.emit("message:send", { token: state.token, chat: state.activeChat, text });
  messageInput.value = "";
  socket.emit("typing:stop", { token: state.token, chat: state.activeChat });
};

messageInput.addEventListener("input", () => {
  if (!state.activeChat || !state.token) return;
  socket.emit("typing:start", { token: state.token, chat: state.activeChat });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    socket.emit("typing:stop", { token: state.token, chat: state.activeChat });
  }, 900);
});

socket.on("auth:ok", ({ token, username, users, groups }) => {
  state.token = token;
  state.username = username;
  state.users = users;
  state.groups = groups;

  authSection.classList.add("hidden");
  chatSection.classList.remove("hidden");
  meBadge.textContent = `Logged in as @${username}`;

  renderUsers();
  renderGroups();
  setAuthMessage("", false);
});

socket.on("auth:error", ({ message }) => {
  setAuthMessage(message, true);
});

socket.on("auth:notice", ({ message }) => {
  setAuthMessage(message, false);
});

socket.on("users:update", (users) => {
  state.users = users;
  renderUsers();
});

socket.on("groups:update", (groups) => {
  state.groups = groups;
  renderGroups();
});

socket.on("messages:data", (messages) => {
  renderMessages(messages);
});

socket.on("typing:update", ({ chat, users }) => {
  if (!state.activeChat) return;
  if (state.activeChat.type !== chat.type || state.activeChat.target !== chat.target) return;

  const others = users.filter((u) => u !== state.username);
  if (!others.length) {
    typingText.textContent = "";
  } else if (others.length === 1) {
    typingText.textContent = `${others[0]} is typing...`;
  } else {
    typingText.textContent = `${others.join(", ")} are typing...`;
  }
});

socket.on("system:error", ({ message }) => {
  alert(message);
});

