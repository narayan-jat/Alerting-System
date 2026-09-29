import {
  app as firebaseApp, db, readPgId, dateKey, timeAgo, el, visual, toast, renderMessage, registerSW, installBanner,
} from "./common.js";
import {
  doc, collection, query, where, onSnapshot, getDoc, updateDoc, setDoc, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const SPEAK_EVERY_MS = 30000;
const FIRST_SPEAK_AFTER_MS = 3000;
const FORGOTTEN_AFTER_MS = 10 * 60 * 1000;
const CHECK_IN_EVERY_MS = 10 * 60 * 1000;
const VIBRATE_EVERY_MS = 3000;
const LEAVE_DAYS = [1, 2, 3];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const app = document.getElementById("app");
const pgId = readPgId("kitchenPg");

// Inside the Khana Kitchen Android app (Capacitor), sound, voice and push go through native code.
const cap = window.Capacitor;
const inApp = cap?.isNativePlatform?.() === true;
const callNative = (method, options = {}) =>
  cap.Plugins?.KitchenAlarm?.[method]
    ? cap.Plugins.KitchenAlarm[method](options)
    : cap.nativePromise("KitchenAlarm", method, options);
let nativeSpeakUntil = 0;
let phone = null; // native permission status
let showPhoneSetup = false;

let audio = null;
let active = [];
const lastStatus = new Map();
let lastSpoke = 0;
let watchedDate = null;
let unwatch = null;
let soundLocked = false;
let alarmWasOn = false;

// Items this phone said "Aa raha hoon" for. Other phones hide those cards.
const ACK_KEY = "kitchenAcks";
let acks = new Set();
try { acks = new Set(JSON.parse(localStorage.getItem(ACK_KEY)) || []); } catch {}
const saveAcks = () => {
  const today = dateKey();
  acks = new Set([...acks].filter((id) => id.startsWith(today)));
  try { localStorage.setItem(ACK_KEY, JSON.stringify([...acks])); } catch {}
};

const isForgotten = (a) => Date.now() - (a.comingAt?.toMillis() || Date.now()) > FORGOTTEN_AFTER_MS;
const isVisible = (a) => a.status === "reported" || acks.has(a.id) || isForgotten(a);

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};
const DUTY_KEY = "kitchenDuty";
const dutySaved = store.get(DUTY_KEY) === "1";

