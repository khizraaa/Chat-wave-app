import { auth, db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-auth.js";
import {
  collection, doc, setDoc, updateDoc, query, where, orderBy, limitToLast,
  onSnapshot, serverTimestamp, writeBatch, increment, deleteField,
  addDoc, deleteDoc, arrayUnion, Timestamp
} from "https://www.gstatic.com/firebasejs/12.3.0/firebase-firestore.js";

const $ = (id) => document.getElementById(id);
const GLOBAL = { id: "global", type: "global", name: "Global Lounge" };
const HEARTBEAT = 3 * 60000, ONLINE_WINDOW = 5 * 60000, EMOJIS = "😀😂🥹😍😊😎🤗😭❤️💜🔥✨🎉🙌👍🙏💯👋💖🌸🥳🤝☕🌙".match(/\p{Extended_Pictographic}\uFE0F?/gu);

let me = null, authMode = "signup", signingUp = false;
let users = new Map(), chats = new Map(), statuses = [];
let active = null, activeChatDoc = {}, replyTo = null, tab = "chats";
let unsubs = { users: null, chats: null, msgs: null, doc: null };
let editing = null, rec = null, recChunks = [], recStart = 0, recTimer = null, recCancel = false;
const audios = new Map(), QUICK = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
let lastTyping = 0, heartbeat = null, toastTimer = null, firstLoad = true;

// ---------- helpers ----------
const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
const initial = (n) => (n || "U").trim().charAt(0).toUpperCase() || "U";
const nameOf = (u) => (u.displayName || u.email?.split("@")[0] || "User").slice(0, 40);
const hue = (n) => [...(n || "U")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 360;
const grad = (n) => `linear-gradient(135deg,hsl(${hue(n)} 55% 52%),#b178ed)`;
const fmtTime = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "");
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function dayLabel(t) {
  const d = new Date(t), today = new Date(), y = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
function friendly(e) {
  const m = {
    "auth/email-already-in-use": "This email already has an account. Please log in.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/network-request-failed": "Network error. Check your internet.",
    "auth/too-many-requests": "Too many attempts. Please wait and retry.",
    "permission-denied": "Access denied. Publish the new firestore.rules in Firebase Console."
  };
  return m[e?.code] || e?.message || "Something went wrong.";
}
const isOnline = (u) => !!u && u.online && Date.now() - ms(u.lastSeen) < ONLINE_WINDOW;
function statusText(u) {
  if (!u) return "";
  if (isOnline(u)) return "Online";
  const t = ms(u.lastSeen);
  return t ? `Last seen ${dayLabel(t).toLowerCase()} at ${fmtTime(t)}` : "Offline";
}
function setAvatar(node, name, on) {
  node.textContent = initial(name); node.style.background = grad(name); node.classList.toggle("on", !!on);
}
const privateId = (a, b) => [a, b].sort().join("_");
const msgCol = (c) => (c.type === "global" ? collection(db, "messages") : collection(db, "chats", c.id, "messages"));
const chatRef = (c) => doc(db, "chats", c.id);

// ---------- theme ----------
const saved = localStorage.getItem("cw-theme");
if (saved) document.documentElement.dataset.theme = saved;
$("themeBtn").onclick = () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next; localStorage.setItem("cw-theme", next);
  document.querySelector('meta[name="theme-color"]').content = next === "light" ? "#ffffff" : "#0b0b12";
};

// ---------- auth ----------
function setAuthMode(mode) {
  authMode = mode; const s = mode === "signup";
  $("signupTab").classList.toggle("active", s); $("loginTab").classList.toggle("active", !s);
  $("authTitle").textContent = s ? "Create your account" : "Welcome back!";
  $("authSubtitle").textContent = s ? "Join the conversation. It starts with you." : "Log in and catch up with your people.";
  $("authSubmitText").textContent = s ? "Create account" : "Log in";
  $("nameField").classList.toggle("hidden", !s);
  $("authError").textContent = "";
}
$("signupTab").onclick = () => setAuthMode("signup");
$("loginTab").onclick = () => setAuthMode("login");

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("authSubmit"); if (btn.disabled) return;
  const email = $("email").value.trim(), pass = $("password").value, name = $("displayName").value.trim();
  if (authMode === "signup" && !name) { $("authError").textContent = "Please enter your name."; return; }
  btn.disabled = true; $("authError").textContent = "";
  try {
    if (authMode === "signup") {
      signingUp = true;
      const r = await createUserWithEmailAndPassword(auth, email, pass);
      await updateProfile(r.user, { displayName: name });
      await saveProfile(r.user);
      toast("Account created. Welcome to ChatWave 💜");
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
  } catch (err) { $("authError").textContent = friendly(err); }
  finally { signingUp = false; btn.disabled = false; }
});

