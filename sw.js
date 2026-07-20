/**
 * Service Worker — All-in-One
 * Zuständig für: App-Caching (PWA) + Hintergrund-Erinnerungen + Mehrbenutzer-Kontext
 *
 * WICHTIG: Echte "Push"-Benachrichtigungen (auch bei komplett geschlossener App)
 * würden einen Server (Firebase Cloud Messaging + Cloud Function) erfordern.
 * Diese Lösung funktioniert clientseitig: Sie prüft periodisch fällige
 * Erinnerungen, SOLANGE der Browser/die App im Hintergrund aktiv ist
 * (z.B. Safari-Tab offen, iPhone-Bildschirm aus aber App nicht beendet).
 *
 * Punkt 3 (Mehrbenutzerfähigkeit): Die App teilt dem Service Worker per
 * postMessage mit, welcher Nutzer (uid) gerade angemeldet ist. Nur für
 * diesen Nutzer werden Erinnerungen geprüft, gespeichert in der Cache API
 * (Service Worker haben keinen Zugriff auf den Firebase-Auth-Zustand der Seite).
 */

const CACHE_NAME = "all-in-one-v2";
const CHECK_INTERVAL_MS = 60 * 1000; // jede Minute prüfen

const FIREBASE_DB_URL = "https://all-in-one-200f2-default-rtdb.europe-west1.firebasedatabase.app";

// ── APP-SHELL CACHING (Grundvoraussetzung für PWA) ──
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== "notified-store" && k !== "user-store").map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
  startReminderLoop();
});

