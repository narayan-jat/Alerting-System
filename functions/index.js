const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();
// Must match the Firestore database location.
setGlobalOptions({ region: "asia-south1", maxInstances: 5 });

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
]);
// Token docs saved by the Khana Kitchen Android app carry this prefix; the rest are browser tokens.
const ANDROID_PREFIX = "android_";
const isAndroid = (d) => d.id.startsWith(ANDROID_PREFIX);
const MEALS = { breakfast: "Nashta", lunch: "Lunch", dinner: "Dinner" };
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
// Pings are normal priority (high priority without a visible notification gets an app
// throttled by FCM), so a dozing phone can answer late. Only call a phone silent after this.
const SILENT_AFTER_MS = 6 * 3600e3;
const MEAL_LEAD_MIN = 60;

/** Sends to token docs and returns the docs whose app is gone (uninstalled / unsubscribed). */
async function send(docs, message) {
  if (!docs.length) return [];
  const tokens = docs.map((d) => (isAndroid(d) ? d.id.slice(ANDROID_PREFIX.length) : d.id));
  const res = await getMessaging().sendEachForMulticast({ ...message, tokens });
  return docs.filter((_, i) => DEAD_TOKEN_CODES.has(res.responses[i].error?.code));
}

async function alertOwner(pgRef, title, body, tag) {
  const docs = (await pgRef.collection("ownerTokens").get()).docs;
  const dead = await send(docs, { data: { title, body, tag, url: "setup.html" }, webpush: { headers: { Urgency: "high", TTL: "3600" } } });
  await Promise.all(dead.map((d) => d.ref.delete()));
}

async function markGone(pgRef, tokenDoc) {
  await tokenDoc.ref.delete();
  const phoneId = tokenDoc.get("phoneId");
  if (!phoneId) return;
  const phoneRef = pgRef.collection("kitchenPhones").doc(phoneId);
  const phone = await phoneRef.get();
  if (!phone.exists || phone.get("gone")) return;
  await phoneRef.update({ gone: true, goneAt: FieldValue.serverTimestamp() });
  const what = phone.get("platform") === "android" ? "Khana Kitchen app uninstall ho gaya" : "browser notifications band ho gaye";
  await alertOwner(pgRef, "❌ Kitchen phone hat gaya", `${phone.get("name")}: ${what}`, `gone_${phoneId}`);
}

const isOff = (phone, nowMs) => !!phone?.offUntil && phone.offUntil.toMillis() > nowMs;

exports.notifyKitchen = onDocumentWritten("pgs/{pgId}/alerts/{alertId}", async (event) => {
  const before = event.data.before.exists ? event.data.before.data() : null;
  const after = event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;

  const newReport = after.status === "reported" && before?.status !== "reported";
  const acknowledged = before?.status === "reported" && after.status !== "reported";
  if (!newReport && !acknowledged) return;

  const { pgId, alertId } = event.params;
  const pgRef = getFirestore().collection("pgs").doc(pgId);
  const [tokenSnap, phoneSnap] = await Promise.all([pgRef.collection("kitchenTokens").get(), pgRef.collection("kitchenPhones").get()]);
  const phones = new Map(phoneSnap.docs.map((d) => [d.id, d.data()]));
  const android = { priority: "high", ttl: 10 * 60 * 1000 };

  if (acknowledged) {
    // Stops the ringing alarm on the other app phones. Browsers get nothing: a push they
    // don't show a notification for makes Chrome show a generic one instead.
    await send(tokenSnap.docs.filter(isAndroid), { data: { type: "clear", tag: alertId }, android });
    return;
  }

  const nowMs = Date.now();
  const onDuty = tokenSnap.docs.filter((d) => !isOff(phones.get(d.get("phoneId")), nowMs));
  const data = { title: `${after.emoji} ${after.name} khatam!`, body: after.say, tag: alertId, pg: pgId, name: after.name };
  const dead = (await Promise.all([
    send(onDuty.filter((d) => !isAndroid(d)), { data, webpush: { headers: { Urgency: "high", TTL: "600" } } }),
    send(onDuty.filter(isAndroid), { data: { ...data, type: "alarm" }, android }),
  ])).flat();
  for (const d of dead) await markGone(pgRef, d);
});

function istNow() {
  const d = new Date(Date.now() + 5.5 * 3600e3);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
    day: DAYS[d.getUTCDay()],
    min: d.getUTCHours() * 60 + d.getUTCMinutes(),
  };
}

const toMin = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** The meal that is on now, or starts within MEAL_LEAD_MIN (India time). */
function mealAround(meals, now) {
  return Object.keys(MEALS).find((k) => {
    const t = meals?.[k];
    const onToday = t && (!t.days || t.days.includes(now.day));
    return onToday && now.min >= toMin(t.start) - MEAL_LEAD_MIN && now.min < toMin(t.end);
  }) || null;
}

async function checkPg(pgSnap) {
  const pgRef = pgSnap.ref;
  const [tokenSnap, phoneSnap] = await Promise.all([pgRef.collection("kitchenTokens").get(), pgRef.collection("kitchenPhones").get()]);
  if (tokenSnap.empty && phoneSnap.empty) return;

  // 1. Ping app phones. FCM rejecting the token means the app was uninstalled.
  const dead = await send(tokenSnap.docs.filter(isAndroid), { data: { type: "ping" }, android: { priority: "normal", ttl: 30 * 60 * 1000 } });
  for (const d of dead) await markGone(pgRef, d);

  const now = istNow();
  const meal = mealAround(pgSnap.get("meals"), now);
  if (!meal) return;

  // 2. Phones that stopped answering around meal time.
  const nowMs = Date.now();
  const deadPhones = new Set(dead.map((d) => d.get("phoneId")));
  let ready = 0;
  for (const p of phoneSnap.docs) {
    const x = p.data();
    if (x.gone || deadPhones.has(p.id) || isOff(x, nowMs)) continue;
    const seen = x.lastSeen?.toMillis() || 0;
    if (nowMs - seen <= SILENT_AFTER_MS) { ready++; continue; }
    if (x.platform !== "android") continue; // browsers only check in while the page is open
    if ((x.silentAlertAt?.toMillis() || 0) > seen) continue; // already reported this silence
    await p.ref.update({ silentAlertAt: FieldValue.serverTimestamp() });
    const hours = Math.floor((nowMs - seen) / 3600e3);
    await alertOwner(pgRef, "⚠️ Kitchen phone jawab nahi de raha", `${x.name} ka phone ${hours} ghante se offline hai`, `silent_${p.id}`);
  }

  // 3. Nobody left to ring. Older tokens saved before phones had names might still work.
  const unnamedTokens = tokenSnap.docs.some((d) => !d.get("phoneId") && !dead.includes(d));
  if (ready || unnamedTokens) return;
  const key = `${now.date}_${meal}`;
  const stateRef = pgRef.collection("private").doc("state");
  if ((await stateRef.get()).get("coverageAlert") === key) return;
  await stateRef.set({ coverageAlert: key }, { merge: true });
  await alertOwner(pgRef, "🚨 Koi kitchen phone ready nahi",
    `${MEALS[meal]} ka time hai, par kisi kitchen phone par alarm nahi bajega`, `coverage_${key}`);
}

exports.checkKitchen = onSchedule({ schedule: "every 30 minutes", timeZone: "Asia/Kolkata" }, async () => {
  const pgs = await getFirestore().collection("pgs").get();
  for (const pg of pgs.docs) {
    try { await checkPg(pg); } catch (e) { console.error("checkKitchen failed for", pg.id, e); }
  }
});
