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
const callStatus = document.getElementById("callStatus");
const callStats = document.getElementById("callStats");
const callBtn = document.getElementById("callBtn");
const hangupBtn = document.getElementById("hangupBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const shareBtn = document.getElementById("shareBtn");
const videoGrid = document.getElementById("videoGrid");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remoteLabel = document.getElementById("remoteLabel");
const incomingCall = document.getElementById("incomingCall");
const incomingText = document.getElementById("incomingText");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const rejectCallBtn = document.getElementById("rejectCallBtn");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileStatus = document.getElementById("profileStatus");
const editProfileBtn = document.getElementById("editProfileBtn");
const notifToggle = document.getElementById("notifToggle");
const soundToggle = document.getElementById("soundToggle");
const themeSelect = document.getElementById("themeSelect");
const inviteCodeInput = document.getElementById("inviteCodeInput");
const joinInviteBtn = document.getElementById("joinInviteBtn");
const inviteFeedback = document.getElementById("inviteFeedback");
const pinList = document.getElementById("pinList");
const bookmarkList = document.getElementById("bookmarkList");
const callHistoryList = document.getElementById("callHistoryList");
const analyticsPanel = document.getElementById("analyticsPanel");
const groupTools = document.getElementById("groupTools");
const privateTools = document.getElementById("privateTools");
const setSecretBtn = document.getElementById("setSecretBtn");
const secretStatus = document.getElementById("secretStatus");
const createInviteBtn = document.getElementById("createInviteBtn");
const inviteDisplay = document.getElementById("inviteDisplay");
const openModerationBtn = document.getElementById("openModerationBtn");
const slowModeInput = document.getElementById("slowModeInput");
const setSlowModeBtn = document.getElementById("setSlowModeBtn");
const searchInput = document.getElementById("searchInput");
const searchUser = document.getElementById("searchUser");
const searchFrom = document.getElementById("searchFrom");
const searchTo = document.getElementById("searchTo");
const searchBtn = document.getElementById("searchBtn");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const searchInfo = document.getElementById("searchInfo");
const attachBtn = document.getElementById("attachBtn");
const emojiBtn = document.getElementById("emojiBtn");
const fileInput = document.getElementById("fileInput");
const filePreview = document.getElementById("filePreview");
const emojiPanel = document.getElementById("emojiPanel");
const profileModal = document.getElementById("profileModal");
const profileStatusInput = document.getElementById("profileStatusInput");
const profileBioInput = document.getElementById("profileBioInput");
const profileAvatarInput = document.getElementById("profileAvatarInput");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const closeProfileBtn = document.getElementById("closeProfileBtn");
const moderationModal = document.getElementById("moderationModal");
const moderationList = document.getElementById("moderationList");
const closeModerationBtn = document.getElementById("closeModerationBtn");
const unbanInput = document.getElementById("unbanInput");
const unbanBtn = document.getElementById("unbanBtn");

const state = {
  token: null,
  username: null,
  users: [],
  groups: [],
  activeChat: null,
  typingTimer: null,
  profile: null,
  pins: [],
  bookmarks: [],
  callHistory: [],
  stats: {},
  searchResults: null,
  fileDraft: null,
  secrets: new Map(),
  lastMessageIdByChat: new Map(),
  fullMessages: [],
  currentMessages: [],
  settings: {
    notifications: false,
    sound: true,
    theme: "dark",
  },
  call: {
    sessionId: null,
    target: null,
    peer: null,
    localStream: null,
    cameraTrack: null,
    screenStream: null,
    isCaller: false,
    active: false,
    pending: false,
    micEnabled: true,
    camEnabled: true,
    screenSharing: false,
    statsTimer: null,
    lastStats: null,
    incomingFrom: null,
  },
};

function renderUsers() {
  userList.innerHTML = "";
  state.users
    .filter((u) => u.username !== state.username)
    .forEach((u) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      const profile = u.profile || {};
      const initial = u.username.slice(0, 1).toUpperCase();
      const avatar = profile.avatar
        ? `<img src="${profile.avatar}" alt="" />`
        : `<span>${initial}</span>`;
      const status = escapeHtml(profile.status || "");
      btn.innerHTML = `
        <span class="status-dot ${u.online ? "status-online" : "status-offline"}"></span>
        <span class="user-avatar" style="background:${profile.color || "#1d2f4f"}">${avatar}</span>
        <span class="user-name">@${u.username}</span>
        <span class="user-status">${status}</span>
      `;
      btn.className = state.activeChat?.type === "private" && state.activeChat.target === u.username ? "active" : "";
      btn.onclick = () => {
        state.activeChat = { type: "private", target: u.username, label: `@${u.username}` };
        chatTitle.textContent = `Private: @${u.username}`;
        const statusText = u.profile?.status ? ` • ${u.profile.status}` : "";
        presenceText.textContent = `${u.online ? "Online" : "Offline"}${statusText}`;
        typingText.textContent = "";
        clearFileDraft();
        emojiPanel.classList.add("hidden");
        renderUsers();
        renderGroups();
        loadMessages();
        updateCallUi();
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
    const meta = g.joined ? `(${g.onlineCount}/${g.memberCount})` : "";
    const roleTag = g.joined && g.role ? `• ${g.role}` : "";
    btn.textContent = g.joined ? `# ${g.name} ${meta} ${roleTag}` : `Join # ${g.name}`;
    btn.className = state.activeChat?.type === "group" && state.activeChat.target === g.id ? "active" : "";
      btn.onclick = () => {
        if (!g.joined) {
          socket.emit("group:join", { token: state.token, groupId: g.id });
          return;
        }
        state.activeChat = { type: "group", target: g.id, label: `#${g.name}` };
        chatTitle.textContent = `Group: #${g.name}`;
        const mutedText = g.mutedUntil && g.mutedUntil > Date.now() ? "Muted" : "";
        const slowText = g.slowModeSeconds ? `Slow ${g.slowModeSeconds}s` : "";
        presenceText.textContent = `${g.memberCount} members • ${g.onlineCount} online ${slowText} ${mutedText}`.trim();
        typingText.textContent = "";
        clearFileDraft();
        emojiPanel.classList.add("hidden");
        renderUsers();
        renderGroups();
        loadMessages();
        updateCallUi();
      };
    li.appendChild(btn);
    groupList.appendChild(li);
  });
}

async function renderMessages(messages) {
  messageList.innerHTML = "";
  const key = chatKey(state.activeChat);
  const secret = state.secrets.get(key) || null;
  state.currentMessages = messages;

  for (const m of messages) {
    const div = document.createElement("div");
    div.className = "message";
    div.id = `msg-${m.id}`;

    const time = formatTime(m.ts);
    const edited = m.editedAt ? " (edited)" : "";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${m.from} - ${time}${edited}`;
    div.appendChild(meta);

    let contentText = "";
    if (m.deleted) {
      contentText = "Message deleted";
    } else if (m.text) {
      contentText = m.text;
      if (contentText.startsWith("__enc__")) {
        contentText = secret ? await decryptText(contentText, secret) : "[Encrypted message]";
      }
    }
    if (contentText) {
      const body = document.createElement("div");
      body.textContent = contentText;
      div.appendChild(body);
    }

    if (m.file && !m.deleted) {
      const fileWrap = document.createElement("div");
      fileWrap.className = "message-file";
      const label = document.createElement("div");
      label.textContent = `${m.file.name} (${Math.round(m.file.size / 1024)} KB)`;
      fileWrap.appendChild(label);
      if (m.file.type && m.file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.src = m.file.dataUrl;
        img.alt = m.file.name;
        fileWrap.appendChild(img);
      } else {
        const link = document.createElement("a");
        link.href = m.file.dataUrl;
        link.download = m.file.name;
        link.textContent = "Download";
        fileWrap.appendChild(link);
      }
      div.appendChild(fileWrap);
    }

    const reactionBar = document.createElement("div");
    reactionBar.className = "reaction-bar";
    Object.entries(m.reactions || {}).forEach(([emoji, users]) => {
      const btn = document.createElement("button");
      const count = users.length;
      btn.textContent = `${emoji} ${count}`;
      btn.onclick = () => {
        socket.emit("message:react", { token: state.token, chat: state.activeChat, messageId: m.id, emoji });
      };
      reactionBar.appendChild(btn);
    });
    if (!m.deleted) {
      const addBtn = document.createElement("button");
      addBtn.textContent = "+";
      addBtn.onclick = () => {
        const emoji = prompt("React with emoji");
        if (!emoji) return;
        socket.emit("message:react", { token: state.token, chat: state.activeChat, messageId: m.id, emoji });
      };
      reactionBar.appendChild(addBtn);
    }
    div.appendChild(reactionBar);

    const actions = document.createElement("div");
    actions.className = "message-actions";
    const isMine = m.from === state.username;
    const group = getActiveGroup();
    const canMod = group?.canModerate;

    if (!m.deleted) {
      const reactBtn = document.createElement("button");
      reactBtn.textContent = "React";
      reactBtn.onclick = () => {
        const emoji = prompt("React with emoji");
        if (!emoji) return;
        socket.emit("message:react", { token: state.token, chat: state.activeChat, messageId: m.id, emoji });
      };
      actions.appendChild(reactBtn);
    }

    if (isMine && !m.deleted) {
      const editBtn = document.createElement("button");
      editBtn.textContent = "Edit";
      editBtn.onclick = async () => {
        let current = m.text || "";
        if (current.startsWith("__enc__") && secret) {
          current = await decryptText(current, secret);
        }
        const next = prompt("Edit message", current);
        if (!next) return;
        const outgoing = secret ? await encryptText(next, secret) : next;
        socket.emit("message:edit", { token: state.token, chat: state.activeChat, messageId: m.id, text: outgoing });
      };
      actions.appendChild(editBtn);
    }

    if (isMine || canMod) {
      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.onclick = () => {
        const ok = confirm("Delete this message?");
        if (!ok) return;
        socket.emit("message:delete", { token: state.token, chat: state.activeChat, messageId: m.id });
      };
      actions.appendChild(delBtn);
    }

    const pinBtn = document.createElement("button");
    pinBtn.textContent = "Pin";
    pinBtn.onclick = () => {
      socket.emit("message:pin", { token: state.token, chat: state.activeChat, messageId: m.id });
    };
    actions.appendChild(pinBtn);

    const bookmarkBtn = document.createElement("button");
    bookmarkBtn.textContent = "Bookmark";
    bookmarkBtn.onclick = () => {
      socket.emit("message:bookmark", { token: state.token, chat: state.activeChat, messageId: m.id });
    };
    actions.appendChild(bookmarkBtn);

    div.appendChild(actions);

    if (isMine && m.reads) {
      const readers = m.reads.filter((u) => u !== state.username);
      if (readers.length) {
        const receipt = document.createElement("div");
        receipt.className = "read-receipt";
        receipt.textContent = `Read by ${readers.join(", ")}`;
        div.appendChild(receipt);
      }
    }

    messageList.appendChild(div);
  }

  messageList.scrollTop = messageList.scrollHeight;
  renderPins();
  renderBookmarks();
  if (state.token && state.activeChat) {
    socket.emit("messages:read", { token: state.token, chat: state.activeChat });
  }
}

function notifyIfNeeded(messages, chat, isActive, silent) {
  if (!messages || !messages.length) return;
  if (silent) {
    if (isActive && chat) {
      const lastId = messages[messages.length - 1].id;
      state.lastMessageIdByChat.set(chatKey(chat), lastId);
    }
    return;
  }
  if (isActive) {
    const lastId = messages[messages.length - 1].id;
    if (chat) state.lastMessageIdByChat.set(chatKey(chat), lastId);
    return;
  }
  if (!state.settings.notifications && !state.settings.sound) return;
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.from === state.username) return;

  const key =
    chat && chat.type === "private"
      ? privateKey(state.username, lastMessage.from)
      : chat
        ? `group::${chat.target}`
        : "";
  const lastSeen = state.lastMessageIdByChat.get(key);
  if (lastSeen === lastMessage.id) return;
  state.lastMessageIdByChat.set(key, lastMessage.id);

  if (state.settings.notifications && "Notification" in window && Notification.permission === "granted") {
    const title = chat?.type === "group" ? `#${chat.label || "Group"}` : `@${lastMessage.from}`;
    const body =
      lastMessage.text && lastMessage.text.startsWith("__enc__") ? "Encrypted message" : lastMessage.text || "New message";
    new Notification(title, { body });
  }
  if (state.settings.sound) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 660;
    osc.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  }
}

