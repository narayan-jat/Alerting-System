import {
  app as firebaseApp, db, MEALS, DEFAULT_MEAL_TIMES, DAYS, DAY_LABELS, CATALOG, FALLBACK_MENU, itemFromEntry, dayKey, mealOnDay,
  el, toast, registerSW, installBanner,
} from "./common.js";
import {
  doc, collection, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getMessaging, getToken, onMessage, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

// Must match SILENT_AFTER_MS in functions/index.js.
const SILENT_AFTER_MS = 6 * 3600e3;
let phones = [];
let unwatchPhones = null;

const WEEK = [...DAYS.slice(1), DAYS[0]];
const app = document.getElementById("app");
let pgId = null;
let pg = null;
let selDay = dayKey();
let selMeal = "lunch";

registerSW();
installBanner("setup", "Setup app install karo");

let saved = null;
try { saved = localStorage.getItem("setupPg"); } catch {}
saved ? openPg(saved) : renderLogin();

function renderLogin() {
  const input = el("input", { type: "tel", inputmode: "numeric", placeholder: "10 digit mobile number", maxlength: "14", autocomplete: "tel" });
  app.replaceChildren(
    el("form", { class: "panel login", onsubmit: async (e) => {
      e.preventDefault();
      const digits = input.value.replace(/\D/g, "").slice(-10);
      if (digits.length !== 10) return toast("10 digit number daalo");
      const id = await pgIdFor(digits);
      try { localStorage.setItem("setupPg", id); } catch {}
      openPg(id);
    } },
      el("div", { class: "msg-icon" }, "🍽️"),
      el("h1", {}, "Khana Alert setup"),
      el("p", { class: "hint" }, "Apne PG ka menu aur time set karo"),
      el("label", {}, "Mobile number", input),
      el("button", { class: "btn big primary", type: "submit" }, "Aage badho"))
  );
}

async function pgIdFor(digits) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("khana-alert:" + digits));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}

async function openPg(id) {
  pgId = id;
  const ref = doc(db, "pgs", id);
  try {
    const s = await getDoc(ref);
    if (s.exists()) {
      pg = s.data();
    } else {
      pg = { meals: DEFAULT_MEAL_TIMES, menu: {} };
      await setDoc(ref, { ...pg, updatedAt: serverTimestamp() });
    }
  } catch {
    return toast("⚠️ Net check karo");
  }
  render();
}

function save(patch) {
  updateDoc(doc(db, "pgs", pgId), { ...patch, updatedAt: serverTimestamp() })
    .then(() => toast("✅ Save ho gaya"))
    .catch(() => toast("⚠️ Save nahi hua"));
}

function render() {
  app.replaceChildren(
    el("header", { class: "spread setup-head" },
      el("h1", {}, "🍽️ Setup"),
      el("button", { class: "link", type: "button", onclick: () => {
        try { localStorage.removeItem("setupPg"); } catch {}
        location.reload();
      } }, "Number badlo")),
    el("section", { class: "panel", id: "phones" }),
    linksPanel(),
    timesPanel(),
    el("section", { class: "panel", id: "menu" })
  );
  renderMenu();
  renderPhones();
  unwatchPhones?.();
  unwatchPhones = onSnapshot(collection(db, "pgs", pgId, "kitchenPhones"), (snap) => {
    phones = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPhones();
  });
  setInterval(renderPhones, 60000);
  refreshOwnerAlerts();
}

function ago(ts) {
  if (!ts) return "kabhi nahi";
  const min = Math.floor((Date.now() - ts.toMillis()) / 60000);
  if (min < 1) return "abhi";
  if (min < 60) return `${min} min pehle`;
  if (min < 48 * 60) return `${Math.floor(min / 60)} ghante pehle`;
  return `${Math.floor(min / 1440)} din pehle`;
}

function phoneStatus(p) {
  const now = Date.now();
  if (p.gone) return ["bad", "❌", `App hat gaya · ${ago(p.goneAt)}`];
  if (p.offUntil && p.offUntil.toMillis() > now) {
    const d = p.offUntil.toDate();
    return ["off", "😴", `Chhutti · ${d.getDate()}/${d.getMonth() + 1} tak`];
  }
  const silent = now - (p.lastSeen?.toMillis() || 0) > SILENT_AFTER_MS;
  if (p.platform === "web") return [silent ? "off" : "ok", "🌐", `Browser · khula tha ${ago(p.lastSeen)}`];
  if (silent) return ["warn", "⚠️", `Jawab nahi · aakhri baar ${ago(p.lastSeen)}`];
  return ["ok", "✅", `Ready · ${ago(p.lastSeen)}`];
}