// This phone's entry in the setup page's "Kitchen phones" list.
const newPhoneId = () => [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
let phoneId = store.get("kitchenPhoneId") || newPhoneId();
store.set("kitchenPhoneId", phoneId);
let myName = store.get("kitchenName") || "";
let me = null; // this phone's kitchenPhones doc
let showLeavePicker = false;
let lastVibrate = 0;
const phoneRef = () => doc(db, "pgs", pgId, "kitchenPhones", phoneId);
const isOnLeave = () => !!me?.offUntil && me.offUntil.toMillis() > Date.now();

if (!pgId) {
  renderCodeEntry();
} else {
  if (!inApp) {
    registerSW();
    installBanner("kitchen", "Kitchen app install karo");
  }
  if (dutySaved && myName) startDuty(false);
  else renderStart();
}

function renderStart() {
  const nameInput = el("input", { class: "code-input", placeholder: "Aapka naam (jaise: Raju)", maxlength: "30", value: myName, autocomplete: "name" });
  app.replaceChildren(
    el("form", { class: "msg", onsubmit: (e) => {
      e.preventDefault();
      const name = nameInput.value.trim();
      if (!name) return toast("Apna naam daalo");
      myName = name;
      store.set("kitchenName", name);
      startDuty(true);
    } },
      el("div", { class: "msg-icon" }, "👨‍🍳"),
      el("h1", {}, "Kitchen"),
      el("p", { class: "hint" }, "Owner ko pata rahega kaun duty par hai"),
      nameInput,
      el("button", { class: "btn big primary", type: "submit" }, "▶ Duty shuru karo"),
      el("p", { class: "hint" }, "Phone ki awaaz (volume) poori rakho")));
}

async function registerPhone() {
  const platform = inApp ? "android" : "web";
  let snap = await getDoc(phoneRef());
  if (snap.exists() && snap.data().gone) {
    // Marked uninstalled earlier (e.g. notifications were off): start a fresh entry.
    phoneId = newPhoneId();
    store.set("kitchenPhoneId", phoneId);
    snap = null;
  }
  if (snap?.exists()) {
    await updateDoc(phoneRef(), { name: myName, platform, lastSeen: serverTimestamp() });
  } else {
    await setDoc(phoneRef(), { name: myName, platform, lastSeen: serverTimestamp(), offUntil: null, createdAt: serverTimestamp() });
  }
  onSnapshot(phoneRef(), (s) => { me = s.data() || null; render(); });
  setInterval(() => updateDoc(phoneRef(), { lastSeen: serverTimestamp() }).catch(() => {}), CHECK_IN_EVERY_MS);
  if (inApp) await callNative("setIdentity", { pg: pgId, phoneId }).catch(() => {});
}

function setLeave(days) {
  showLeavePicker = false;
  const offUntil = days ? Timestamp.fromMillis(Date.now() + days * 864e5) : null;
  updateDoc(phoneRef(), { offUntil })
    .then(() => toast(days ? `😴 ${days} din ki chhutti lag gayi` : "✅ Duty wapas shuru"))
    .catch(() => toast("⚠️ Net check karo"));
  render();
}

function fmtUntil(ts) {
  const d = ts.toDate();
  const h = d.getHours();
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function renderCodeEntry() {
  const input = el("input", { class: "code-input", placeholder: "Kitchen link ya code", autocomplete: "off", autocapitalize: "off" });
  app.replaceChildren(
    el("form", { class: "msg", onsubmit: (e) => {
      e.preventDefault();
      const code = input.value.match(/[a-f0-9]{16}/i)?.[0];
      if (!code) return toast("Code sahi nahi hai");
      location.href = `kitchen.html?pg=${code.toLowerCase()}`;
    } },
      el("div", { class: "msg-icon" }, "🔗"),
      el("h1", {}, "Kitchen se judo"),
      el("p", { class: "hint" }, "Setup page par 'Kitchen code' dekho aur yahan daalo"),
      input,
      el("button", { class: "btn big primary", type: "submit" }, "Judo")));
}

// fromTap = the one-time "Duty shuru karo" tap. Later visits start automatically, but
// browsers keep sound blocked until the screen is touched once, so we ask for one tap.
function startDuty(fromTap) {
  const canNotify = "Notification" in window;
  let permission = null;
  if (fromTap) {
    store.set(DUTY_KEY, "1");
    if (canNotify) permission = Notification.requestPermission();
  } else if (canNotify && Notification.permission === "granted") {
    permission = Promise.resolve("granted");
  }
  audio = new (window.AudioContext || window.webkitAudioContext)();
  if (fromTap) speak(" ");
  else waitForFirstTouch(canNotify && Notification.permission === "default");
  keepAwake();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { keepAwake(); audio.resume(); checkPhone(); }
  });
  checkPhone();
  watch();
  setInterval(tick, 1000);
  setInterval(render, 30000);
  // The push token is saved with this phone's id, so register the phone first.
  registerPhone()
    .catch((e) => console.warn("Phone register failed", e))
    .then(() => setupPush(permission));
  render();
}

function waitForFirstTouch(askNotify) {
  audio.resume().catch(() => {});
  setTimeout(() => {
    if (audio.state !== "running") { soundLocked = true; render(); }
  }, 400);
  const unlock = () => {
    document.removeEventListener("pointerdown", unlock, true);
    audio.resume();
    speak(" ");
    soundLocked = false;
    render();
    if (askNotify) setupPush(Notification.requestPermission());
  };
  document.addEventListener("pointerdown", unlock, true);
}

function watch() {
  const today = dateKey();
  if (today === watchedDate) return;
  watchedDate = today;
  unwatch?.();
  unwatch = onSnapshot(query(collection(db, "pgs", pgId, "alerts"), where("date", "==", today)), (snap) => {
    active = snap.docs
      .map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
      .filter((a) => a.status === "reported" || a.status === "coming")
      .sort((a, b) => (a.reportedAt?.toMillis() || 0) - (b.reportedAt?.toMillis() || 0));

    for (const a of active) {
      if (a.status === "reported" && lastStatus.get(a.id) !== "reported") {
        lastSpoke = Date.now() - SPEAK_EVERY_MS + FIRST_SPEAK_AFTER_MS;
        lastVibrate = 0;
      }
    }
    lastStatus.clear();
    for (const d of snap.docs) lastStatus.set(d.id, d.data().status);
    render();
  });
}

