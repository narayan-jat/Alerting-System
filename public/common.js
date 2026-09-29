import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const app = initializeApp(self.FIREBASE_CONFIG);
export const db = getFirestore(app);

export const MEALS = { breakfast: "Nashta", lunch: "Lunch", dinner: "Dinner" };

export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export const DEFAULT_MEAL_TIMES = {
  breakfast: { start: "07:30", end: "10:00", days: DAYS },
  lunch: { start: "12:30", end: "15:00", days: ["sat", "sun"] },
  dinner: { start: "19:30", end: "22:30", days: DAYS },
};
export const DAY_LABELS = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

export const CATALOG = {
  roti: { name: "Roti", emoji: "🫓", say: "रोटी खत्म हो गई है" },
  paratha: { name: "Paratha", emoji: "🫓", say: "पराठे खत्म हो गए हैं" },
  chawal: { name: "Chawal", emoji: "🍚", say: "चावल खत्म हो गए हैं" },
  dal: { name: "Dal", emoji: "🍲", say: "दाल खत्म हो गई है" },
  sabzi: { name: "Sabzi", emoji: "🥘", say: "सब्ज़ी खत्म हो गई है" },
  paneer: { name: "Paneer", emoji: "🧀", say: "पनीर खत्म हो गया है" },
  rajma: { name: "Rajma", emoji: "🍛", say: "राजमा खत्म हो गया है" },
  chole: { name: "Chole", emoji: "🍛", say: "छोले खत्म हो गए हैं" },
  kadhi: { name: "Kadhi", emoji: "🍛", say: "कढ़ी खत्म हो गई है" },
  khichdi: { name: "Khichdi", emoji: "🍲", say: "खिचड़ी खत्म हो गई है" },
  sambhar: { name: "Sambhar", emoji: "🍲", say: "सांभर खत्म हो गया है" },
  poha: { name: "Poha", emoji: "🍛", say: "पोहा खत्म हो गया है" },
  upma: { name: "Upma", emoji: "🍛", say: "उपमा खत्म हो गया है" },
  idli: { name: "Idli", emoji: "🍙", say: "इडली खत्म हो गई है" },
  dosa: { name: "Dosa", emoji: "🥞", say: "डोसा खत्म हो गया है" },
  bread: { name: "Bread", emoji: "🍞", say: "ब्रेड खत्म हो गई है" },
  anda: { name: "Anda", emoji: "🥚", say: "अंडे खत्म हो गए हैं" },
  dahi: { name: "Dahi", emoji: "🥣", say: "दही खत्म हो गया है" },
  raita: { name: "Raita", emoji: "🥣", say: "रायता खत्म हो गया है" },
  salad: { name: "Salad", emoji: "🥗", say: "सलाद खत्म हो गया है" },
  achaar: { name: "Achaar", emoji: "🌶️", say: "अचार खत्म हो गया है" },
  papad: { name: "Papad", emoji: "🍘", say: "पापड़ खत्म हो गए हैं" },
  meetha: { name: "Meetha", emoji: "🍮", say: "मीठा खत्म हो गया है" },
  chai: { name: "Chai", emoji: "☕", say: "चाय खत्म हो गई है" },
  doodh: { name: "Doodh", emoji: "🥛", say: "दूध खत्म हो गया है" },
  paani: { name: "Paani", emoji: "💧", say: "पानी खत्म हो गया है" },
  plate: { name: "Plate", emoji: "🍽️", say: "प्लेटें खत्म हो गई हैं" },
  chammach: { name: "Chammach", emoji: "🥄", say: "चम्मच खत्म हो गए हैं" },
};

export const FALLBACK_MENU = ["roti", "chawal", "dal", "sabzi", "paani"];

export function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9ऀ-ॿ]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "item";
}

export function itemFromEntry(entry) {
  const text = String(entry).trim().slice(0, 30);
  if (CATALOG[text]) return { key: text, ...CATALOG[text] };
  const preset = Object.entries(CATALOG).find(([, v]) => v.name.toLowerCase() === text.toLowerCase());
  if (preset) return { key: preset[0], ...preset[1] };
  return { key: "x-" + slug(text), name: text, emoji: "🍽️", say: `${text} खत्म है` };
}