async function logout() { await setPresence(false); await signOut(auth); }
$("logoutBtn").onclick = logout;

// ---------- presence ----------
async function saveProfile(u) {
  try { await setDoc(doc(db, "users", u.uid), { uid: u.uid, name: nameOf(u), online: true, lastSeen: serverTimestamp() }, { merge: true }); }
  catch (e) { console.error("profile", e.code); }
}
async function setPresence(on) {
  if (!me) return;
  try { await setDoc(doc(db, "users", me.uid), { online: on, lastSeen: serverTimestamp() }, { merge: true }); } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (!me) return;
  setPresence(document.visibilityState === "visible");
  if (document.visibilityState === "visible" && active) markRead();
});
addEventListener("pagehide", () => setPresence(false));

onAuthStateChanged(auth, (user) => {
  me = user;
  Object.values(unsubs).forEach((u) => u && u());
  unsubs = { users: null, chats: null, msgs: null, doc: null };
  clearInterval(heartbeat);
  if (!user) {
    $("landing").classList.remove("hidden"); $("authScreen").classList.add("hidden"); $("chatScreen").classList.add("hidden");
    statuses = []; closeStory(); $("statusComposer").classList.add("hidden");
    users.clear(); chats.clear(); active = null; setAuthMode("signup"); return;
  }
  $("authScreen").classList.add("hidden"); $("landing").classList.add("hidden"); $("chatScreen").classList.remove("hidden");
  setAvatar($("myAvatar"), nameOf(user)); $("myName").textContent = nameOf(user);
  if (!signingUp) saveProfile(user);
  heartbeat = setInterval(() => document.visibilityState === "visible" && setPresence(true), HEARTBEAT);
  $("placeholder").classList.remove("hidden"); $("chatView").classList.add("hidden");
  $("chatScreen").classList.remove("in-chat");

  unsubs.users = onSnapshot(collection(db, "users"), (snap) => {
    users = new Map(); snap.forEach((d) => { const v = d.data(); if (v.uid && v.name) users.set(v.uid, v); });
    $("connectionText").textContent = snap.metadata.fromCache ? "Offline" : "Connected";
    renderList(); if (active) renderHeader();
  }, (e) => { $("connectionText").textContent = "Connection problem"; toast(friendly(e)); });

  unsubs.chats = onSnapshot(query(collection(db, "chats"), where("members", "array-contains", user.uid)), (snap) => {
    chats = new Map(); snap.forEach((d) => chats.set(d.id, d.data()));
    renderList();
  }, (e) => toast(friendly(e)));

  // Status updates from the last 24 hours
  const since = Timestamp.fromMillis(Date.now() - 864e5);
  unsubs.status = onSnapshot(query(collection(db, "statuses"), where("createdAt", ">", since)), (snap) => {
    statuses = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .filter((s) => typeof s.uid === "string").sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
    if (tab === "status") renderList();
  }, (e) => console.error("status", e.code));
});