function renderPhones() {
  const box = document.getElementById("phones");
  if (!box) return;
  const rows = [...phones]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ p, s: phoneStatus(p) }));
  const ready = rows.filter((r) => r.s[0] === "ok").length;
  const alertsOn = ownerAlertsOn();

  box.replaceChildren(el("div", {},
    el("div", { class: "spread" },
      el("h2", {}, "📱 Kitchen phones"),
      el("span", { class: ready ? "badge ok" : "badge bad" }, `${ready} ready`)),
    !rows.length ? el("p", { class: "hint" }, "Abhi koi kitchen phone juda nahi hai. Neeche 'Kitchen phones ke liye' se app ya link bhejo.") : null,
    rows.length && !ready ? el("p", { class: "phones-warn" }, "🚨 Koi kitchen phone ready nahi hai. Resident report karenge to alarm nahi bajega.") : null,
    el("div", { class: "phones" }, rows.map(({ p, s: [cls, icon, text] }) =>
      el("div", { class: `phone ${cls}` },
        el("span", { class: "phone-icon" }, icon),
        el("div", { class: "phone-text" }, el("b", {}, p.name), el("span", {}, text)),
        p.gone ? el("button", { class: "link", type: "button", onclick: () => removePhone(p) }, "Hatao") : null))),
    el("div", { class: "owner-alerts" },
      alertsOn
        ? el("p", { class: "hint" }, "🔔 Alerts on: koi app hataye, phone band ho, ya khane ke time koi phone ready na ho, to is phone par notification aayegi.")
        : el("button", { class: "btn primary", type: "button", onclick: enableOwnerAlerts }, "🔔 Mujhe alert bhejo"),
      alertsOn ? null : el("p", { class: "hint" }, "Koi kitchen wala app hataye ya phone band ho to aapko turant pata chalega."))));
}

function removePhone(p) {
  if (!confirm(`${p.name} ko list se hatana hai?`)) return;
  deleteDoc(doc(db, "pgs", pgId, "kitchenPhones", p.id)).catch(() => toast("⚠️ Net check karo"));
}

const OWNER_KEY = "ownerAlertsPg";
function ownerAlertsOn() {
  try {
    return localStorage.getItem(OWNER_KEY) === pgId && "Notification" in window && Notification.permission === "granted";
  } catch { return false; }
}

async function saveOwnerToken() {
  if (!self.VAPID_KEY || !(await isSupported())) throw new Error("unsupported");
  const reg = await registerSW();
  const messaging = getMessaging(firebaseApp);
  const token = await getToken(messaging, { vapidKey: self.VAPID_KEY, serviceWorkerRegistration: reg });
  await setDoc(doc(db, "pgs", pgId, "ownerTokens", token), { createdAt: serverTimestamp() });
  onMessage(messaging, ({ data = {} }) => toast(`${data.title} · ${data.body}`));
}

async function enableOwnerAlerts() {
  if (!("Notification" in window)) return toast("Is browser mein notification nahi chalte");
  if ((await Notification.requestPermission()) !== "granted") return toast("Notification allow karo, tabhi alert aayega");
  try {
    await saveOwnerToken();
    localStorage.setItem(OWNER_KEY, pgId);
    toast("✅ Alerts on ho gaye");
  } catch {
    toast("⚠️ Alert on nahi hua, dobara try karo");
  }
  renderPhones();
}

// Tokens can rotate; re-save quietly each time the setup page opens.
function refreshOwnerAlerts() {
  if (ownerAlertsOn()) saveOwnerToken().catch(() => {});
}

function linksPanel() {
  const residentUrl = new URL(`index.html?pg=${pgId}`, location.href).href;
  const kitchenUrl = new URL(`kitchen.html?pg=${pgId}`, location.href).href;
  return el("section", { class: "panel" },
    el("h2", {}, "🔗 QR aur links"),
    el("div", { class: "links" },
      linkBox("Residents ke liye (buffet par lagao)", residentUrl,
        el("button", { class: "btn", type: "button", onclick: () => printPoster(residentUrl) }, "🖨️ Poster print")),
      linkBox("Kitchen phones ke liye", kitchenUrl,
        el("a", { class: "btn primary", href: "khana-kitchen.apk", download: "khana-kitchen.apk" }, "📲 Android app (APK)"),
        el("div", {},
          el("p", { class: "hint" }, "App mein pehli baar ye kitchen code daalo:"),
          el("span", { class: "kcode" }, pgId)))));
}

function linkBox(title, url, extra, note) {
  return el("div", { class: "linkbox" },
    el("h3", {}, title),
    qr(url, 5),
    el("p", { class: "url" }, url),
    note,
    el("div", { class: "btnrow" },
      el("button", { class: "btn", type: "button", onclick: () => share(url) }, "📤 Share"),
      el("a", { class: "btn", href: url, target: "_blank" }, "Kholo"),
      extra));
}

function qr(url, cell) {
  const box = el("div", { class: "qr" });
  if (!window.qrcode) {
    box.append("QR load nahi hua");
    return box;
  }
  const q = window.qrcode(0, "M");
  q.addData(url);
  q.make();
  box.innerHTML = q.createSvgTag(cell, cell * 2);
  return box;
}

function share(url) {
  if (navigator.share) return navigator.share({ url }).catch(() => {});
  navigator.clipboard.writeText(url).then(() => toast("Copy ho gaya"), () => toast(url));
}