export function readPgId(storageKey) {
  const fromUrl = new URLSearchParams(location.search).get("pg");
  let id = fromUrl;
  try {
    if (fromUrl) localStorage.setItem(storageKey, fromUrl);
    else id = localStorage.getItem(storageKey);
  } catch {}
  return /^[a-f0-9]{16}$/.test(id || "") ? id : null;
}

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const dayKey = (d = new Date()) => DAYS[d.getDay()];

const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};
const nowMin = (d) => d.getHours() * 60 + d.getMinutes();

// A meal without a `days` list runs every day.
export const mealOnDay = (t, day) => !!t && (!t.days || t.days.includes(day));

export function currentMeal(times, d = new Date()) {
  const now = nowMin(d);
  const day = dayKey(d);
  return Object.keys(MEALS).find((k) => {
    const t = times?.[k];
    return mealOnDay(t, day) && now >= toMin(t.start) && now < toMin(t.end);
  }) || null;
}

// Returns { key, inDays } for the next meal to start, looking up to a week ahead.
export function nextMeal(times, d = new Date()) {
  const now = nowMin(d);
  for (let inDays = 0; inDays <= 7; inDays++) {
    const day = DAYS[(d.getDay() + inDays) % 7];
    const key = Object.keys(MEALS)
      .filter((k) => mealOnDay(times?.[k], day) && (inDays > 0 || toMin(times[k].start) > now))
      .sort((a, b) => toMin(times[a].start) - toMin(times[b].start))[0];
    if (key) return { key, inDays };
  }
  return null;
}

export function fmtTime(t) {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export function timeAgo(ts) {
  if (!ts) return "abhi";
  const min = Math.floor((Date.now() - ts.toMillis()) / 60000);
  return min < 1 ? "abhi" : `${min} min pehle`;
}

export const alertId = (date, meal, itemKey) => `${date}_${meal}_${itemKey}`;

export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}

// Put a real photo at img/<key>.jpg (e.g. img/roti.jpg) and it replaces the emoji.
const noPhoto = new Set();
export function visual(item, cls) {
  const box = el("div", { class: cls });
  const showEmoji = () => box.replaceChildren(el("span", {}, item.emoji || "🍽️"));
  if (!CATALOG[item.key] || noPhoto.has(item.key)) {
    showEmoji();
    return box;
  }
  const img = el("img", { src: `img/${item.key}.jpg`, alt: "" });
  img.addEventListener("error", () => {
    noPhoto.add(item.key);
    showEmoji();
  });
  box.append(img);
  return box;
}

export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._hide);
  t._hide = setTimeout(() => t.classList.remove("show"), 2500);
}

export function renderMessage(target, icon, title, sub) {
  target.replaceChildren(
    el("div", { class: "msg" }, el("div", { class: "msg-icon" }, icon), el("h1", {}, title), sub ? el("p", { class: "hint" }, sub) : null)
  );
}

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// Android/Chrome: real install button. iPhone: Add to Home Screen steps. Hidden once installed.
export function installBanner(key, label) {
  if (isStandalone()) return;
  const storeKey = `installDismissed:${key}`;
  try { if (Date.now() < Number(localStorage.getItem(storeKey) || 0)) return; } catch {}

  const text = el("div", { class: "install-text" });
  const installBtn = el("button", { class: "btn small primary", type: "button" }, "Install");
  const closeBtn = el("button", { class: "install-x", type: "button", "aria-label": "Band karo" }, "✕");
  const bar = el("div", { class: "install", hidden: "" }, el("span", { class: "install-icon" }, "📲"), text, installBtn, closeBtn);
  document.body.prepend(bar);

  const show = (hint, withButton) => {
    text.replaceChildren(el("b", {}, label), el("span", {}, hint));
    installBtn.hidden = !withButton;
    bar.hidden = false;
  };

  let deferred = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e;
    show("Agli baar 1 tap mein khulega", true);
  });
  installBtn.addEventListener("click", async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    if (outcome === "accepted") bar.remove();
  });
  closeBtn.addEventListener("click", () => {
    try { localStorage.setItem(storeKey, String(Date.now() + 3 * 864e5)); } catch {}
    bar.remove();
  });
  window.addEventListener("appinstalled", () => bar.remove());
  if (isIOS()) show("Share ⬆️ dabao, phir 'Add to Home Screen'", false);
}

export async function registerSW() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("./sw.js");
  } catch {
    return null;
  }
}