self.addEventListener("fetch", (event) => {
  // Firebase-Aufrufe nie aus dem Cache bedienen
  if (event.request.url.includes("firebasedatabase.app") || event.request.url.includes("googleapis.com")) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

// ── NUTZER-KONTEXT (Punkt 3): die Seite teilt die aktuelle uid mit ──

self.addEventListener("message", (event) => {
  if (event.data?.type === "SET_UID") {
    setStoredUid(event.data.uid);
  }
});

async function setStoredUid(uid) {
  try {
    const cache = await caches.open("user-store");
    if (uid) {
      await cache.put("uid", new Response(JSON.stringify(uid)));
    } else {
      await cache.delete("uid");
    }
  } catch {
    // ignorieren
  }
}

async function getStoredUid() {
  try {
    const cache = await caches.open("user-store");
    const res = await cache.match("uid");
    if (!res) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// ── ERINNERUNGS-LOGIK ──

let reminderTimer = null;

function startReminderLoop() {
  if (reminderTimer) clearInterval(reminderTimer);
  checkReminders(); // sofort einmal prüfen
  reminderTimer = setInterval(checkReminders, CHECK_INTERVAL_MS);
}

/** Holt einmalig Events + To-Dos des aktuell angemeldeten Nutzers via REST und prüft auf fällige Erinnerungen */
/** Anzahl Tage zwischen zwei "YYYY-MM-DD"-Daten (b - a) */
function daysBetweenDates(dateStrA, dateStrB) {
  const a = new Date(dateStrA + "T00:00:00");
  const b = new Date(dateStrB + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/** Punkt 1: Prüft, ob ein (ggf. wiederkehrender) Termin an einem bestimmten Datum stattfindet */
function eventOccursOnDate(ev, dateStr) {
  if (!ev.date) return false;
  if (dateStr < ev.date) return false;
  if (!ev.recurrence || ev.recurrence === "none") return ev.date === dateStr;
  const daysDiff = daysBetweenDates(ev.date, dateStr);
  switch (ev.recurrence) {
    case "daily":      return true;
    case "every2days": return daysDiff % 2 === 0;
    case "weekly":     return daysDiff % 7 === 0;
    case "yearly": {
      const anchor = new Date(ev.date + "T00:00:00");
      const d = new Date(dateStr + "T00:00:00");
      return anchor.getMonth() === d.getMonth() && anchor.getDate() === d.getDate();
    }
    default: return ev.date === dateStr;
  }
}

function todayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function checkReminders() {
  try {
    const uid = await getStoredUid();
    if (!uid) return; // niemand angemeldet → keine Erinnerungen möglich

    const [eventsRes, todosRes] = await Promise.all([
      fetch(`${FIREBASE_DB_URL}/users/${uid}/events.json`),
      fetch(`${FIREBASE_DB_URL}/users/${uid}/todos.json`)
    ]);
    const events = (await eventsRes.json()) || {};
    const todos  = (await todosRes.json()) || {};

    const now = Date.now();
    const t = todayDateStr();
    const notified = await getNotifiedIds();

    // Events prüfen (Punkt 1: inkl. Wiederholungen — Prüfung erfolgt gegen "heute", nicht nur den Ankertag)
    for (const [id, ev] of Object.entries(events)) {
      if (ev.reminderMinutes === undefined || ev.reminderMinutes === null) continue;
      if (!eventOccursOnDate(ev, t)) continue;
      const fireTime = computeFireTime(t, ev.time, ev.reminderMinutes);
      if (fireTime === null) continue;
      const key = `${uid}:event:${id}:${t}`; // Datum im Schlüssel → jede Wiederholung kann einzeln benachrichtigen
      if (now >= fireTime && now < fireTime + 5 * 60 * 1000 && !notified.has(key)) {
        await showAppNotification(
          `🗓️ ${ev.title}`,
          ev.time ? `Beginnt um ${ev.time} Uhr` : "Heute",
          key
        );
      }
    }

    // To-Dos prüfen
    for (const [id, td] of Object.entries(todos)) {
      if (td.done) continue;
      if (!td.dueDate || td.reminderMinutes === undefined || td.reminderMinutes === null) continue;
      const fireTime = computeFireTime(td.dueDate, td.dueTime, td.reminderMinutes);
      if (fireTime === null) continue;
      const key = `${uid}:todo:${id}`;
      if (now >= fireTime && now < fireTime + 5 * 60 * 1000 && !notified.has(key)) {
        await showAppNotification(
          `✅ ${td.title}`,
          td.dueTime ? `Fällig um ${td.dueTime} Uhr` : "Heute fällig",
          key
        );
      }
    }
  } catch (err) {
    // Netzwerkfehler im Hintergrund still ignorieren
  }
}

/** Berechnet den Zeitpunkt (ms), zu dem eine Erinnerung ausgelöst werden soll */
function computeFireTime(dateStr, timeStr, reminderMinutes) {
  if (!dateStr) return null;
  const time = timeStr || "09:00"; // Fallback: 9 Uhr, falls keine Uhrzeit gesetzt
  const target = new Date(`${dateStr}T${time}:00`);
  if (isNaN(target.getTime())) return null;
  return target.getTime() - Number(reminderMinutes) * 60 * 1000;
}

async function showAppNotification(title, body, key) {
  await self.registration.showNotification(title, {
    body,
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: key,
    vibrate: [120, 60, 120],
    data: { key }
  });
  await markNotified(key);
}

// ── Bereits gesendete Erinnerungen merken (IndexedDB-freie Mini-Lösung via Cache) ──

async function getNotifiedIds() {
  try {
    const cache = await caches.open("notified-store");
    const res = await cache.match("notified-keys");
    if (!res) return new Set();
    const arr = await res.json();
    return new Set(arr);
  } catch {
    return new Set();
  }
}

async function markNotified(key) {
  try {
    const cache = await caches.open("notified-store");
    const ids = await getNotifiedIds();
    ids.add(key);
    // Auf maximal 500 Einträge begrenzen, damit der Speicher nicht unbegrenzt wächst
    const trimmed = Array.from(ids).slice(-500);
    await cache.put("notified-keys", new Response(JSON.stringify(trimmed)));
  } catch {
    // ignorieren
  }
}

// Klick auf Benachrichtigung → App öffnen/fokussieren
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("./index.html");
    })
  );
});