function escapeHtml(text) {
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

function privateKey(a, b) {
  return [a, b].sort().join("::");
}

function chatKey(chat) {
  if (!chat) return "";
  return chat.type === "private" ? privateKey(state.username, chat.target) : `group::${chat.target}`;
}

function getActiveGroup() {
  if (!state.activeChat || state.activeChat.type !== "group") return null;
  return state.groups.find((g) => g.id === state.activeChat.target) || null;
}

function getUserProfile(username) {
  return state.users.find((u) => u.username === username)?.profile || null;
}

function saveSettings() {
  localStorage.setItem("talkfree-settings", JSON.stringify(state.settings));
}

function loadSettings() {
  const raw = localStorage.getItem("talkfree-settings");
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.settings = { ...state.settings, ...parsed };
  } catch (err) {
    // ignore corrupted settings
  }
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme;
}

function updateProfileCard() {
  if (!state.username) return;
  const profile = state.profile || getUserProfile(state.username);
  profileName.textContent = `@${state.username}`;
  profileStatus.textContent = profile?.status || "Available";
  profileAvatar.innerHTML = "";
  if (profile?.avatar) {
    const img = document.createElement("img");
    img.src = profile.avatar;
    img.alt = "Avatar";
    profileAvatar.appendChild(img);
  } else {
    const initial = state.username.slice(0, 1).toUpperCase();
    profileAvatar.textContent = initial;
    profileAvatar.style.background = profile?.color || "#1d2f4f";
  }
}

