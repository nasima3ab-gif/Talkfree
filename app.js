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
const callBtn = document.getElementById("callBtn");
const hangupBtn = document.getElementById("hangupBtn");
const muteBtn = document.getElementById("muteBtn");
const cameraBtn = document.getElementById("cameraBtn");
const videoGrid = document.getElementById("videoGrid");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const remoteLabel = document.getElementById("remoteLabel");
const incomingCall = document.getElementById("incomingCall");
const incomingText = document.getElementById("incomingText");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const rejectCallBtn = document.getElementById("rejectCallBtn");

const state = {
  token: null,
  username: null,
  users: [],
  groups: [],
  activeChat: null,
  typingTimer: null,
  call: {
    sessionId: null,
    target: null,
    peer: null,
    localStream: null,
    isCaller: false,
    active: false,
    pending: false,
    micEnabled: true,
    camEnabled: true,
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
        updateCallUi();
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
  videoGrid.classList.toggle("hidden", !inCall);

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
  stopStream(state.call.localStream);
  state.call.localStream = null;
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  state.call.sessionId = null;
  state.call.target = null;
  state.call.isCaller = false;
  state.call.active = false;
  state.call.pending = false;
  state.call.micEnabled = true;
  state.call.camEnabled = true;
  state.call.incomingFrom = null;
  incomingCall.classList.add("hidden");
  remoteLabel.textContent = "Remote";
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
    if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
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
});

