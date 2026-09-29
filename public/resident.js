import {
  db, MEALS, DAYS, DAY_LABELS, FALLBACK_MENU, itemFromEntry, readPgId, dateKey, dayKey, currentMeal, nextMeal,
  fmtTime, timeAgo, alertId, el, visual, toast, renderMessage, registerSW, installBanner,
} from "./common.js";
import {
  doc, collection, query, where, onSnapshot, runTransaction, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = document.getElementById("app");
const dialog = document.getElementById("other");
const otherName = document.getElementById("otherName");
const pgId = readPgId("residentPg");

let pg; // undefined = loading, null = not found
let alerts = new Map();
const sending = new Set();
let watchedDate = null;
let unwatch = null;
let audio = null;

// Items this phone reported: { alertId: last status we told the resident about }.
const MINE_KEY = "myReports";
const NOTIFY_WITHIN_MS = 30 * 60 * 1000;
let mine = {};
try { mine = JSON.parse(localStorage.getItem(MINE_KEY)) || {}; } catch {}
const saveMine = () => { try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch {} };

if (!pgId) {
  renderMessage(app, "📷", "Buffet par laga QR scan karo");
} else {
  registerSW();
  installBanner("resident", "Khana Alert install karo");
  render();
  onSnapshot(
    doc(db, "pgs", pgId),
    (s) => { pg = s.exists() ? s.data() : null; render(); },
    () => renderMessage(app, "⚠️", "Net check karo")
  );
  watchAlerts();
  setInterval(() => { watchAlerts(); render(); }, 30000);
}

function watchAlerts() {
  const today = dateKey();
  if (today === watchedDate) return;
  watchedDate = today;
  unwatch?.();
  unwatch = onSnapshot(query(collection(db, "pgs", pgId, "alerts"), where("date", "==", today)), (snap) => {
    alerts = new Map(snap.docs.map((d) => [d.id, d.data()]));
    checkMine();
    render();
  });
}

function checkMine() {
  const today = dateKey();
  for (const [id, told] of Object.entries(mine)) {
    if (!id.startsWith(today)) { delete mine[id]; continue; }
    const a = alerts.get(id);
    if (!a || a.status === told) continue;
    const at = (a.status === "done" ? a.doneAt : a.comingAt)?.toMillis?.() || Date.now();
    if (Date.now() - at < NOTIFY_WITHIN_MS) {
      if (a.status === "coming") notify(id, "🏃", `${a.name} aa raha hai`, "Kitchen wale la rahe hain, thoda ruko");
      if (a.status === "done") notify(id, "✅", `${a.name} aa gaya!`, "Buffet par rakh diya hai, jaake le lo");
    }
    if (a.status === "done") delete mine[id];
    else mine[id] = a.status;
  }
  saveMine();
}

const notice = document.getElementById("notice");
function notify(tag, emoji, title, body) {
  if (promo.open) promo.close();
  notice.replaceChildren(
    el("span", { class: "notice-emoji" }, emoji),
    el("div", {}, el("b", {}, title), el("span", {}, body)),
    el("button", { class: "install-x", type: "button", "aria-label": "Band karo" }, "✕"));
  notice.className = `notice ${emoji === "✅" ? "done" : "coming"}`;
  notice.hidden = false;
  clearTimeout(notice._hide);
  notice._hide = setTimeout(() => { notice.hidden = true; }, 12000);
  navigator.vibrate?.([200, 100, 200]);
  chime();
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    navigator.serviceWorker?.ready.then((r) => r.showNotification(title, { body, tag, icon: "icon-192.png" })).catch(() => {});
  }
}
notice.addEventListener("click", () => { notice.hidden = true; });

function chime() {
  if (!audio) return;
  audio.resume();
  const t = audio.currentTime;
  [[660, 0], [990, 0.18]].forEach(([freq, at]) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t + at);
    gain.gain.exponentialRampToValueAtTime(0.3, t + at + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.4);
    osc.connect(gain).connect(audio.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.45);
  });
}