function updateAnalytics() {
  if (!analyticsPanel) return;
  const stats = state.stats || {};
  analyticsPanel.innerHTML = "";
  const lines = [
    `Users: ${stats.users || 0}`,
    `Online: ${stats.online || 0}`,
    `Groups: ${stats.groups || 0}`,
    `Messages: ${stats.messages || 0}`,
    `Files: ${stats.files || 0}`,
    `Calls: ${stats.calls || 0}`,
  ];
  lines.forEach((line) => {
    const p = document.createElement("div");
    p.textContent = line;
    analyticsPanel.appendChild(p);
  });
}

function setSearchInfo(text) {
  if (searchInfo) searchInfo.textContent = text;
}

function renderPins() {
  pinList.innerHTML = "";
  if (!state.activeChat) return;
  if (!state.pins.length) {
    const li = document.createElement("li");
    li.textContent = "No pinned messages";
    pinList.appendChild(li);
    return;
  }
  const messages = state.fullMessages || state.currentMessages || [];
  state.pins.forEach((id) => {
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.textContent = `${msg.from}: ${msg.text ? msg.text.slice(0, 40) : "Attachment"}`;
    btn.onclick = () => {
      const el = document.getElementById(`msg-${msg.id}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    li.appendChild(btn);
    pinList.appendChild(li);
  });
}

function renderBookmarks() {
  bookmarkList.innerHTML = "";
  if (!state.activeChat) return;
  if (!state.bookmarks.length) {
    const li = document.createElement("li");
    li.textContent = "No bookmarks";
    bookmarkList.appendChild(li);
    return;
  }
  const messages = state.fullMessages || state.currentMessages || [];
  state.bookmarks
    .filter((token) => token.startsWith(chatKey(state.activeChat)))
    .forEach((token) => {
      const msgId = token.split("::").pop();
      const msg = messages.find((m) => m.id === msgId);
      if (!msg) return;
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.textContent = `${msg.from}: ${msg.text ? msg.text.slice(0, 40) : "Attachment"}`;
      btn.onclick = () => {
        const el = document.getElementById(`msg-${msg.id}`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      };
      li.appendChild(btn);
      bookmarkList.appendChild(li);
    });
}

function renderCallHistory() {
  callHistoryList.innerHTML = "";
  if (!state.callHistory.length) {
    const li = document.createElement("li");
    li.textContent = "No calls yet";
    callHistoryList.appendChild(li);
    return;
  }
  state.callHistory.forEach((call) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    const when = `${formatDate(call.startedAt)} ${formatTime(call.startedAt)}`;
    btn.textContent = `${call.direction === "outgoing" ? "To" : "From"} @${call.with} · ${call.status} · ${when}`;
    li.appendChild(btn);
    callHistoryList.appendChild(li);
  });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveSecretKey(passphrase, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(salt), iterations: 120000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptText(plainText, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));
  return `__enc__:${toBase64(iv)}:${toBase64(new Uint8Array(cipher))}`;
}

async function decryptText(payload, key) {
  if (!payload.startsWith("__enc__:")) return payload;
  const parts = payload.split(":");
  if (parts.length < 3) return "[Encrypted]";
  try {
    const iv = fromBase64(parts[1]);
    const data = fromBase64(parts[2]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return decoder.decode(plain);
  } catch (err) {
    return "[Encrypted]";
  }
}

function renderModeration() {
  moderationList.innerHTML = "";
  const group = getActiveGroup();
  if (!group || !group.canModerate) {
    moderationList.textContent = "Select a group you can moderate.";
    return;
  }
  const members = group.members || [];
  members.forEach((member) => {
    const row = document.createElement("div");
    row.className = "moderation-item";
    const name = document.createElement("div");
    name.textContent = `@${member}`;
    row.appendChild(name);

    const roleSelect = document.createElement("select");
    ["member", "mod", "admin", "owner"].forEach((role) => {
      const opt = document.createElement("option");
      opt.value = role;
      opt.textContent = role;
      roleSelect.appendChild(opt);
    });
    roleSelect.value = (group.roles && group.roles[member]) || "member";
    roleSelect.disabled = !group.canAdmin || member === state.username;
    roleSelect.onchange = () => {
      socket.emit("group:role", { token: state.token, groupId: group.id, target: member, role: roleSelect.value });
    };
    row.appendChild(roleSelect);

    const muteBtn = document.createElement("button");
    muteBtn.textContent = "Mute";
    muteBtn.onclick = () => {
      const seconds = prompt("Mute seconds (0 for 10 min default)", "0");
      socket.emit("group:mute", { token: state.token, groupId: group.id, target: member, seconds: Number(seconds || 0) });
    };
    row.appendChild(muteBtn);

    const unmuteBtn = document.createElement("button");
    unmuteBtn.textContent = "Unmute";
    unmuteBtn.onclick = () => {
      socket.emit("group:unmute", { token: state.token, groupId: group.id, target: member });
    };
    row.appendChild(unmuteBtn);

    const banBtn = document.createElement("button");
    banBtn.textContent = "Ban";
    banBtn.disabled = !group.canAdmin || member === state.username;
    banBtn.onclick = () => {
      const ok = confirm(`Ban @${member}?`);
      if (!ok) return;
      socket.emit("group:ban", { token: state.token, groupId: group.id, target: member });
    };
    row.appendChild(banBtn);

    moderationList.appendChild(row);
  });
}
function setCallStatus(text) {
  if (callStatus) callStatus.textContent = text;
}

function showCallNotice(text) {
  setCallStatus(text);
  setTimeout(updateCallUi, 1200);
}

function updateToggleButtons() {
  muteBtn.textContent = state.call.micEnabled ? "Mute" : "Unmute";
  cameraBtn.textContent = state.call.camEnabled ? "Camera off" : "Camera on";
}

function updateCallUi() {
  const isPrivate = state.activeChat && state.activeChat.type === "private";
  const hasToken = Boolean(state.token);
  const inCall = state.call.active;
  const inProgress = state.call.pending || state.call.active;

  callBtn.disabled = !isPrivate || !hasToken || inProgress;
  callBtn.classList.toggle("hidden", !isPrivate || inProgress);
  hangupBtn.classList.toggle("hidden", !inProgress);
  hangupBtn.textContent = state.call.pending ? "Cancel" : "Hang up";
  muteBtn.classList.toggle("hidden", !inCall);
  cameraBtn.classList.toggle("hidden", !inCall);
  shareBtn.classList.toggle("hidden", !inCall);
  shareBtn.disabled = !navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia;
  videoGrid.classList.toggle("hidden", !inCall);
  callStats.classList.toggle("hidden", !inCall);

  if (state.call.pending) {
    setCallStatus(`Calling @${state.call.target}...`);
  } else if (state.call.active) {
    setCallStatus(`In call with @${state.call.target}`);
  } else if (!isPrivate) {
    setCallStatus("Select a private chat to start a call.");
  } else {
    setCallStatus(`Ready to call @${state.activeChat.target}`);
  }
}

function stopStream(stream) {
  if (!stream) return;
  stream.getTracks().forEach((t) => t.stop());
}

function teardownPeer() {
  if (!state.call.peer) return;
  state.call.peer.ontrack = null;
  state.call.peer.onicecandidate = null;
  state.call.peer.onconnectionstatechange = null;
  state.call.peer.close();
  state.call.peer = null;
}

function resetCallState() {
  teardownPeer();
  stopCallStats();
  stopScreenShare();
  stopStream(state.call.localStream);
  state.call.localStream = null;
  state.call.cameraTrack = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  state.call.sessionId = null;
  state.call.target = null;
  state.call.isCaller = false;
  state.call.active = false;
  state.call.pending = false;
  state.call.micEnabled = true;
  state.call.camEnabled = true;
  state.call.screenSharing = false;
  state.call.incomingFrom = null;
  incomingCall.classList.add("hidden");
  remoteLabel.textContent = "Remote";
  shareBtn.textContent = "Share screen";
  updateToggleButtons();
  updateCallUi();
}

async function ensureLocalStream() {
  if (state.call.localStream) return state.call.localStream;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("Camera not supported in this browser.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  state.call.localStream = stream;
  state.call.cameraTrack = stream.getVideoTracks()[0] || null;
  localVideo.srcObject = stream;
  state.call.micEnabled = true;
  state.call.camEnabled = true;
  updateToggleButtons();
  return stream;
}

function ensurePeer() {
  if (state.call.peer) return state.call.peer;
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });

  pc.onicecandidate = (event) => {
    if (!event.candidate || !state.call.sessionId) return;
    socket.emit("call:ice", {
      token: state.token,
      sessionId: state.call.sessionId,
      candidate: event.candidate,
    });
  };

  pc.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  pc.onconnectionstatechange = () => {
    if (!state.call.active) return;
    if (pc.connectionState === "connected") {
      startCallStats();
    }
    if (pc.connectionState === "disconnected") {
      callStats.textContent = "Reconnecting...";
      if (pc.restartIce) pc.restartIce();
    }
    if (["failed", "closed"].includes(pc.connectionState)) {
      showCallNotice("Call connection ended.");
      resetCallState();
    }
  };

  state.call.peer = pc;
  return pc;
}

function attachLocalTracks(pc) {
  if (!state.call.localStream) return;
  const existing = pc.getSenders().map((s) => s.track);
  state.call.localStream.getTracks().forEach((track) => {
    if (!existing.includes(track)) {
      pc.addTrack(track, state.call.localStream);
    }
  });
}

async function replaceVideoTrack(track) {
  const pc = state.call.peer;
  if (!pc) return;
  const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
  if (sender) {
    await sender.replaceTrack(track);
  }
  const audioTrack = state.call.localStream?.getAudioTracks()[0] || null;
  const stream = new MediaStream();
  if (track) stream.addTrack(track);
  if (audioTrack) stream.addTrack(audioTrack);
  localVideo.srcObject = stream;
}

async function toggleScreenShare() {
  if (!state.call.active) return;
  if (!state.call.screenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack) return;
      state.call.screenStream = screenStream;
      state.call.screenSharing = true;
      shareBtn.textContent = "Stop share";
      await replaceVideoTrack(screenTrack);
      screenTrack.onended = () => {
        stopScreenShare();
      };
    } catch (err) {
      showCallNotice("Screen share canceled.");
    }
  } else {
    stopScreenShare();
  }
}

async function stopScreenShare() {
  if (!state.call.screenSharing) return;
  state.call.screenStream?.getTracks().forEach((t) => t.stop());
  state.call.screenStream = null;
  state.call.screenSharing = false;
  shareBtn.textContent = "Share screen";
  if (state.call.cameraTrack) {
    await replaceVideoTrack(state.call.cameraTrack);
  }
}

function startCallStats() {
  if (!state.call.peer) return;
  stopCallStats();
  state.call.lastStats = null;
  state.call.statsTimer = setInterval(async () => {
    if (!state.call.peer) return;
    const stats = await state.call.peer.getStats();
    let outbound;
    let inbound;
    stats.forEach((report) => {
      if (report.type === "outbound-rtp" && report.kind === "video") outbound = report;
      if (report.type === "inbound-rtp" && report.kind === "video") inbound = report;
    });
    if (!state.call.lastStats) {
      state.call.lastStats = { outbound, inbound, ts: Date.now() };
      return;
    }
    const now = Date.now();
    const seconds = (now - state.call.lastStats.ts) / 1000;
    const outRate =
      outbound && state.call.lastStats.outbound
        ? Math.round(((outbound.bytesSent - state.call.lastStats.outbound.bytesSent) * 8) / seconds / 1000)
        : 0;
    const inRate =
      inbound && state.call.lastStats.inbound
        ? Math.round(((inbound.bytesReceived - state.call.lastStats.inbound.bytesReceived) * 8) / seconds / 1000)
        : 0;
    callStats.textContent = `Up ${outRate} kbps · Down ${inRate} kbps · ${state.call.peer.connectionState}`;
    state.call.lastStats = { outbound, inbound, ts: now };
  }, 1200);
}

function stopCallStats() {
  if (state.call.statsTimer) {
    clearInterval(state.call.statsTimer);
    state.call.statsTimer = null;
  }
  callStats.textContent = "";
}

async function startOutgoingCall() {
  if (!state.activeChat || state.activeChat.type !== "private" || !state.token) return;
  if (state.call.pending || state.call.active) return;

  const target = state.activeChat.target;
  state.call.target = target;
  state.call.isCaller = true;
  state.call.pending = true;
  remoteLabel.textContent = `@${target}`;

  try {
    await ensureLocalStream();
  } catch (err) {
    state.call.pending = false;
    showCallNotice("Camera/mic permission denied.");
    resetCallState();
    return;
  }

  socket.emit("call:request", { token: state.token, target });
  updateCallUi();
}

async function acceptIncomingCall() {
  if (!state.call.sessionId || !state.call.incomingFrom) return;
  if (!state.token) return;

  try {
    await ensureLocalStream();
  } catch (err) {
    socket.emit("call:reject", { token: state.token, sessionId: state.call.sessionId });
    showCallNotice("Camera/mic permission denied.");
    resetCallState();
    incomingCall.classList.add("hidden");
    return;
  }

  state.call.isCaller = false;
  state.call.active = true;
  state.call.pending = false;
  state.call.target = state.call.incomingFrom;
  remoteLabel.textContent = `@${state.call.target}`;
  incomingCall.classList.add("hidden");
  shareBtn.textContent = "Share screen";

  const pc = ensurePeer();
  attachLocalTracks(pc);

  socket.emit("call:accept", { token: state.token, sessionId: state.call.sessionId });
  updateCallUi();
}

function rejectIncomingCall() {
  if (!state.call.sessionId || !state.token) return;
  socket.emit("call:reject", { token: state.token, sessionId: state.call.sessionId });
  incomingCall.classList.add("hidden");
  showCallNotice("Call rejected.");
  resetCallState();
}

function hangupCall() {
  if (!state.token) return;
  if (!state.call.sessionId) {
    showCallNotice("Call canceled.");
    resetCallState();
    return;
  }
  if (state.call.active) {
    socket.emit("call:end", { token: state.token, sessionId: state.call.sessionId });
  } else if (state.call.pending && state.call.isCaller) {
    socket.emit("call:cancel", { token: state.token, sessionId: state.call.sessionId });
  }
  showCallNotice("Call ended.");
  resetCallState();
}

function loadMessages() {
  if (!state.activeChat) {
    messageList.innerHTML = "";
    return;
  }
  state.searchResults = null;
  setSearchInfo("");
  const group = getActiveGroup();
  if (group && group.canModerate) {
    groupTools.classList.remove("hidden");
    slowModeInput.value = group.slowModeSeconds || 0;
    createInviteBtn.disabled = false;
    openModerationBtn.disabled = false;
  } else {
    groupTools.classList.add("hidden");
    createInviteBtn.disabled = true;
    openModerationBtn.disabled = true;
  }
  if (!group) {
    inviteDisplay.value = "";
  }
  if (state.activeChat.type === "private") {
    privateTools.classList.remove("hidden");
    const key = chatKey(state.activeChat);
    secretStatus.textContent = state.secrets.has(key) ? "Encryption on" : "Encryption off";
  } else {
    privateTools.classList.add("hidden");
  }
  socket.emit("messages:get", { token: state.token, chat: state.activeChat });
}

function setAuthMessage(msg, error = false) {
  authMessage.textContent = msg;
  authMessage.style.color = error ? "var(--danger)" : "var(--muted)";
}

function renderFilePreview() {
  if (!state.fileDraft) {
    filePreview.classList.add("hidden");
    filePreview.textContent = "";
    return;
  }
  filePreview.classList.remove("hidden");
  filePreview.textContent = `Attachment: ${state.fileDraft.name} (${Math.round(state.fileDraft.size / 1024)} KB) • click to remove`;
}

function clearFileDraft() {
  state.fileDraft = null;
  fileInput.value = "";
  renderFilePreview();
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
  if (!state.activeChat) return;
  if (!text && !state.fileDraft) return;
  const key = chatKey(state.activeChat);
  const secret = state.secrets.get(key);
  if (secret && state.fileDraft) {
    const ok = confirm("Files are not encrypted. Send anyway?");
    if (!ok) return;
  }
  const sendMessage = async () => {
    const finalText = secret && text ? await encryptText(text, secret) : text;
    socket.emit("message:send", {
      token: state.token,
      chat: state.activeChat,
      text: finalText,
      file: state.fileDraft,
    });
  };
  sendMessage();
  messageInput.value = "";
  clearFileDraft();
  socket.emit("typing:stop", { token: state.token, chat: state.activeChat });
};

attachBtn.onclick = () => {
  fileInput.click();
};

fileInput.onchange = () => {
  const file = fileInput.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    alert("File too large (max 2MB).");
    clearFileDraft();
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.fileDraft = {
      name: file.name,
      type: file.type,
      size: file.size,
      dataUrl: reader.result,
    };
    renderFilePreview();
  };
  reader.readAsDataURL(file);
};

filePreview.onclick = () => {
  clearFileDraft();
};

emojiBtn.onclick = () => {
  emojiPanel.classList.toggle("hidden");
};

emojiPanel.addEventListener("click", (event) => {
  const btn = event.target.closest("button");
  if (!btn) return;
  const emoji = btn.dataset.emoji;
  if (!emoji) return;
  messageInput.value = `${messageInput.value}${emoji}`;
  messageInput.focus();
  emojiPanel.classList.add("hidden");
});

searchBtn.onclick = () => {
  if (!state.activeChat || !state.token) return;
  socket.emit("messages:search", {
    token: state.token,
    chat: state.activeChat,
    query: searchInput.value,
    from: searchUser.value,
    dateFrom: searchFrom.value,
    dateTo: searchTo.value,
  });
};

clearSearchBtn.onclick = () => {
  state.searchResults = null;
  setSearchInfo("");
  searchInput.value = "";
  searchUser.value = "";
  searchFrom.value = "";
  searchTo.value = "";
  if (state.activeChat) loadMessages();
};

joinInviteBtn.onclick = () => {
  if (!state.token) return;
  const code = inviteCodeInput.value.trim();
  if (!code) return;
  socket.emit("group:joinInvite", { token: state.token, code });
  inviteFeedback.textContent = "Joining...";
  inviteCodeInput.value = "";
};

createInviteBtn.onclick = () => {
  const group = getActiveGroup();
  if (!group || !state.token) return;
  socket.emit("group:invite", { token: state.token, groupId: group.id });
};

openModerationBtn.onclick = () => {
  if (!state.token) return;
  renderModeration();
  moderationModal.classList.remove("hidden");
};

closeModerationBtn.onclick = () => {
  moderationModal.classList.add("hidden");
};

unbanBtn.onclick = () => {
  const group = getActiveGroup();
  if (!group) return;
  const target = unbanInput.value.trim();
  if (!target) return;
  socket.emit("group:unban", { token: state.token, groupId: group.id, target });
  unbanInput.value = "";
};

setSlowModeBtn.onclick = () => {
  const group = getActiveGroup();
  if (!group || !state.token) return;
  const seconds = Number(slowModeInput.value || 0);
  socket.emit("group:slowmode", { token: state.token, groupId: group.id, seconds });
};

setSecretBtn.onclick = async () => {
  if (!state.activeChat || state.activeChat.type !== "private") return;
  if (!window.crypto || !window.crypto.subtle) {
    alert("Encryption not supported in this browser.");
    return;
  }
  const passphrase = prompt("Set a shared secret (leave empty to disable)");
  const key = chatKey(state.activeChat);
  if (!passphrase) {
    state.secrets.delete(key);
    secretStatus.textContent = "Encryption off";
    return;
  }
  const secret = await deriveSecretKey(passphrase, key);
  state.secrets.set(key, secret);
  secretStatus.textContent = "Encryption on";
};

editProfileBtn.onclick = () => {
  profileModal.classList.remove("hidden");
  profileStatusInput.value = state.profile?.status || "";
  profileBioInput.value = state.profile?.bio || "";
};

closeProfileBtn.onclick = () => {
  profileModal.classList.add("hidden");
};

saveProfileBtn.onclick = () => {
  if (profileAvatarInput.files[0]) {
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit("profile:update", {
        token: state.token,
        status: profileStatusInput.value,
        bio: profileBioInput.value,
        avatar: reader.result,
      });
    };
    if (profileAvatarInput.files[0].size > 200000) {
      alert("Avatar too large (max ~200KB).");
      return;
    }
    reader.readAsDataURL(profileAvatarInput.files[0]);
  } else {
    socket.emit("profile:update", {
      token: state.token,
      status: profileStatusInput.value,
      bio: profileBioInput.value,
      avatar: state.profile?.avatar || "",
    });
  }
  profileModal.classList.add("hidden");
};

notifToggle.onchange = () => {
  state.settings.notifications = notifToggle.checked;
  saveSettings();
  if (notifToggle.checked && Notification.permission !== "granted") {
    Notification.requestPermission().then((perm) => {
      if (perm !== "granted") {
        state.settings.notifications = false;
        notifToggle.checked = false;
        saveSettings();
      }
    });
  }
};

soundToggle.onchange = () => {
  state.settings.sound = soundToggle.checked;
  saveSettings();
};

themeSelect.onchange = () => {
  state.settings.theme = themeSelect.value;
  applyTheme();
  saveSettings();
};

callBtn.onclick = () => {
  startOutgoingCall();
};

hangupBtn.onclick = () => {
  hangupCall();
};

muteBtn.onclick = () => {
  if (!state.call.localStream) return;
  state.call.micEnabled = !state.call.micEnabled;
  state.call.localStream.getAudioTracks().forEach((t) => {
    t.enabled = state.call.micEnabled;
  });
  updateToggleButtons();
};

cameraBtn.onclick = () => {
  if (!state.call.localStream) return;
  state.call.camEnabled = !state.call.camEnabled;
  state.call.localStream.getVideoTracks().forEach((t) => {
    t.enabled = state.call.camEnabled;
  });
  updateToggleButtons();
};

shareBtn.onclick = () => {
  toggleScreenShare();
};

acceptCallBtn.onclick = () => {
  acceptIncomingCall();
};

rejectCallBtn.onclick = () => {
  rejectIncomingCall();
};

messageInput.addEventListener("input", () => {
  if (!state.activeChat || !state.token) return;
  socket.emit("typing:start", { token: state.token, chat: state.activeChat });
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => {
    socket.emit("typing:stop", { token: state.token, chat: state.activeChat });
  }, 900);
});

socket.on("auth:ok", ({ token, username, users, groups, profile, bookmarks, stats }) => {
  state.token = token;
  state.username = username;
  state.users = users;
  state.groups = groups;
  state.profile = profile || null;
  state.bookmarks = bookmarks || [];
  state.stats = stats || {};

  authSection.classList.add("hidden");
  chatSection.classList.remove("hidden");
  meBadge.textContent = `Logged in as @${username}`;

  loadSettings();
  if (!("Notification" in window)) {
    state.settings.notifications = false;
    notifToggle.disabled = true;
  }
  notifToggle.checked = state.settings.notifications;
  soundToggle.checked = state.settings.sound;
  themeSelect.value = state.settings.theme;
  applyTheme();
  if (state.settings.notifications && Notification.permission === "default") {
    Notification.requestPermission();
  }

  updateProfileCard();
  updateAnalytics();
  renderUsers();
  renderGroups();
  updateCallUi();
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
  if (!state.profile) {
    state.profile = getUserProfile(state.username);
  }
  updateProfileCard();
  if (state.activeChat && state.activeChat.type === "private") {
    const u = state.users.find((user) => user.username === state.activeChat.target);
    if (u) {
      const statusText = u.profile?.status ? ` • ${u.profile.status}` : "";
      presenceText.textContent = `${u.online ? "Online" : "Offline"}${statusText}`;
    }
  }
  renderUsers();
});

socket.on("groups:update", (groups) => {
  state.groups = groups;
  inviteFeedback.textContent = "";
  if (state.activeChat && state.activeChat.type === "group") {
    const g = getActiveGroup();
    if (g) {
      const mutedText = g.mutedUntil && g.mutedUntil > Date.now() ? "Muted" : "";
      const slowText = g.slowModeSeconds ? `Slow ${g.slowModeSeconds}s` : "";
      presenceText.textContent = `${g.memberCount} members • ${g.onlineCount} online ${slowText} ${mutedText}`.trim();
    }
  }
  renderGroups();
  if (moderationModal && !moderationModal.classList.contains("hidden")) {
    renderModeration();
  }
});

socket.on("messages:data", (payload) => {
  if (!payload) return;
  const { chat, messages, pins, bookmarks } = payload;
  const isActive =
    chat &&
    state.activeChat &&
    chat.type === state.activeChat.type &&
    chat.target === state.activeChat.target;
  if (isActive) {
    state.pins = pins || [];
    state.bookmarks = bookmarks || state.bookmarks;
    state.fullMessages = messages || [];
    renderMessages(messages || []);
  }
  notifyIfNeeded(messages || [], chat, isActive, payload.silent);
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

socket.on("profile:updated", ({ profile }) => {
  state.profile = profile;
  updateProfileCard();
});

socket.on("messages:search", ({ results }) => {
  state.searchResults = results || [];
  renderMessages(state.searchResults);
  setSearchInfo(`${state.searchResults.length} results`);
});

socket.on("group:invite", ({ code }) => {
  inviteDisplay.value = code;
  inviteFeedback.textContent = "Invite created.";
});

socket.on("call:history", (history) => {
  state.callHistory = history || [];
  renderCallHistory();
});

socket.on("stats:update", (stats) => {
  state.stats = stats || {};
  updateAnalytics();
});

socket.on("call:ringing", ({ sessionId, to }) => {
  if (!state.call.pending || (state.call.sessionId && state.call.sessionId !== sessionId)) return;
  state.call.sessionId = sessionId;
  state.call.target = to;
  setCallStatus(`Calling @${to}...`);
});

socket.on("call:incoming", ({ sessionId, from }) => {
  if (state.call.active || state.call.pending) {
    socket.emit("call:reject", { token: state.token, sessionId });
    return;
  }
  state.call.sessionId = sessionId;
  state.call.incomingFrom = from;
  incomingText.textContent = `Incoming call from @${from}`;
  incomingCall.classList.remove("hidden");
  setCallStatus(`Incoming call from @${from}`);
});

socket.on("call:accepted", async ({ sessionId, from }) => {
  if (!state.call.pending) return;
  if (state.call.sessionId && state.call.sessionId !== sessionId) return;
  state.call.sessionId = sessionId;
  state.call.active = true;
  state.call.pending = false;
  state.call.target = from;
  remoteLabel.textContent = `@${from}`;
  shareBtn.textContent = "Share screen";

  const pc = ensurePeer();
  attachLocalTracks(pc);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("call:offer", { token: state.token, sessionId, offer });
  updateCallUi();
});

socket.on("call:rejected", () => {
  showCallNotice("Call rejected.");
  resetCallState();
});

socket.on("call:canceled", () => {
  incomingCall.classList.add("hidden");
  showCallNotice("Call canceled.");
  resetCallState();
});

socket.on("call:ended", () => {
  showCallNotice("Call ended.");
  resetCallState();
});

socket.on("call:offer", async ({ sessionId, offer, from }) => {
  if (state.call.sessionId && state.call.sessionId !== sessionId) return;
  state.call.sessionId = sessionId;
  state.call.target = from;
  remoteLabel.textContent = `@${from}`;
  const pc = ensurePeer();
  attachLocalTracks(pc);

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("call:answer", { token: state.token, sessionId, answer });
  updateCallUi();
});

socket.on("call:answer", async ({ sessionId, answer }) => {
  if (!state.call.sessionId || state.call.sessionId !== sessionId) return;
  if (!state.call.peer) return;
  await state.call.peer.setRemoteDescription(answer);
});

socket.on("call:ice", async ({ sessionId, candidate }) => {
  if (!state.call.sessionId || state.call.sessionId !== sessionId) return;
  if (!state.call.peer) return;
  try {
    await state.call.peer.addIceCandidate(candidate);
  } catch (err) {
    // Ignore invalid ICE candidates
  }
});

socket.on("call:error", ({ message }) => {
  showCallNotice(message);
  resetCallState();
});

socket.on("system:error", ({ message }) => {
  alert(message);
  if (inviteFeedback) inviteFeedback.textContent = message;
});