function tick() {
  watch();
  const due = isOnLeave() ? [] : active.filter((a) => a.status === "reported");
  document.body.classList.toggle("alarm", due.length > 0);
  if (!due.length) {
    // Someone acknowledged on another phone: cut off a sentence mid-way too.
    if (alarmWasOn) stopSpeaking();
    alarmWasOn = false;
    return;
  }
  alarmWasOn = true;
  if (audio.state === "suspended") audio.resume();
  if (Date.now() - lastVibrate >= VIBRATE_EVERY_MS) {
    lastVibrate = Date.now();
    navigator.vibrate?.([700, 300, 700, 300, 700]);
  }

  const speaking = inApp ? Date.now() < nativeSpeakUntil : window.speechSynthesis?.speaking;
  if (speaking) return;
  if (Date.now() - lastSpoke >= SPEAK_EVERY_MS) {
    lastSpoke = Date.now();
    speak(due.map((a) => a.say).join("। "));
  } else {
    beep();
  }
}

function render() {
  if (!audio) return;
  const onLeave = isOnLeave();
  const bar = el("header", { class: "kbar" },
    el("span", { class: "status" },
      el("i", { class: onLeave ? "dot off" : "dot" }),
      `${myName || "Kitchen"} · ${onLeave ? "Chhutti" : "Duty on"}`),
    el("span", { class: "kbar-btns" },
      inApp ? el("button", { class: "btn small", type: "button", onclick: () => { showPhoneSetup = !showPhoneSetup; render(); } }, "⚙️") : null,
      onLeave || !me ? null : el("button", { class: "btn small", type: "button", onclick: () => { showLeavePicker = !showLeavePicker; render(); } }, "😴"),
      el("button", { class: "btn small", type: "button", onclick: testSound }, "🔊")));

  if (onLeave) {
    return app.replaceChildren(bar,
      el("div", { class: "msg" },
        el("div", { class: "msg-icon" }, "😴"),
        el("h1", {}, "Chhutti par ho"),
        el("p", { class: "hint" }, `${fmtUntil(me.offUntil)} tak is phone par alarm nahi bajega`),
        el("button", { class: "btn big primary", type: "button", onclick: () => setLeave(0) }, "▶ Duty wapas shuru karo")));
  }

  const leavePicker = showLeavePicker
    ? el("section", { class: "phone-setup" },
        el("b", {}, "😴 Kitni chhutti chahiye?"),
        el("p", {}, "Itne din is phone par alarm nahi bajega. Owner ko dikhega."),
        el("div", { class: "leave-btns" },
          LEAVE_DAYS.map((n) => el("button", { class: "btn", type: "button", onclick: () => setLeave(n) }, `${n} din`))),
        el("button", { class: "btn ghost", type: "button", onclick: () => { showLeavePicker = false; render(); } }, "Wapas"))
    : null;
  const lock = soundLocked
    ? el("button", { class: "unlock", type: "button" }, "🔇 Awaaz band hai · screen par kahin bhi tap karo")
    : leavePicker ?? phoneSetupCard();

  const visible = active.filter(isVisible);
  const hiddenCount = active.length - visible.length;
  const othersNote = hiddenCount
    ? el("p", { class: "hint others" }, `🏃 ${hiddenCount} item koi aur la raha hai`)
    : null;

  if (!visible.length) {
    return app.replaceChildren(bar, lock ?? "",
      el("div", { class: "msg" },
        el("div", { class: "msg-icon ok-icon" }, "✅"),
        el("h1", {}, "Sab theek hai"),
        el("p", { class: "hint" }, "Kuch khatam hoga to yahan awaaz aayegi"),
        othersNote));
  }
  app.replaceChildren(bar, lock ?? "", ...visible.map(card), othersNote ?? "");
}

function card(a) {
  const coming = a.status === "coming";
  const meta = !coming ? `⏱ ${timeAgo(a.reportedAt)}`
    : acks.has(a.id) ? "🏃 Tum la rahe ho · rakh ke 'Ho gaya' dabao"
    : "⏰ 10 min se pending · pahuncha? 'Ho gaya' dabao";
  return el("section", { class: `card ${a.status}` },
    visual({ key: a.item, emoji: a.emoji }, "kvisual"),
    el("h2", { class: "kname" }, `${a.name} khatam`),
    el("p", { class: "kmeta" }, meta),
    el("div", { class: "kbtns" },
      coming ? null : el("button", { class: "btn big go", type: "button", onclick: () => setStatus(a, "coming") }, "🏃 Aa raha hoon"),
      el("button", { class: "btn big done", type: "button", onclick: () => setStatus(a, "done") }, "✅ Ho gaya")));
}