function render() {
  if (pg === undefined) return renderMessage(app, "⏳", "Load ho raha hai…");
  if (pg === null) return renderMessage(app, "❓", "PG nahi mila", "QR dobara scan karo");

  const meal = currentMeal(pg.meals);
  if (!meal) {
    const next = nextMeal(pg.meals);
    const when = !next ? "" : next.inDays === 0 ? "aaj" : next.inDays === 1 ? "kal" : DAY_LABELS[DAYS[(new Date().getDay() + next.inDays) % 7]];
    return renderMessage(app, "🕒", "Abhi khane ka time nahi hai",
      next ? `Agla: ${MEALS[next.key]} ${when} ${fmtTime(pg.meals[next.key].start)}` : "");
  }

  const today = dateKey();
  const entries = pg.menu?.[dayKey()]?.[meal];
  const items = (entries?.length ? entries : FALLBACK_MENU).map(itemFromEntry);
  for (const a of alerts.values()) {
    if (a.meal === meal && a.status !== "done" && !items.some((i) => i.key === a.item)) {
      items.push({ key: a.item, name: a.name, emoji: a.emoji, say: a.say });
    }
  }

  const t = pg.meals[meal];
  app.replaceChildren(
    el("div", { class: "appbar" },
      el("span", { class: "logo" }, "🍽️ Khana Alert"),
      el("span", { class: "live" }, el("i", { class: "dot" }), `${MEALS[meal]} · ${fmtTime(t.start)}–${fmtTime(t.end)}`)),
    el("header", { class: "hero" },
      el("h1", {}, "Kya khatam hua?"),
      el("p", { class: "sub" }, "Tap karo, kitchen ko turant pata chal jayega")),
    el("div", { class: "grid" },
      items.map((item) => tile(item, alerts.get(alertId(today, meal, item.key)), meal)),
      el("button", { class: "tile other", type: "button", onclick: openOther },
        el("div", { class: "visual" }, "➕"), el("div", { class: "name" }, "Kuch aur")))
  );
}

function tile(item, a, meal) {
  const status = sending.has(item.key) ? "sending" : a && a.status !== "done" ? a.status : "ok";
  const state = {
    ok: "Tap karo",
    sending: "Bhej rahe hain…",
    reported: `🔒 Bata diya · ${timeAgo(a?.reportedAt)}`,
    coming: "🏃 Aa raha hai",
  }[status];
  return el("button",
    { class: `tile ${status}`, type: "button", disabled: status !== "ok", onclick: () => report(item, meal) },
    visual(item, "visual"),
    el("div", { class: "name" }, item.name),
    el("div", { class: "state" }, state));
}

async function report(item, meal) {
  const date = dateKey();
  const id = alertId(date, meal, item.key);
  const ref = doc(db, "pgs", pgId, "alerts", id);
  try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); } catch {}
  sending.add(item.key);
  render();
  try {
    await runTransaction(db, async (tx) => {
      const s = await tx.get(ref);
      if (s.exists() && s.data().status !== "done") throw new Error("locked");
      tx.set(ref, {
        status: "reported", item: item.key, name: item.name, emoji: item.emoji, say: item.say,
        meal, date, reportedAt: serverTimestamp(),
      });
    });
    mine[id] = "reported";
    saveMine();
    navigator.vibrate?.(80);
    showPromo(item);
  } catch (e) {
    const locked = e.message === "locked" || e.code === "permission-denied";
    toast(locked ? "🔒 Pehle se bata diya gaya hai" : "⚠️ Nahi gaya, net check karke dobara try karo");
  } finally {
    sending.delete(item.key);
    render();
  }
}

const MEMES = [
  (n) => ["🦸", `${n} HERO!`, "Poore floor ko bhookh se bacha liya"],
  (n) => ["📢", "Kitchen ko khabar ho gayi", `${n} aa raha hai, plate ready rakho`],
  () => ["😎", "Na phone, na chillana", "Ek tap mein kaam ho gaya"],
  (n) => ["🍛", `${n} on the way…`, "Tab tak paani pee lo"],
  () => ["🏆", "Aaj ka Bhookh Mitao Award", "Jaata hai… TUMHE!"],
  () => ["🧠", "Itna smart solution?", "Ye Ferrowright ne banaya hai"],
  () => ["🚀", "Problem reported", "Solution loading… 99%"],
  () => ["🙏", "Dhanyavaad bhookhe bhai", "Tumhari awaaz kitchen tak pahunch gayi"],
];
const promo = document.getElementById("promo");

function showPromo(item) {
  const [emoji, top, bottom] = MEMES[Math.floor(Math.random() * MEMES.length)](item.name);
  document.getElementById("memeEmoji").textContent = emoji;
  document.getElementById("memeTop").textContent = top;
  document.getElementById("memeBottom").textContent = bottom;
  if (!promo.open) promo.showModal();
}

function openOther() {
  otherName.value = "";
  dialog.showModal();
  otherName.focus();
}

dialog.addEventListener("close", () => {
  const name = otherName.value.trim();
  const meal = pg && currentMeal(pg.meals);
  if (dialog.returnValue === "send" && name && meal) report(itemFromEntry(name), meal);
});