function printPoster(url) {
  document.getElementById("posterQr").replaceChildren(qr(url, 10));
  window.print();
}

function timesPanel() {
  return el("section", { class: "panel" },
    el("h2", {}, "🕒 Khane ka time"),
    el("p", { class: "hint" }, "Reporting in time par apne aap shuru aur band hoti hai."),
    Object.entries(MEALS).map(([key, label]) => {
      const t = pg.meals?.[key] || DEFAULT_MEAL_TIMES[key];
      let days = t.days || DAYS;
      const start = el("input", { type: "time", value: t.start });
      const end = el("input", { type: "time", value: t.end });
      const dayRow = el("div", { class: "seg days" });

      const persist = () => {
        if (!start.value || !end.value || start.value >= end.value) return toast("Time sahi daalo");
        const next = { start: start.value, end: end.value, days };
        pg.meals = { ...pg.meals, [key]: next };
        save({ [`meals.${key}`]: next });
        renderMenu();
      };
      const drawDays = () => dayRow.replaceChildren(...WEEK.map((d) =>
        el("button", { type: "button", class: days.includes(d) ? "on" : null, onclick: () => {
          const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
          if (!next.length) return toast("Kam se kam ek din chuno");
          days = DAYS.filter((x) => next.includes(x));
          drawDays();
          persist();
        } }, DAY_LABELS[d])));

      start.addEventListener("change", persist);
      end.addEventListener("change", persist);
      drawDays();
      return el("div", { class: "mealrow" },
        el("strong", { class: "meal-name" }, label),
        el("div", { class: "timerow" }, start, el("span", {}, "se"), end),
        dayRow);
    }));
}

function setMenu(day, meal, list) {
  pg.menu = { ...pg.menu, [day]: { ...pg.menu?.[day], [meal]: list } };
}

function renderMenu() {
  const box = document.getElementById("menu");
  const mealsToday = Object.keys(MEALS).filter((k) => mealOnDay(pg.meals?.[k] || DEFAULT_MEAL_TIMES[k], selDay));
  const daySeg = el("div", { class: "seg" }, WEEK.map((d) =>
    el("button", { type: "button", class: d === selDay ? "on" : null, onclick: () => { selDay = d; renderMenu(); } }, DAY_LABELS[d])));
  if (!mealsToday.length) {
    return box.replaceChildren(el("h2", {}, "Weekly menu"), daySeg, el("p", { class: "hint" }, `${DAY_LABELS[selDay]} ko koi khana nahi hai.`));
  }
  if (!mealsToday.includes(selMeal)) selMeal = mealsToday[0];
  const list = pg.menu?.[selDay]?.[selMeal] || [];
  const update = (next) => {
    setMenu(selDay, selMeal, next);
    save({ [`menu.${selDay}.${selMeal}`]: next });
    renderMenu();
  };
  const addInput = el("input", { placeholder: "Naya item (jaise: aloo gobi)", maxlength: "30" });

  box.replaceChildren(
    el("h2", {}, "Weekly menu"),
    daySeg,
    el("div", { class: "seg" }, mealsToday.map((k) =>
      el("button", { type: "button", class: k === selMeal ? "on" : null, onclick: () => { selMeal = k; renderMenu(); } }, MEALS[k]))),
    el("p", { class: "hint" }, `${DAY_LABELS[selDay]} ${MEALS[selMeal]} mein jo banta hai us par tap karo. Khali chhoda to residents ko ${FALLBACK_MENU.map((k) => CATALOG[k].name).join(", ")} dikhega.`),
    el("div", { class: "chips" },
      Object.entries(CATALOG).map(([k, v]) =>
        el("button", { type: "button", class: list.includes(k) ? "chip on" : "chip",
          onclick: () => update(list.includes(k) ? list.filter((x) => x !== k) : [...list, k]) }, `${v.emoji} ${v.name}`)),
      list.filter((e) => !CATALOG[e]).map((c) =>
        el("button", { type: "button", class: "chip on", onclick: () => update(list.filter((x) => x !== c)) }, `🍽️ ${c} ✕`))),
    el("form", { class: "addrow", onsubmit: (e) => {
      e.preventDefault();
      const text = addInput.value.trim();
      if (!text) return;
      const item = itemFromEntry(text);
      const entry = CATALOG[item.key] ? item.key : item.name;
      if (!list.includes(entry)) update([...list, entry]);
    } }, addInput, el("button", { class: "btn", type: "submit" }, "Jodo")),
    el("button", { class: "btn", type: "button", onclick: () => {
      if (!confirm(`Ye ${MEALS[selMeal]} menu saare dino mein lagana hai?`)) return;
      const patch = {};
      for (const d of DAYS) {
        setMenu(d, selMeal, list);
        patch[`menu.${d}.${selMeal}`] = list;
      }
      save(patch);
    } }, `Ye ${MEALS[selMeal]} menu sab dino mein lagao`)
  );
}