// ---------- sidebar ----------
$("tabChats").onclick = () => { tab = "chats"; syncTabs(); };
$("tabPeople").onclick = () => { tab = "people"; syncTabs(); };
$("tabStatus").onclick = () => { tab = "status"; syncTabs(); };
$("searchInput").addEventListener("input", renderList);
function syncTabs() {
  $("tabChats").classList.toggle("active", tab === "chats");
  $("tabPeople").classList.toggle("active", tab === "people");
  $("tabStatus").classList.toggle("active", tab === "status");
  renderList();
}
function listItem({ name, avatarName, sub, time, badge, on, isGlobal, ring, activeNow, onClick }) {
  const b = el("button", "item" + (activeNow ? " active" : "")); b.type = "button";
  const av = el("div", "avatar"); if (isGlobal) { av.textContent = "✦"; av.style.background = "linear-gradient(135deg,#8058eb,#c078ed)"; } else setAvatar(av, avatarName || name, on);
  if (ring) av.className += " " + ring;
  const info = el("div", "grow"), top = el("div", "top");
  top.append(el("strong", "", name), el("time", "", time || ""));
  info.append(top, el("span", "prev", sub || ""));
  b.append(av, info);
  if (badge) b.append(el("span", "badge", badge > 99 ? "99+" : badge));
  b.onclick = onClick; return b;
}
function renderList() {
  if (!me) return;
  const box = $("chatList"), q = $("searchInput").value.trim().toLowerCase();
  box.replaceChildren();
  const others = [...users.values()].filter((u) => u.uid !== me.uid && u.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name));
  const open = (u) => openChat({ id: privateId(me.uid, u.uid), type: "private", uid: u.uid, name: u.name });

  if (tab === "status") { renderStatusList(box, q); return; }
  if (tab === "people") {
    if (!others.length) box.append(el("p", "note", "No members found."));
    others.forEach((u) => box.append(listItem({
      name: u.name, sub: statusText(u), on: isOnline(u),
      activeNow: active?.uid === u.uid, onClick: () => open(u)
    })));
    return;
  }
  if ("global lounge".includes(q)) box.append(listItem({
    name: "Global Lounge", sub: "Everyone can join", isGlobal: true,
    activeNow: active?.type === "global", onClick: () => openChat(GLOBAL)
  }));
  const rows = [...chats.entries()].map(([id, c]) => {
    const otherUid = (c.members || []).find((m) => m !== me.uid), u = users.get(otherUid);
    return u && { id, c, u };
  }).filter((r) => r && r.u.name.toLowerCase().includes(q))
    .sort((a, b) => ms(b.c.lastMessageAt) - ms(a.c.lastMessageAt));
  rows.forEach(({ c, u }) => {
    const mine = c.lastMessage?.uid === me.uid;
    box.append(listItem({
      name: u.name, on: isOnline(u), badge: c.unread?.[me.uid] || 0,
      sub: c.lastMessage ? (mine ? "You: " : "") + c.lastMessage.text : "",
      time: c.lastMessageAt ? fmtTime(ms(c.lastMessageAt)) : "",
      activeNow: active?.uid === u.uid, onClick: () => open(u)
    }));
  });
  if (!rows.length && !q) box.append(el("p", "note", "No chats yet. Open the People tab and say hello 👋"));
}

// ---------- open chat ----------
function openChat(chat) {
  active = chat; activeChatDoc = {}; replyTo = null; editing = null; firstLoad = true;
  audios.forEach((a) => a.pause()); audios.clear();
  $("replyBar").classList.add("hidden"); $("emojiPicker").classList.add("hidden"); $("sendError").textContent = "";
  $("placeholder").classList.add("hidden"); $("chatView").classList.remove("hidden");
  $("chatScreen").classList.add("in-chat");
  $("messageInput").placeholder = chat.type === "global" ? "Message everyone" : `Message ${chat.name}`;
  renderHeader(); renderList();

  unsubs.msgs && unsubs.msgs(); unsubs.doc && unsubs.doc();
  if (chat.type === "private") {
    unsubs.doc = onSnapshot(chatRef(chat), (s) => { activeChatDoc = s.data() || {}; renderHeader(); renderMessages(lastSnap); markRead(); },
      (e) => console.error("chat doc", e.code));
  }
  const qy = query(msgCol(chat), orderBy("createdAt", "asc"), limitToLast(150));
  unsubs.msgs = onSnapshot(qy, (snap) => { if (active?.id !== chat.id) return; lastSnap = snap; renderMessages(snap); markRead(); },
    (e) => { $("messages").replaceChildren(); const d = el("div", "empty"); d.append(el("h3", "", "Couldn't load chat"), el("p", "", friendly(e))); $("messages").append(d); });
}
let lastSnap = null;
$("backBtn").onclick = () => { $("chatScreen").classList.remove("in-chat"); active = null; renderList(); };