// One-time Android settings so the alarm can ring while the phone sleeps.
function phoneSetupCard() {
  if (!inApp || !phone) return null;
  const fixes = [
    !phone.notifications && ["🔔 Notification allow karo", "openAppSettings"],
    !phone.fullScreen && ["📺 Lock screen par alert allow karo", "openFullScreenSettings"],
    !phone.battery && ["🔋 Battery: 'No restrictions' chuno", "openBatterySettings"],
  ].filter(Boolean);
  if (!fixes.length && !showPhoneSetup) return null;
  return el("section", { class: "phone-setup" },
    el("b", {}, "📱 Phone setup (sirf ek baar)"),
    el("p", {}, "Taaki phone so raha ho tab bhi alarm baje."),
    fixes.map(([label, method]) => el("button", { class: "btn", type: "button", onclick: () => callNative(method) }, label)),
    el("button", { class: "btn", type: "button", onclick: () => callNative("openAppSettings") }, "🚀 Autostart on karo (Xiaomi / Oppo / Vivo / Realme)"),
    fixes.length ? null : el("p", {}, "✅ Baaki sab theek hai"));
}

async function checkPhone() {
  if (!inApp) return;
  try { phone = await callNative("status"); } catch { phone = null; }
  // "Aa raha hoon" tapped on the notification: keep showing that card on this phone.
  try {
    const { acks: fromNotification = [] } = await callNative("getAcks");
    fromNotification.forEach((id) => acks.add(id));
    saveAcks();
  } catch {}
  render();
}

function setStatus(a, status) {
  const field = status === "coming" ? "comingAt" : "doneAt";
  if (status === "coming") acks.add(a.id);
  else acks.delete(a.id);
  saveAcks();
  if (inApp) callNative("stopAll").catch(() => {});
  updateDoc(doc(db, "pgs", pgId, "alerts", a.id), { status, [field]: serverTimestamp() })
    .catch(() => toast("⚠️ Net check karo"));
}

function beep() {
  const t = audio.currentTime;
  [[880, 0], [660, 0.25], [880, 0.5]].forEach(([freq, at]) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + at);
    gain.gain.exponentialRampToValueAtTime(0.5, t + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.22);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.24);
  });
}

function stopSpeaking() {
  if (inApp) {
    nativeSpeakUntil = 0;
    callNative("stopSpeaking").catch(() => {});
  } else {
    window.speechSynthesis?.cancel();
  }
}

function speak(text) {
  if (inApp) {
    if (!text.trim()) return;
    nativeSpeakUntil = Date.now() + Math.max(1500, text.length * 110);
    callNative("speak", { text }).catch(() => {});
    return;
  }
  const synth = window.speechSynthesis;
  if (!synth) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "hi-IN";
  u.rate = 0.9;
  const hindi = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith("hi"));
  if (hindi) u.voice = hindi;
  synth.cancel();
  synth.speak(u);
}

function testSound() {
  beep();
  setTimeout(() => speak("रोटी खत्म हो गई है"), 900);
}

async function keepAwake() {
  try { await navigator.wakeLock?.request("screen"); } catch {}
}

async function setupPush(permission) {
  try {
    if (inApp) {
      // "android_" prefix tells the notifyKitchen function to send native alarm messages.
      const { token } = await callNative("getToken");
      if (token) await setDoc(doc(db, "pgs", pgId, "kitchenTokens", `android_${token}`), { createdAt: serverTimestamp(), phoneId });
      return;
    }
    if (!self.VAPID_KEY || !permission || !(await isSupported())) return;
    if ((await permission) !== "granted") return;
    const reg = await registerSW();
    if (!reg) return;
    const token = await getToken(getMessaging(firebaseApp), { vapidKey: self.VAPID_KEY, serviceWorkerRegistration: reg });
    if (token) await setDoc(doc(db, "pgs", pgId, "kitchenTokens", token), { createdAt: serverTimestamp(), phoneId });
  } catch (e) {
    console.warn("Push setup failed", e);
  }
}