function renderHeader() {
  if (!active) return;
  const g = active.type === "global";
  $("headTitle").textContent = active.name;
  if (g) { $("headAvatar").textContent = "✦"; $("headAvatar").style.background = "linear-gradient(135deg,#8058eb,#c078ed)"; $("headAvatar").classList.remove("on"); $("headSub").textContent = `${users.size} members`; return; }
  const u = users.get(active.uid), typing = Date.now() - (activeChatDoc.typing?.[active.uid] || 0) < 4000;
  setAvatar($("headAvatar"), active.name, isOnline(u));
  $("headSub").textContent = typing ? "typing…" : statusText(u);
  if (typing) setTimeout(renderHeader, 4200);
}

async function markRead() {
  if (!me || !active || active.type !== "private" || document.visibilityState !== "visible") return;
  const unread = activeChatDoc.unread?.[me.uid] || 0;
  const lr = ms(activeChatDoc.lastRead?.[me.uid]);
  const lastIn = lastSnap?.docs.map((d) => d.data({ serverTimestamps: "estimate" })).filter((m) => m.uid !== me.uid).pop();
  if (!unread && !(lastIn && ms(lastIn.createdAt) > lr)) return;
  try {
    await setDoc(chatRef(active), { type: "private", members: [me.uid, active.uid], unread: { [me.uid]: 0 }, lastRead: { [me.uid]: serverTimestamp() } }, { merge: true });
  } catch (e) { console.error("markRead", e.code); }
}

// ---------- messages ----------
function tickFor(m, d) {
  if (d.metadata.hasPendingWrites) return "🕓";
  if (active.type !== "private") return "✓";
  const other = users.get(active.uid), t = ms(m.createdAt);
  if (ms(activeChatDoc.lastRead?.[active.uid]) >= t) return "✓✓read";
  return isOnline(other) || ms(other?.lastSeen) >= t ? "✓✓" : "✓";
}
function thumb(url) { return url.includes("/image/upload/") ? url.replace("/upload/", "/upload/w_600,c_limit,q_auto,f_auto/") : url; }

function renderMessages(snap) {
  if (!snap || !active) return;
  const box = $("messages");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  box.replaceChildren();
  if (snap.empty) {
    const d = el("div", "empty"); d.append(el("div", "empty-icon", "✦"), el("h3", "", "No messages yet"), el("p", "", "Say hello! 👋")); box.append(d); return;
  }
  let lastDay = "";
  snap.docs.forEach((d) => {
    const m = d.data({ serverTimestamps: "estimate" });
    if (typeof m.uid !== "string" || typeof m.name !== "string") return;
    const t = ms(m.createdAt) || Date.now(), day = new Date(t).toDateString();
    if (day !== lastDay) { box.append(el("div", "day", dayLabel(t))); lastDay = day; }
    const mine = m.uid === me.uid;
    const row = el("div", "row" + (mine ? " mine" : "")), b = el("div", "bubble");
    if (!mine && active.type === "global") b.append(el("span", "who", m.name));
    if (m.deleted) {
      b.append(el("span", "txt gone", "🚫 This message was deleted"));
    } else {
      if (m.reply) { const q = el("div", "quote"); q.append(el("b", "", m.reply.name), document.createTextNode(m.reply.text)); b.append(q); }
      if (m.image) { const img = el("img", "pic"); img.src = thumb(m.image); img.alt = "Photo"; img.loading = "lazy"; img.onclick = () => openLightbox(m.image); b.append(img); }
      if (m.audio) b.append(audioPlayer(d.id, m.audio));
      if (m.text) b.append(el("span", "txt", m.text));
    }
    const meta = el("span", "meta", (m.edited && !m.deleted ? "edited · " : "") + fmtTime(t));
    if (mine && !m.deleted) { const tk = tickFor(m, d); const s = el("span", "tick" + (tk.endsWith("read") ? " read" : ""), " " + tk.replace("read", "")); meta.append(s); }
    b.append(meta);
    if (m.reactions && !m.deleted) {
      const counts = {}; Object.values(m.reactions).forEach((e) => (counts[e] = (counts[e] || 0) + 1));
      const rr = el("div", "reacts");
      Object.entries(counts).forEach(([e, n]) => {
        const c = el("button", "react" + (m.reactions[me.uid] === e ? " mine" : ""), n > 1 ? `${e} ${n}` : e);
        c.type = "button"; c.onclick = () => react(d.id, m, e); rr.append(c);
      });
      b.append(rr);
    }
    if (!m.deleted) {
      b.oncontextmenu = (e) => { e.preventDefault(); showMenu(e.clientX, e.clientY, d.id, m, mine); };
      let press; b.ontouchstart = (e) => { const p = e.touches[0]; press = setTimeout(() => showMenu(p.clientX, p.clientY, d.id, m, mine), 450); };
      b.ontouchend = b.ontouchmove = () => clearTimeout(press);
      b.ondblclick = () => startReply(m);
    }
    row.append(b); box.append(row);
  });
  if (firstLoad || nearBottom) { box.scrollTop = box.scrollHeight; $("downBtn").classList.add("hidden"); firstLoad = false; }
}
$("messages").addEventListener("scroll", () => {
  const b = $("messages"); $("downBtn").classList.toggle("hidden", b.scrollHeight - b.scrollTop - b.clientHeight < 240);
});
$("downBtn").onclick = () => { const b = $("messages"); b.scrollTo({ top: b.scrollHeight, behavior: "smooth" }); };

// ---------- message menu, reply, delete ----------
function showMenu(x, y, id, m, mine) {
  const menu = $("menu"); menu.replaceChildren();
  const add = (label, fn) => { const b = el("button", "", label); b.onclick = () => { menu.classList.add("hidden"); fn(); }; menu.append(b); };
  const rr = el("div", "react-row");
  QUICK.forEach((e) => { const b = el("button", "", e); b.onclick = () => { menu.classList.add("hidden"); react(id, m, e); }; rr.append(b); });
  menu.append(rr);
  add("↩ Reply", () => startReply(m));
  if (m.text) add("⧉ Copy", () => navigator.clipboard?.writeText(m.text).then(() => toast("Copied")));
  if (mine && m.text && !m.audio) add("✎ Edit", () => startEdit(id, m));
  if (mine) add("🗑 Delete for everyone", async () => {
    try { await updateDoc(doc(msgCol(active), id), { deleted: true, text: "", image: null }); } catch (e) { toast(friendly(e)); }
  });
  menu.classList.remove("hidden");
  menu.style.left = Math.min(x, innerWidth - 200) + "px"; menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 10) + "px";
}
document.addEventListener("click", (e) => {
  if (!$("menu").contains(e.target)) $("menu").classList.add("hidden");
  if (!$("emojiPicker").contains(e.target) && !$("emojiBtn").contains(e.target)) $("emojiPicker").classList.add("hidden");
});
function startReply(m) {
  replyTo = { name: m.uid === me.uid ? "You" : m.name, text: (m.text || "📷 Photo").slice(0, 100) };
  $("replyName").textContent = replyTo.name; $("replyText").textContent = replyTo.text;
  $("replyBar").classList.remove("hidden"); $("messageInput").focus();
}
function cancelReplyEdit() {
  if (editing) $("messageInput").value = "";
  replyTo = null; editing = null; $("replyBar").classList.add("hidden");
}
$("replyClose").onclick = cancelReplyEdit;
function startEdit(id, m) {
  replyTo = null; editing = { id };
  $("replyName").textContent = "Editing message"; $("replyText").textContent = m.text;
  $("replyBar").classList.remove("hidden"); $("messageInput").value = m.text; $("messageInput").focus();
}
async function react(id, m, emoji) {
  const same = m.reactions?.[me.uid] === emoji;
  try { await updateDoc(doc(msgCol(active), id), { [`reactions.${me.uid}`]: same ? deleteField() : emoji }); }
  catch (e) { toast(friendly(e)); }
}
function fmtDur(s) { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function audioPlayer(id, a) {
  const w = el("div", "audio"), btn = el("button", "play", "▶"), bar = el("input"), time = el("span", "", fmtDur(a.dur));
  btn.type = "button"; bar.type = "range"; bar.min = 0; bar.max = 1000; bar.value = 0; bar.setAttribute("aria-label", "Seek");
  let au = audios.get(id); if (!au) { au = new Audio(a.url); au.preload = "none"; audios.set(id, au); }
  const total = () => (isFinite(au.duration) && au.duration > 0 ? au.duration : a.dur || 1);
  const sync = () => { bar.value = (au.currentTime / total()) * 1000; time.textContent = fmtDur(au.paused && !au.currentTime ? a.dur : au.currentTime); btn.textContent = au.paused ? "▶" : "⏸"; };
  au.ontimeupdate = au.onpause = au.onplay = au.onended = sync; sync();
  btn.onclick = () => { if (au.paused) { audios.forEach((o) => o !== au && o.pause()); au.play(); } else au.pause(); };
  bar.oninput = () => { au.currentTime = (bar.value / 1000) * total(); };
  w.append(btn, bar, time); return w;
}
function openLightbox(url) { $("lightbox").querySelector("img").src = url; $("lightbox").classList.remove("hidden"); }
$("lightbox").onclick = () => $("lightbox").classList.add("hidden");

// ---------- sending ----------
async function send({ text = "", image = null, audio = null }) {
  const chat = active; if (!chat || !me) return;
  const data = { text, uid: me.uid, name: nameOf(me), createdAt: serverTimestamp() };
  if (image) data.image = image;
  if (audio) data.audio = audio;
  if (replyTo) data.reply = replyTo;
  const ref = doc(msgCol(chat));
  if (chat.type === "global") { await setDoc(ref, data); }
  else {
    const b = writeBatch(db);
    b.set(ref, data);
    b.set(chatRef(chat), {
      type: "private", members: [me.uid, chat.uid],
      lastMessage: { text: text || (audio ? "🎤 Voice message" : "📷 Photo"), uid: me.uid }, lastMessageAt: serverTimestamp(),
      unread: { [chat.uid]: increment(1) }, typing: { [me.uid]: 0 }
    }, { merge: true });
    await b.commit();
  }
  replyTo = null; $("replyBar").classList.add("hidden");
}
$("messageForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("messageInput").value.trim(); if (!text || !active) return;
  $("sendBtn").disabled = true; $("sendError").textContent = "";
  try {
    if (editing) {
      await updateDoc(doc(msgCol(active), editing.id), { text, edited: true });
      cancelReplyEdit();
    } else { await send({ text }); $("messageInput").value = ""; }
    $("messageInput").focus();
  }
  catch (err) { $("sendError").textContent = friendly(err); }
  finally { $("sendBtn").disabled = false; }
});
$("messageInput").addEventListener("input", () => {
  if (!active || active.type !== "private" || Date.now() - lastTyping < 2500) return;
  lastTyping = Date.now();
  setDoc(chatRef(active), { type: "private", members: [me.uid, active.uid], typing: { [me.uid]: Date.now() } }, { merge: true }).catch(() => {});
});

// ---------- photos (Cloudinary) ----------
$("attachBtn").onclick = () => $("fileInput").click();
$("fileInput").addEventListener("change", async () => {
  const file = $("fileInput").files[0]; $("fileInput").value = "";
  if (!file || !active) return;
  if (file.size > 10 * 1024 * 1024) { toast("Photo must be under 10 MB."); return; }
  toast("Uploading photo…");
  try {
    const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
    const json = await res.json();
    if (!json.secure_url) throw new Error(json.error?.message || "Upload failed");
    await send({ image: json.secure_url });
  } catch (err) { toast("Photo failed: " + friendly(err)); }
});

// ---------- emoji ----------
EMOJIS.forEach((em) => { const b = el("button", "", em); b.type = "button"; $("emojiPicker").append(b); });
$("emojiBtn").onclick = () => $("emojiPicker").classList.toggle("hidden");
$("emojiPicker").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const i = $("messageInput"), s = i.selectionStart ?? i.value.length, en = i.selectionEnd ?? s;
  i.value = i.value.slice(0, s) + b.textContent + i.value.slice(en); i.focus();
  i.setSelectionRange(s + b.textContent.length, s + b.textContent.length);
});

// ---------- voice notes ----------
const idlePlaceholder = () => (active ? (active.type === "global" ? "Message everyone" : `Message ${active.name}`) : "Type a message");
async function uploadAudio(blob) {
  const fd = new FormData(); fd.append("file", blob, "voice"); fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`, { method: "POST", body: fd });
  const json = await res.json();
  if (!json.secure_url) throw new Error(json.error?.message || "Upload failed");
  return json.secure_url;
}
$("micBtn").onclick = async () => {
  if (rec) { rec.stop(); return; }
  if (!active) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Voice notes are not supported in this browser."); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = (rec = new MediaRecorder(stream)); recChunks = []; recCancel = false; recStart = Date.now();
    r.ondataavailable = (e) => e.data.size && recChunks.push(e.data);
    r.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop()); clearInterval(recTimer);
      const dur = Math.round((Date.now() - recStart) / 1000), type = r.mimeType || "audio/webm";
      rec = null; $("micBtn").classList.remove("rec"); $("messageInput").placeholder = idlePlaceholder();
      if (recCancel || dur < 1) return;
      toast("Sending voice note…");
      try { await send({ audio: { url: await uploadAudio(new Blob(recChunks, { type })), dur } }); }
      catch (err) { toast("Voice note failed: " + friendly(err)); }
    };
    r.start(); $("micBtn").classList.add("rec");
    recTimer = setInterval(() => { $("messageInput").placeholder = `● Recording ${fmtDur((Date.now() - recStart) / 1000)} · tap 🎤 to send, Esc to cancel`; }, 300);
  } catch { rec = null; toast("Microphone permission denied."); }
};
addEventListener("keydown", (e) => { if (e.key === "Escape" && rec) { recCancel = true; rec.stop(); } });

// ---------- landing page ----------
document.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => {
  setAuthMode(b.dataset.open);
  $("landing").classList.add("hidden"); $("authScreen").classList.remove("hidden"); scrollTo(0, 0);
}));
$("authBack").onclick = () => { $("authScreen").classList.add("hidden"); $("landing").classList.remove("hidden"); };

// ---------- status (24 hours) ----------
const BGS = ["linear-gradient(135deg,#7050c9,#b178ed)", "linear-gradient(135deg,#0ea5a4,#3b82f6)", "linear-gradient(135deg,#f97316,#ec4899)",
  "linear-gradient(135deg,#16a34a,#84cc16)", "linear-gradient(135deg,#334155,#0f172a)", "linear-gradient(135deg,#e11d48,#f59e0b)"];
let scBg = 0, scFile = null, sv = null, svTimer = null;

function renderStatusList(box, q) {
  const mine = statuses.filter((s) => s.uid === me.uid), last = mine[mine.length - 1];
  box.append(listItem({
    name: "My status", avatarName: nameOf(me), ring: last ? "ring" : "",
    sub: last ? `${mine.length} update${mine.length > 1 ? "s" : ""} · ${fmtTime(ms(last.createdAt))}` : "Tap to add a status update",
    onClick: () => (last ? viewStatus(me.uid) : openComposer())
  }));
  box.append(listItem({ name: "Add status", sub: "Text or photo · disappears in 24 hours", isGlobal: true, onClick: openComposer }));

  const groups = new Map();
  statuses.forEach((s) => { if (s.uid !== me.uid) groups.set(s.uid, [...(groups.get(s.uid) || []), s]); });
  const rows = [...groups.entries()].filter(([, a]) => (a[0].name || "").toLowerCase().includes(q))
    .sort((a, b) => ms(b[1].at(-1).createdAt) - ms(a[1].at(-1).createdAt));
  if (rows.length) box.append(el("p", "note", "Recent updates"));
  rows.forEach(([uid, a]) => {
    const unseen = a.some((s) => !(s.viewers || []).includes(me.uid)), l = a.at(-1);
    box.append(listItem({
      name: a[0].name, ring: unseen ? "ring" : "ring seen",
      sub: `${dayLabel(ms(l.createdAt))}, ${fmtTime(ms(l.createdAt))}`, onClick: () => viewStatus(uid)
    }));
  });
  if (!rows.length && !q) box.append(el("p", "note", "No updates from other people yet."));
}

// --- composer ---
BGS.forEach((g, i) => {
  const b = el("button", "sw"); b.type = "button"; b.style.background = g; b.setAttribute("aria-label", "Background " + (i + 1));
  b.onclick = () => { scBg = i; paintComposer(); }; $("scColors").append(b);
});
function paintComposer() { $("scCard").style.background = scFile ? "#111" : BGS[scBg]; $("scCard").classList.toggle("hasimg", !!scFile); }
function openComposer() {
  scFile = null; scBg = 0; $("scText").value = ""; $("scPreview").replaceChildren(); $("scPreview").classList.add("hidden");
  paintComposer(); $("statusComposer").classList.remove("hidden"); $("scText").focus();
}
const closeComposer = () => $("statusComposer").classList.add("hidden");
$("scClose").onclick = closeComposer;
$("scPhoto").onclick = () => $("scFile").click();
$("scFile").addEventListener("change", () => {
  const f = $("scFile").files[0]; $("scFile").value = ""; if (!f) return;
  if (f.size > 10 * 1024 * 1024) { toast("Photo must be under 10 MB."); return; }
  scFile = f; const img = el("img"); img.src = URL.createObjectURL(f); img.alt = "Preview";
  $("scPreview").replaceChildren(img); $("scPreview").classList.remove("hidden");
  $("scText").placeholder = "Add a caption"; paintComposer();
});
async function uploadImage(file) {
  const fd = new FormData(); fd.append("file", file); fd.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, { method: "POST", body: fd });
  const json = await res.json();
  if (!json.secure_url) throw new Error(json.error?.message || "Upload failed");
  return json.secure_url;
}
$("scPost").onclick = async () => {
  const text = $("scText").value.trim();
  if (!text && !scFile) { toast("Write something or add a photo."); return; }
  $("scPost").disabled = true;
  try {
    const data = { uid: me.uid, name: nameOf(me), kind: scFile ? "image" : "text", text, bg: scBg, viewers: [], createdAt: serverTimestamp() };
    if (scFile) data.image = await uploadImage(scFile);
    await addDoc(collection(db, "statuses"), data);
    closeComposer(); toast("Status posted");
  } catch (e) { toast(friendly(e)); }
  finally { $("scPost").disabled = false; }
};

// --- viewer ---
function viewStatus(uid) {
  const items = statuses.filter((s) => s.uid === uid); if (!items.length) return;
  const firstNew = items.findIndex((s) => !(s.viewers || []).includes(me.uid));
  sv = { items, i: uid === me.uid ? 0 : Math.max(0, firstNew) };
  $("statusViewer").classList.remove("hidden"); showStory();
}
function closeStory() { clearTimeout(svTimer); sv = null; $("statusViewer").classList.add("hidden"); }
function showStory() {
  clearTimeout(svTimer);
  const s = sv?.items[sv.i]; if (!s) { closeStory(); return; }
  const mine = s.uid === me.uid;
  $("svBars").replaceChildren(...sv.items.map((_, k) => {
    const bar = el("div", "bar" + (k < sv.i ? " done" : k === sv.i ? " cur" : "")); bar.append(document.createElement("i")); return bar;
  }));
  setAvatar($("svAv"), s.name); $("svName").textContent = mine ? "My status" : s.name;
  $("svTime").textContent = `${dayLabel(ms(s.createdAt))}, ${fmtTime(ms(s.createdAt))}`;
  $("svDel").classList.toggle("hidden", !mine);
  $("svSeen").textContent = mine ? `👁 Seen by ${(s.viewers || []).length}` : "";
  const stage = $("svStage"); stage.replaceChildren();
  if (s.kind === "image" && s.image) {
    const img = el("img"); img.src = thumb(s.image).replace("w_600", "w_900"); img.alt = "Status photo"; stage.append(img);
    if (s.text) stage.append(el("div", "sv-cap", s.text));
  } else {
    const t = el("div", "sv-text", s.text); t.style.background = BGS[s.bg] || BGS[0]; stage.append(t);
  }
  if (!mine && !(s.viewers || []).includes(me.uid)) {
    updateDoc(doc(db, "statuses", s.id), { viewers: arrayUnion(me.uid) }).catch(() => {});
    s.viewers = [...(s.viewers || []), me.uid];
  }
  svTimer = setTimeout(() => { sv.i++; showStory(); }, 5000);
}
$("svNext").onclick = () => { if (sv) { sv.i++; showStory(); } };
$("svPrev").onclick = () => { if (sv) { sv.i = Math.max(0, sv.i - 1); showStory(); } };
$("svClose").onclick = closeStory;
$("svDel").onclick = async () => {
  const s = sv?.items[sv.i]; if (!s || !confirm("Delete this status?")) return;
  try { await deleteDoc(doc(db, "statuses", s.id)); closeStory(); toast("Status deleted"); } catch (e) { toast(friendly(e)); }
};
addEventListener("keydown", (e) => {
  if (!sv) return;
  if (e.key === "Escape") closeStory(); else if (e.key === "ArrowRight") $("svNext").click(); else if (e.key === "ArrowLeft") $("svPrev").click();
});