/**
 * ALL-IN-ONE PRODUKTIVITÄTS-APP — app.js
 * Firebase Realtime Database · E-Mail/Passwort-Login (Mehrbenutzerfähig) · Vanilla JS ES6+ Modules
 */

// ═══════════════════════════════════════════════════════
// 1. FIREBASE KONFIGURATION & INITIALISIERUNG
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, push, set, update, remove, onValue, get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth, onAuthStateChanged, signOut,
  createUserWithEmailAndPassword, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyB0Js8rK0QjQE71uruCkx0XukCTYoVk9Mg",
  authDomain:        "all-in-one-200f2.firebaseapp.com",
  projectId:         "all-in-one-200f2",
  storageBucket:     "all-in-one-200f2.firebasestorage.app",
  messagingSenderId: "925006637976",
  appId:             "1:925006637976:web:724c53d30ad77372e319ed",
  measurementId:     "G-F1K8G4GX48",
  databaseURL:       "https://all-in-one-200f2-default-rtdb.europe-west1.firebasedatabase.app"
};

const firebaseApp = initializeApp(firebaseConfig);
const db   = getDatabase(firebaseApp);
const auth = getAuth(firebaseApp);

// Punkt 3: Jeder Nutzer bekommt seinen eigenen Datenbereich unter users/{uid}/...
let currentUid = null;

const REFS = {
  events:    () => ref(db, `users/${currentUid}/events`),
  event:     (id) => ref(db, `users/${currentUid}/events/${id}`),
  todos:     () => ref(db, `users/${currentUid}/todos`),
  todo:      (id) => ref(db, `users/${currentUid}/todos/${id}`),
  notes:     () => ref(db, `users/${currentUid}/notes`),
  note:      (id) => ref(db, `users/${currentUid}/notes/${id}`),
  projects:  () => ref(db, `users/${currentUid}/projects`),
  project:   (id) => ref(db, `users/${currentUid}/projects/${id}`),
  calendars: () => ref(db, `users/${currentUid}/calendars`),
  calendar:  (id) => ref(db, `users/${currentUid}/calendars/${id}`),
  // Training-Tracking: ein Eintrag pro Tag, Schlüssel = Datum "YYYY-MM-DD"
  checkins:  () => ref(db, `users/${currentUid}/checkins`),
  checkin:   (dateStr) => ref(db, `users/${currentUid}/checkins/${dateStr}`),
  injuries:  () => ref(db, `users/${currentUid}/injuries`),
  injury:    (id) => ref(db, `users/${currentUid}/injuries/${id}`),
  workouts:  () => ref(db, `users/${currentUid}/workouts`),
  workout:   (id) => ref(db, `users/${currentUid}/workouts/${id}`),
  profile:   () => ref(db, `users/${currentUid}/profile`),
  settings:  () => ref(db, `users/${currentUid}/settings`)
};

// ═══════════════════════════════════════════════════════
// 1b. EINMALIGE MIGRATION ALTER DATEN (aus der Zeit vor dem Mehrbenutzer-Login)
// ═══════════════════════════════════════════════════════

const LEGACY_ROOT_PATHS = ["events", "todos", "notes", "projects", "calendars", "checkins", "injuries", "workouts"];

/**
 * Kopiert einmalig die alten, nicht nutzerspezifischen Daten (aus der Zeit vor dem Login)
 * in den persönlichen Bereich des gerade angemeldeten Nutzers. Läuft nur einmal pro Nutzer,
 * erkennbar an der Marke users/{uid}/_migrated.
 */
async function migrateLegacyDataIfNeeded(uid) {
  try {
    const migratedSnap = await get(ref(db, `users/${uid}/_migrated`));
    if (migratedSnap.exists() && migratedSnap.val() === true) return;

    const updates = {};
    let foundAny = false;

    for (const path of LEGACY_ROOT_PATHS) {
      const snap = await get(ref(db, path));
      if (snap.exists()) {
        updates[`users/${uid}/${path}`] = snap.val();
        foundAny = true;
      }
    }

    updates[`users/${uid}/_migrated`] = true;
    await update(ref(db), updates);

    if (foundAny) showToast("Bestehende Daten übernommen ✓");
  } catch (e) {
    // Migration ist ein Best-Effort-Vorgang; ein Fehler hier soll den Login nicht blockieren
    console.warn("Migration fehlgeschlagen:", e.message);
  }
}

// ═══════════════════════════════════════════════════════
// 2. APP STATE
// ═══════════════════════════════════════════════════════

const state = {
  currentView:          "calendar",
  currentDate:          new Date(),
  selectedDate:         toDateString(new Date()),
  monthExpanded:        false,
  events:               {},
  todos:                {},
  notes:                {},
  projects:             {},
  calendars:            {},
  todoFilter:           "all",
  calFilter:             "all",   // Punkt 5: aktiver Kalenderfilter
  activeProjectId:      null,
  selectedProjectColor: "#6C63FF",
  selectedCalendarColor:"#6C63FF",
  openTodoIds:          new Set(), // welche To-Do-Beschreibungen aufgeklappt sind
  // Training-Tracking
  checkins:             {},  // { "YYYY-MM-DD": { weight, sleepHours, sleepQuality, water, caffeine } }
  injuries:             {},
  openInjuryIds:        new Set(),
  workouts:             {},
  openWorkoutIds:       new Set(),
  selectedZones:        new Set(), // aktuell im Trainings-Modal ausgewählte Zonen
  editingWorkoutId:      null,
  weeklyReviewOffset:    0, // 0 = aktuelle Woche, -1 = letzte Woche, etc.
  profile:               {},
  selectedMainSports:    new Set(),
  settings:              {}
};

// ═══════════════════════════════════════════════════════
// 2c. TRAINING: SPORTARTEN & ZONEN (Punkt 3)
// ═══════════════════════════════════════════════════════

const SPORTS = {
  swim:  { label: "Swim", icon: "🏊" },
  bike:  { label: "Bike", icon: "🚴" },
  run:   { label: "Run",  icon: "🏃" },
  other: { label: "Sonstiges", icon: "💪" }
};

/** Punkt 1: Unterarten für die Sportart "Sonstiges" */
const OTHER_TYPES = [
  { id: "hit",       label: "HIT",       icon: "🔥" },
  { id: "athletics", label: "Athletik",  icon: "🏋️" },
  { id: "mobility",  label: "Mobility",  icon: "🧘" }
];

function otherTypeInfo(id) {
  return OTHER_TYPES.find(t => t.id === id) || OTHER_TYPES[0];
}

/** Liefert Icon+Label für die Anzeige eines Workouts, berücksichtigt die Unterart bei "Sonstiges" */
function workoutDisplayInfo(w) {
  if (w.sport === "other") {
    const t = otherTypeInfo(w.otherType);
    return { icon: t.icon, label: t.label };
  }
  return SPORTS[w.sport] || { icon: "🏋️", label: w.sport || "Training" };
}

const TRAINING_ZONES = [
  { id: "z1_erholung", label: "Z1 · Erholung" },
  { id: "z2_ausdauer", label: "Z2 · Ausdauer" },
  { id: "z2_fatmax",   label: "Z2 · FatMax" },
  { id: "z3_tempo",    label: "Z3 · Tempo" },
  { id: "z4_schwelle", label: "Z4 · Schwelle" },
  { id: "z5_vo2max",   label: "Z5 · VO2Max" },
  { id: "z5_neuro",    label: "Z5 · Neuro" },
  { id: "z5_anaerob",  label: "Z5 · Anaerob" }
];

function zoneLabel(zoneId) {
  return TRAINING_ZONES.find(z => z.id === zoneId)?.label || zoneId;
}

// ═══════════════════════════════════════════════════════
// 2b. SPRÜCHE FÜR TAGE OHNE TERMINE (Punkt 2)
// ═══════════════════════════════════════════════════════

const FREE_DAY_QUOTES = [
  { text: "Ein leerer Kalender ist kein leerer Tag.", author: "" },
  { text: "Manchmal ist das Beste, was man planen kann, nichts zu planen.", author: "" },
  { text: "Freiraum ist auch Produktivität.", author: "" },
  { text: "Heute gehört dir.", author: "" },
  { text: "Die Ruhe vor dem Sturm ist auch nur Ruhe – genieß sie.", author: "" },
  { text: "Ein Tag ohne Termine ist ein Tag voller Möglichkeiten.", author: "" },
  { text: "Erfolg ist auch, sich bewusst Zeit zu nehmen.", author: "" },
  { text: "Manchmal ist Nichtstun die produktivste Entscheidung.", author: "" },
  { text: "Du musst nicht jeden Tag etwas erreichen, um wertvoll zu sein.", author: "" },
  { text: "Genieße den freien Raum – er kommt nicht jeden Tag.", author: "" }
];

function pickDailyQuote() {
  // Deterministisch je nach Datum, damit der Spruch über den Tag stabil bleibt
  const seed = today().split("-").join("");
  const idx = parseInt(seed, 10) % FREE_DAY_QUOTES.length;
  return FREE_DAY_QUOTES[idx];
}

// ═══════════════════════════════════════════════════════
// 3. HILFSFUNKTIONEN
// ═══════════════════════════════════════════════════════

function toDateString(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,"0"), day = String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function today() { return toDateString(new Date()); }
function formatDate(str) {
  if (!str) return "";
  const [y,m,d] = str.split("-");
  return `${d}.${m}.${y}`;
}
function formatMonthYear(date) {
  return date.toLocaleString("de-DE", { month: "long", year: "numeric" });
}

// ── Punkt 1: Schlafdauer als Stunden+Minuten statt Dezimalzahl ──

/** Stunden (Ganzzahl) + Minuten (0-59) → Dezimalstunden, z.B. 7h 30min → 7.5 */
function hmToDecimalHours(h, m) {
  const hh = Number(h) || 0;
  const mm = Number(m) || 0;
  return Math.round((hh + mm / 60) * 100) / 100;
}

/** Dezimalstunden → { h, m }, z.B. 7.5 → { h: 7, m: 30 } */
function decimalHoursToHM(decimal) {
  if (decimal === undefined || decimal === null || decimal === "") return { h: "", m: "" };
  const totalMinutes = Math.round(Number(decimal) * 60);
  return { h: Math.floor(totalMinutes / 60), m: totalMinutes % 60 };
}

/** Dezimalstunden → Anzeige-String, z.B. 7.5 → "7h 30min" */
function formatSleepDuration(decimal) {
  if (decimal === undefined || decimal === null || decimal === "") return "";
  const { h, m } = decimalHoursToHM(decimal);
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

/** Dauer aus Stunden+Minuten → Anzeige-String, z.B. (1, 15) → "1h 15min" */
function formatWorkoutDuration(hours, minutes, seconds) {
  const h = Number(hours) || 0;
  const m = Number(minutes) || 0;
  const s = Number(seconds) || 0;
  if (h === 0 && m === 0 && s === 0) return "–";
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || h > 0) parts.push(`${m}min`);
  if (s > 0) parts.push(`${s}s`);
  return parts.join(" ");
}
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

// ── PUNKT 2: Lösch-Bestätigung ──
let pendingDeleteAction = null;

/**
 * Öffnet ein Bestätigungs-Modal. onConfirm wird nur ausgeführt,
 * wenn der Nutzer aktiv auf "Löschen" tippt.
 */
function confirmDelete({ title = "Wirklich löschen?", text = "Diese Aktion kann nicht rückgängig gemacht werden.", confirmLabel = "Löschen", onConfirm }) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
  document.getElementById("confirm-delete-btn").textContent = confirmLabel;
  pendingDeleteAction = onConfirm;
  openModal("modal-confirm");
}

/** Entfernt ein Listen-Element optisch (Animation), bevor es aus dem DOM verschwindet */
function animateRemoval(el, callback) {
  if (!el) { callback?.(); return; }
  el.classList.add("item-removing");
  setTimeout(() => callback?.(), 260);
}

/** Schüttelt ein Modal-Sheet kurz, um auf einen Validierungsfehler hinzuweisen */
function shakeModal(modalId) {
  const sheet = document.querySelector(`#${modalId} .modal-sheet`);
  if (!sheet) return;
  sheet.classList.remove("shake");
  void sheet.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
  sheet.classList.add("shake");
  setTimeout(() => sheet.classList.remove("shake"), 400);
}
function toArray(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([id, val]) => ({ ...val, id }));
}
function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
/** Liefert die Farbe eines Kalenders, Fallback = Akzentfarbe */
function calColor(calendarId) {
  return (calendarId && state.calendars[calendarId]?.color) || "#6C63FF";
}

// ═══════════════════════════════════════════════════════
// 3b. AKZENTFARBE (Punkt 4: Einstellungen)
// ═══════════════════════════════════════════════════════

const ACCENT_STORAGE_KEY = "allInOne_accentColor";

function hexToRgb(hex) {
  const clean = hex.replace("#", "");
  const bigint = parseInt(clean, 16);
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 };
}

function lightenColor(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return `rgb(${nr}, ${ng}, ${nb})`;
}

/** Setzt die Akzentfarbe der gesamten App zur Laufzeit (alle abgeleiteten Verläufe/Glows inklusive) */
function applyAccentColor(hex) {
  const { r, g, b } = hexToRgb(hex);
  const root = document.documentElement.style;
  root.setProperty("--accent", hex);
  root.setProperty("--accent-light", lightenColor(hex, 0.28));
  root.setProperty("--accent-dim", `rgba(${r}, ${g}, ${b}, 0.15)`);
  root.setProperty("--accent-mid", `rgba(${r}, ${g}, ${b}, 0.35)`);
  root.setProperty("--accent-glow", `rgba(${r}, ${g}, ${b}, 0.4)`);
  localStorage.setItem(ACCENT_STORAGE_KEY, hex);

  document.querySelectorAll("#accent-color-picker .color-dot").forEach(dot => {
    dot.classList.toggle("selected", dot.dataset.color.toLowerCase() === hex.toLowerCase());
  });
}

// Sofort beim Laden die zuletzt gewählte Farbe anwenden (bevor Firebase-Daten eintreffen),
// damit die App nicht kurz in Standard-Violett aufblitzt.
(function applyCachedAccentColor() {
  const cached = localStorage.getItem(ACCENT_STORAGE_KEY);
  if (cached) applyAccentColor(cached);
})();

// ═══════════════════════════════════════════════════════
// 4. FIREBASE CRUD — EVENTS
// ═══════════════════════════════════════════════════════

async function createEvent(data) {
  try {
    const newRef = push(REFS.events());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Termin gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function updateEvent(id, data) {
  try {
    await update(REFS.event(id), data);
    showToast("Termin aktualisiert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function deleteEvent(id) {
  try { await remove(REFS.event(id)); showToast("Termin gelöscht"); }
  catch (e) { showToast("Fehler beim Löschen: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 4b. BENACHRICHTIGUNGEN — Berechtigung & Banner (Punkt 1)
// ═══════════════════════════════════════════════════════

const NOTIF_DISMISS_KEY = "allInOne_notifBannerDismissed";

function notificationsSupported() {
  return "Notification" in window && "serviceWorker" in navigator;
}

function updateNotifBanner() {
  const banner = document.getElementById("notif-banner");
  if (!notificationsSupported()) { banner.classList.remove("show"); return; }

  const dismissed = localStorage.getItem(NOTIF_DISMISS_KEY) === "1";
  const permission = Notification.permission; // "default" | "granted" | "denied"

  if (permission === "default" && !dismissed) {
    banner.classList.add("show");
  } else {
    banner.classList.remove("show");
  }
}

async function requestNotificationPermission() {
  if (!notificationsSupported()) {
    showToast("Benachrichtigungen werden auf diesem Gerät nicht unterstützt");
    return;
  }
  try {
    const result = await Notification.requestPermission();
    if (result === "granted") {
      showToast("Benachrichtigungen aktiviert ✓");
      // Kurzer Test-Hinweis, dass es funktioniert
      navigator.serviceWorker.ready.then(reg => {
        reg.showNotification("All-in-One", {
          body: "Erinnerungen sind jetzt aktiv.",
          icon: "icons/icon-192.png",
          tag: "welcome"
        });
      });
    } else {
      showToast("Berechtigung wurde nicht erteilt");
    }
  } catch (e) {
    showToast("Fehler: " + e.message);
  }
  updateNotifBanner();
}

document.getElementById("notif-enable-btn").addEventListener("click", requestNotificationPermission);
document.getElementById("notif-dismiss-btn").addEventListener("click", () => {
  localStorage.setItem(NOTIF_DISMISS_KEY, "1");
  updateNotifBanner();
});

// ═══════════════════════════════════════════════════════
// 5. FIREBASE CRUD — TO-DOS
// ═══════════════════════════════════════════════════════

async function createTodo(data) {
  try {
    const newRef = push(REFS.todos());
    await set(newRef, { ...data, done: false, createdAt: Date.now() });
    showToast("To-Do gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function toggleTodo(id, currentDone) {
  try {
    const nowDone = !currentDone;
    await update(REFS.todo(id), { done: nowDone, completedAt: nowDone ? Date.now() : null });
  }
  catch (e) { showToast("Fehler: " + e.message); }
}
async function deleteTodo(id) {
  try { await remove(REFS.todo(id)); showToast("To-Do gelöscht"); }
  catch (e) { showToast("Fehler beim Löschen: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 6. FIREBASE CRUD — NOTIZEN
// ═══════════════════════════════════════════════════════

async function createNote(data) {
  try {
    const newRef = push(REFS.notes());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Notiz gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function deleteNote(id) {
  try { await remove(REFS.note(id)); showToast("Notiz gelöscht"); }
  catch (e) { showToast("Fehler beim Löschen: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 7. FIREBASE CRUD — PROJEKTE
// ═══════════════════════════════════════════════════════

async function createProject(data) {
  try {
    const newRef = push(REFS.projects());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast(`Projekt "${data.name}" erstellt ✓`);
  } catch (e) { showToast("Fehler: " + e.message); }
}
async function deleteProject(id) {
  try {
    await remove(REFS.project(id));
    const todosSnap = await get(REFS.todos());
    if (todosSnap.exists()) {
      const updates = {};
      Object.entries(todosSnap.val()).forEach(([tid, t]) => {
        if (t.projectId === id) updates[`todos/${tid}/projectId`] = null;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
    const notesSnap = await get(REFS.notes());
    if (notesSnap.exists()) {
      const updates = {};
      Object.entries(notesSnap.val()).forEach(([nid, n]) => {
        if (n.projectId === id) updates[`notes/${nid}/projectId`] = null;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
    showToast("Projekt gelöscht");
  } catch (e) { showToast("Fehler: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 8. FIREBASE CRUD — KALENDER (Punkt 5)
// ═══════════════════════════════════════════════════════

async function createCalendar(data) {
  try {
    const newRef = push(REFS.calendars());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast(`Kalender "${data.name}" erstellt ✓`);
  } catch (e) { showToast("Fehler: " + e.message); }
}
async function deleteCalendar(id) {
  try {
    await remove(REFS.calendar(id));
    // Verknüpfte Events: calendarId entfernen, nicht löschen
    const evSnap = await get(REFS.events());
    if (evSnap.exists()) {
      const updates = {};
      Object.entries(evSnap.val()).forEach(([eid, e]) => {
        if (e.calendarId === id) updates[`events/${eid}/calendarId`] = null;
      });
      if (Object.keys(updates).length) await update(ref(db), updates);
    }
    if (state.calFilter === id) state.calFilter = "all";
    showToast("Kalender gelöscht");
  } catch (e) { showToast("Fehler: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 8b. FIREBASE CRUD — TRAINING: CHECK-INS (Schlaf, Gewicht, Flüssigkeit, Koffein)
// ═══════════════════════════════════════════════════════

/** Ein Check-in pro Tag. set() mit merge-Verhalten über update(), damit Teil-Updates möglich sind. */
async function saveCheckin(dateStr, data) {
  try {
    await update(REFS.checkin(dateStr), { ...data, updatedAt: Date.now() });
    showToast("Gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 8c. FIREBASE CRUD — TRAINING: VERLETZUNGEN / KRANKHEIT
// ═══════════════════════════════════════════════════════

async function createInjury(data) {
  try {
    const newRef = push(REFS.injuries());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Eintrag gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function deleteInjury(id) {
  try { await remove(REFS.injury(id)); showToast("Eintrag gelöscht"); }
  catch (e) { showToast("Fehler beim Löschen: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 8d. FIREBASE CRUD — TRAINING: WORKOUTS (Punkt 3)
// ═══════════════════════════════════════════════════════

async function createWorkout(data) {
  try {
    const newRef = push(REFS.workouts());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Training gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function updateWorkout(id, data) {
  try {
    await update(REFS.workout(id), data);
    showToast("Training aktualisiert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function deleteWorkout(id) {
  try { await remove(REFS.workout(id)); showToast("Training gelöscht"); }
  catch (e) { showToast("Fehler beim Löschen: " + e.message); }
}

// ═══════════════════════════════════════════════════════
// 9. FIREBASE REALTIME LISTENER
// ═══════════════════════════════════════════════════════

/** Leert den lokalen Zustand (z.B. beim Nutzerwechsel), damit nie Daten des vorherigen Nutzers aufblitzen */
function resetAppState() {
  state.events = {};
  state.todos = {};
  state.notes = {};
  state.projects = {};
  state.calendars = {};
  state.checkins = {};
  state.injuries = {};
  state.workouts = {};
  state.profile = {};
  state.settings = {};
  state.calFilter = "all";
  state.activeProjectId = null;
  state.openTodoIds = new Set();
  state.openInjuryIds = new Set();
  state.openWorkoutIds = new Set();

  renderCalendar();
  renderWeekStrip();
  renderDayEvents();
  renderTodayTodos();
  renderTodoList();
  renderNotesList();
  renderProjectGrid();
  renderCalFilterBar();
  renderTodayStats();
  renderWeightHistory();
  renderProgressChart();
  renderInjuryList();
  renderWorkoutList();
  renderDashboardHero();
  renderActivityHeatmap();
}

function initListeners() {
  onValue(REFS.events(), snap => {
    state.events = snap.exists() ? snap.val() : {};
    renderCalendar();
    renderWeekStrip();
    renderDayEvents();
    renderTodayTodos();
    renderDashboardHero();
  });

  onValue(REFS.todos(), snap => {
    state.todos = snap.exists() ? snap.val() : {};
    renderTodoList();
    renderTodayTodos();
    renderProjectDetail();
    populateProjectSelects();
    renderDashboardHero();
    renderActivityHeatmap();
  });

  onValue(REFS.notes(), snap => {
    state.notes = snap.exists() ? snap.val() : {};
    renderNotesList();
    renderProjectDetail();
    populateProjectSelects();
  });

  onValue(REFS.projects(), snap => {
    state.projects = snap.exists() ? snap.val() : {};
    renderProjectGrid();
    renderProjectDetail();
    populateProjectSelects();
  });

  onValue(REFS.calendars(), snap => {
    state.calendars = snap.exists() ? snap.val() : {};
    renderCalFilterBar();
    populateCalendarSelect();
    populateWorkoutCalendarSelect();
    renderCalendarManageList();
    renderCalendar();
    renderWeekStrip();
    renderDayEvents();
    renderWorkoutList();
  });

  onValue(REFS.checkins(), snap => {
    state.checkins = snap.exists() ? snap.val() : {};
    renderTodayStats();
    renderWeightHistory();
    renderProgressChart();
    renderActivityHeatmap();
    renderDashboardHero();
    if (document.getElementById("modal-intake").classList.contains("open")) {
      renderIntakeRing(activeIntakeType);
    }
  });

  onValue(REFS.injuries(), snap => {
    state.injuries = snap.exists() ? snap.val() : {};
    renderInjuryList();
  });

  onValue(REFS.profile(), snap => {
    state.profile = snap.exists() ? snap.val() : {};
    renderDashboardHero();
  });

  onValue(REFS.settings(), snap => {
    state.settings = snap.exists() ? snap.val() : {};
    if (state.settings.accentColor) applyAccentColor(state.settings.accentColor);
  });

  onValue(REFS.workouts(), snap => {
    state.workouts = snap.exists() ? snap.val() : {};
    renderWorkoutList();
    populateWorkoutCalendarSelect();
    // Workouts erscheinen auch im Kalender (Punkt 3) — dort neu rendern
    renderCalendar();
    renderWeekStrip();
    renderDayEvents();
    renderDashboardHero();
    renderActivityHeatmap();
  });
}

// ═══════════════════════════════════════════════════════
// 10. SPA ROUTING
// ═══════════════════════════════════════════════════════

function navigate(viewName, direction) {
  state.currentView = viewName;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active", "slide-in-left", "slide-in-right"));
  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.add("active");
    // Punkt 2: Richtungsanimation beim Seitenwechsel (Swipe oder Tab-Klick)
    if (direction === "forward") {
      target.classList.add("slide-in-right");
    } else if (direction === "backward") {
      target.classList.add("slide-in-left");
    }
  }
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  const titles = { calendar:"Kalender", projects:"Projekte", todos:"To-Dos", notes:"Notizen", training:"Training" };
  document.getElementById("header-title").textContent = titles[viewName] || "";
  renderHeaderActions();
}

/** Punkt 5: Im Kalender-View zusätzlich einen "Kalender verwalten"-Button anzeigen */
function renderHeaderActions() {
  const right = document.getElementById("header-right");

  // Punkt 1+2: Wochenrückblick-Button nur im Training-Tab
  let weeklyBtn = document.getElementById("weekly-review-btn");
  if (state.currentView === "training") {
    if (!weeklyBtn) {
      weeklyBtn = document.createElement("button");
      weeklyBtn.id = "weekly-review-btn";
      weeklyBtn.className = "icon-btn";
      weeklyBtn.setAttribute("aria-label", "Wochenrückblick");
      weeklyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`;
      weeklyBtn.addEventListener("click", () => {
        state.weeklyReviewOffset = 0;
        renderWeeklyReview();
        openModal("modal-weekly-review");
      });
      right.insertBefore(weeklyBtn, document.getElementById("header-action-btn"));
    }
    weeklyBtn.style.display = "flex";
  } else if (weeklyBtn) {
    weeklyBtn.style.display = "none";
  }
}

// ═══════════════════════════════════════════════════════
// 11. KALENDER RENDERING (Punkt 4: Wochenstreifen + Aufklappbar)
// ═══════════════════════════════════════════════════════

/** Sammelt Events + Workouts gruppiert nach Datum, gefiltert nach aktivem Kalender-Filter */
/** Anzahl Tage zwischen zwei "YYYY-MM-DD"-Daten (b - a) */
function daysBetweenDates(dateStrA, dateStrB) {
  const a = new Date(dateStrA + "T00:00:00");
  const b = new Date(dateStrB + "T00:00:00");
  return Math.round((b - a) / (1000 * 60 * 60 * 24));
}

/** Punkt 1: Prüft, ob ein Termin (ggf. wiederkehrend) an einem bestimmten Datum stattfindet */
function eventOccursOnDate(e, dateStr) {
  if (!e.date) return false;
  if (dateStr < e.date) return false; // vor dem ersten Auftreten gibt's nie eine Wiederholung
  if (!e.recurrence || e.recurrence === "none") return e.date === dateStr;

  const daysDiff = daysBetweenDates(e.date, dateStr);
  switch (e.recurrence) {
    case "daily":      return true;
    case "every2days": return daysDiff % 2 === 0;
    case "weekly":     return daysDiff % 7 === 0;
    case "yearly": {
      const anchor = new Date(e.date + "T00:00:00");
      const d = new Date(dateStr + "T00:00:00");
      return anchor.getMonth() === d.getMonth() && anchor.getDate() === d.getDate();
    }
    default: return e.date === dateStr;
  }
}

/** Liefert alle Termine + Trainings, die an einem bestimmten Datum vorkommen (inkl. Wiederholungen) */
function getCalendarItemsForDate(dateStr) {
  const items = [];
  Object.entries(state.events).forEach(([id, e]) => {
    if (state.calFilter !== "all" && e.calendarId !== state.calFilter) return;
    if (eventOccursOnDate(e, dateStr)) items.push({ ...e, id, _type: "event" });
  });
  Object.entries(state.workouts).forEach(([id, w]) => {
    if (!w.date || w.date !== dateStr) return;
    if (state.calFilter !== "all" && w.calendarId !== state.calFilter) return;
    items.push({ ...w, id, _type: "workout" });
  });
  return items;
}

// ═══════════════════════════════════════════════════════
// 10b. DASHBOARD-HERO (Punkt 3: persönliche Begrüßung)
// ═══════════════════════════════════════════════════════

/** Punkt 1 (Redesign): Streak = Anzahl aufeinanderfolgender Tage bis heute mit
    mindestens einer Aktivität (Training geloggt, Aufgabe erledigt, oder Check-in) */
function calculateStreak() {
  const activeDates = new Set();
  toArray(state.workouts).forEach(w => { if (w.date) activeDates.add(w.date); });
  toArray(state.todos).forEach(td => {
    if (td.completedAt) activeDates.add(toDateString(new Date(td.completedAt)));
  });
  Object.keys(state.checkins).forEach(dateStr => {
    const c = state.checkins[dateStr];
    if (c && (c.weight || c.sleepHours || c.water || c.caffeine)) activeDates.add(dateStr);
  });

  let streak = 0;
  let cursor = new Date();
  // Wenn heute noch nichts erfasst wurde, zählt der Streak trotzdem ab gestern weiter
  if (!activeDates.has(toDateString(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (activeDates.has(toDateString(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function renderDashboardHero() {
  const now = new Date();
  const hour = now.getHours();
  let base = "Guten Morgen";
  if (hour >= 11 && hour < 17) base = "Hallo";
  else if (hour >= 17) base = "Guten Abend";

  const name = state.profile?.name?.trim();
  document.getElementById("hero-greeting").textContent = name ? `${base}, ${name}!` : `${base}!`;

  const dateLabel = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("hero-date").textContent = dateLabel;

  const t = today();
  const eventCount = Object.values(state.events).filter(e => eventOccursOnDate(e, t)).length;
  const openTodoCount = toArray(state.todos).filter(td => td.dueDate === t && !td.done).length;
  const streak = calculateStreak();

  const row = document.getElementById("hero-summary-row");
  row.innerHTML = `
    <div class="hero-stat-pill">
      <div class="hero-stat-top"><span class="hero-stat-icon">🔥</span><span class="hero-stat-label">Streak</span></div>
      <div class="hero-stat-value ${streak > 0 ? "accent" : ""}">${streak}</div>
    </div>
    <div class="hero-stat-pill">
      <div class="hero-stat-top"><span class="hero-stat-icon">🗓️</span><span class="hero-stat-label">Termine</span></div>
      <div class="hero-stat-value">${eventCount}</div>
    </div>
    <div class="hero-stat-pill">
      <div class="hero-stat-top"><span class="hero-stat-icon">✅</span><span class="hero-stat-label">Offen</span></div>
      <div class="hero-stat-value ${openTodoCount === 0 ? "good" : ""}">${openTodoCount}</div>
    </div>
  `;
}

function renderCalendar() {
  const grid  = document.getElementById("calendar-grid");
  const label = document.getElementById("cal-month-label");
  const d = state.currentDate, yr = d.getFullYear(), mo = d.getMonth();
  label.textContent = formatMonthYear(d);

  const firstDay = new Date(yr, mo, 1);
  let startOffset = firstDay.getDay() - 1;
  if (startOffset < 0) startOffset = 6;

  const daysInMonth = new Date(yr, mo+1, 0).getDate();
  const daysInPrev  = new Date(yr, mo, 0).getDate();

  let html = "", cellCount = 0;

  for (let i = startOffset - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev - i}</span></div>`;
    cellCount++;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const isToday = dateStr === today();
    const isSelected = dateStr === state.selectedDate;
    const dayItems = getCalendarItemsForDate(dateStr);
    const classes = ["cal-day", isToday?"today":"", isSelected?"selected":""].filter(Boolean).join(" ");

    const dots = dayItems.slice(0,3).map(item =>
      `<span class="event-dot ${item._type === 'workout' ? 'workout-dot' : ''}" style="background:${calColor(item.calendarId)}"></span>`
    ).join("");

    html += `<div class="${classes}" data-date="${dateStr}">
      <span class="cal-day-num">${day}</span>
      <div class="cal-day-dots">${dots}</div>
    </div>`;
    cellCount++;
  }

  let nextDay = 1;
  while (cellCount < 42) {
    html += `<div class="cal-day other-month"><span class="cal-day-num">${nextDay++}</span></div>`;
    cellCount++;
  }

  grid.innerHTML = html;
  grid.querySelectorAll(".cal-day[data-date]").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedDate = el.dataset.date;
      renderCalendar(); renderWeekStrip(); renderDayEvents(); renderTodayTodos();
    });
  });
}

function renderWeekStrip() {
  const strip = document.getElementById("week-strip");
  const sel = new Date(state.selectedDate + "T00:00:00");
  const dow = sel.getDay() === 0 ? 6 : sel.getDay() - 1;
  const mon = new Date(sel);
  mon.setDate(sel.getDate() - dow);

  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = toDateString(d);
    const isT = ds === today(), isSel = ds === state.selectedDate;
    const dayItems = getCalendarItemsForDate(ds);
    const dots = dayItems.slice(0,3).map(item =>
      `<span class="event-dot ${item._type === 'workout' ? 'workout-dot' : ''}" style="background:${calColor(item.calendarId)}"></span>`
    ).join("");

    html += `<div class="week-day-item ${isT?"today":""} ${isSel?"selected":""}" data-date="${ds}">
      <span class="week-day-num">${d.getDate()}</span>
      <div class="event-dots">${dots}</div>
    </div>`;
  }
  strip.innerHTML = html;

  strip.querySelectorAll(".week-day-item").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedDate = el.dataset.date;
      const clicked = new Date(el.dataset.date + "T00:00:00");
      if (clicked.getMonth() !== state.currentDate.getMonth() ||
          clicked.getFullYear() !== state.currentDate.getFullYear()) {
        state.currentDate = new Date(clicked.getFullYear(), clicked.getMonth(), 1);
      }
      renderCalendar(); renderWeekStrip(); renderDayEvents(); renderTodayTodos();
    });
  });
}

/** Punkt 4: Auf-/Zuklappen des Monatskalenders */
function toggleMonthExpand() {
  state.monthExpanded = !state.monthExpanded;
  const expand = document.getElementById("month-expand");
  const monthNav = document.getElementById("cal-month-nav");
  const toggleBtn = document.getElementById("expand-toggle");
  expand.classList.toggle("open", state.monthExpanded);
  monthNav.classList.toggle("open", state.monthExpanded);
  toggleBtn.classList.toggle("open", state.monthExpanded);
  if (state.monthExpanded) renderCalendar();
}

function renderDayEvents() {
  const list = document.getElementById("day-event-list");
  const title = document.getElementById("day-events-title");
  const sd = state.selectedDate;
  title.textContent = sd === today() ? "Heute" : formatDate(sd);

  let dayEvents = Object.entries(state.events).filter(([, e]) => eventOccursOnDate(e, sd));
  if (state.calFilter !== "all") dayEvents = dayEvents.filter(([, e]) => e.calendarId === state.calFilter);
  dayEvents.sort(([, a], [, b]) => (a.time || "").localeCompare(b.time || ""));

  let dayWorkouts = Object.entries(state.workouts).filter(([, w]) => w.date === sd);
  if (state.calFilter !== "all") dayWorkouts = dayWorkouts.filter(([, w]) => w.calendarId === state.calFilter);

  if (!dayEvents.length && !dayWorkouts.length) {
    list.innerHTML = `<li class="empty-state">Keine Einträge für diesen Tag.</li>`;
    return;
  }

  const eventsHtml = dayEvents.map(([id, e]) => {
    const color = calColor(e.calendarId);
    const calName = e.calendarId ? state.calendars[e.calendarId]?.name : null;
    const recurrenceIcon = (e.recurrence && e.recurrence !== "none") ? " 🔁" : "";
    return `
    <li class="event-item" style="--event-color:${color}" data-edit-event="${id}">
      <span class="event-time">${e.time || "–"}</span>
      <div class="event-info">
        <div class="event-title-text">${escHtml(e.title)}${recurrenceIcon}</div>
        ${e.description ? `<div class="event-desc-text">${escHtml(e.description)}</div>` : ""}
        ${calName ? `<span class="event-cal-badge" style="margin-top:4px;display:inline-block">${escHtml(calName)}${(e.reminderMinutes !== undefined && e.reminderMinutes !== null) ? " · 🔔" : ""}</span>` : ""}
      </div>
      <button class="delete-btn" data-id="${id}" data-kind="event" aria-label="Löschen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>`;
  }).join("");

  const workoutsHtml = dayWorkouts.map(([id, w]) => {
    const color = calColor(w.calendarId);
    const calName = w.calendarId ? state.calendars[w.calendarId]?.name : null;
    const sport = workoutDisplayInfo(w);
    const durationStr = formatWorkoutDuration(w.durationHours, w.durationMinutes, w.durationSeconds);
    const distanceStr = (w.distance !== undefined && w.distance !== null) ? `${w.distance} ${distanceUnitFor(w.sport)}` : null;
    const metric = computeWorkoutMetric(w.sport, w.distance, w.durationHours, w.durationMinutes, w.durationSeconds);
    const detailParts = [durationStr, distanceStr, metric, (w.load !== undefined && w.load !== null) ? `Belastung ${w.load}` : null].filter(Boolean);
    return `
    <li class="event-item" style="--event-color:${color}">
      <span class="event-time" title="${sport.label}">${sport.icon}</span>
      <div class="event-info">
        <div class="event-title-text">${escHtml(w.title || sport.label)}</div>
        <div class="event-desc-text">${detailParts.join(" · ")}</div>
        ${calName ? `<span class="event-cal-badge" style="margin-top:4px;display:inline-block">${escHtml(calName)}</span>` : ""}
      </div>
      <button class="delete-btn" data-id="${id}" data-kind="workout" aria-label="Löschen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>`;
  }).join("");

  list.innerHTML = eventsHtml + workoutsHtml;

  list.querySelectorAll('.delete-btn[data-kind="event"]').forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ev = state.events[btn.dataset.id];
      const isRecurring = ev?.recurrence && ev.recurrence !== "none";
      const seriesNote = isRecurring ? " Da er sich wiederholt, wird die gesamte Serie gelöscht." : "";
      confirmDelete({
        title: "Termin löschen?",
        text: (ev?.title ? `"${ev.title}" wird endgültig gelöscht.` : "Dieser Termin wird endgültig gelöscht.") + seriesNote,
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteEvent(btn.dataset.id));
        }
      });
    });
  });

  // Punkt 2: Klick auf einen Termin öffnet ihn zum Bearbeiten
  list.querySelectorAll("[data-edit-event]").forEach(li => {
    li.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
      const id = li.dataset.editEvent;
      openEventModal(state.events[id], id);
    });
  });

  list.querySelectorAll('.delete-btn[data-kind="workout"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const w = state.workouts[btn.dataset.id];
      confirmDelete({
        title: "Training löschen?",
        text: w?.title ? `"${w.title}" wird endgültig gelöscht.` : "Dieses Training wird endgültig gelöscht.",
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteWorkout(btn.dataset.id));
        }
      });
    });
  });
}

function renderTodayTodos() {
  const list = document.getElementById("today-todo-list");
  const due = toArray(state.todos).filter(td => td.dueDate === today() && !td.done);
  if (!due.length) {
    list.innerHTML = `<li class="empty-state">Keine offenen Aufgaben für heute.</li>`;
    return;
  }
  list.innerHTML = due.map(td => buildTodoItem(td)).join("");
  attachTodoHandlers(list);
}

// ═══════════════════════════════════════════════════════
// 12. KALENDER-FILTER-LEISTE (Punkt 5)
// ═══════════════════════════════════════════════════════

function renderCalFilterBar() {
  const bar = document.getElementById("cal-filter-bar");
  const cals = toArray(state.calendars).sort((a,b) => (a.createdAt||0)-(b.createdAt||0));

  let html = `<button class="cal-filter-chip ${state.calFilter==='all'?'active':''}" data-cal-id="all">Alle</button>`;
  cals.forEach(c => {
    html += `<button class="cal-filter-chip ${state.calFilter===c.id?'active':''}" data-cal-id="${c.id}" style="--chip-color:${c.color}">
      <span class="chip-dot"></span>${escHtml(c.name)}
    </button>`;
  });
  bar.innerHTML = html;

  bar.querySelectorAll(".cal-filter-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      state.calFilter = chip.dataset.calId;
      renderCalFilterBar();
      renderCalendar();
      renderWeekStrip();
      renderDayEvents();
    });
  });
}

function populateCalendarSelect() {
  const sel = document.getElementById("event-calendar");
  if (!sel) return;
  const current = sel.value;
  const cals = toArray(state.calendars).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  if (!cals.length) {
    sel.innerHTML = `<option value="">— Noch kein Kalender —</option>`;
    return;
  }
  sel.innerHTML = cals.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join("");
  sel.value = current || cals[0].id;
}

function renderCalendarManageList() {
  const list = document.getElementById("calendar-list");
  const cals = toArray(state.calendars).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  if (!cals.length) {
    list.innerHTML = `<li class="empty-state">Noch keine Kalender. Erstelle z.B. "Privat" oder "Arbeit".</li>`;
    return;
  }
  list.innerHTML = cals.map(c => `
    <li class="calendar-list-item">
      <span class="cal-list-dot" style="background:${c.color}"></span>
      <span class="cal-list-name">${escHtml(c.name)}</span>
      <button class="delete-btn" data-id="${c.id}" aria-label="Kalender löschen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>
  `).join("");
  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cal = state.calendars[btn.dataset.id];
      confirmDelete({
        title: "Kalender löschen?",
        text: cal?.name ? `"${cal.name}" wird gelöscht. Zugehörige Events bleiben erhalten, verlieren aber die Zuordnung.` : "Dieser Kalender wird gelöscht.",
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteCalendar(btn.dataset.id));
        }
      });
    });
  });
}

// ═══════════════════════════════════════════════════════
// 13. TO-DO RENDERING (Punkt 2: Beschreibung, Punkt 3: Datum optional)
// ═══════════════════════════════════════════════════════

function buildTodoItem(td) {
  const prioLabel = { high:"Hoch", medium:"Mittel", low:"Niedrig" }[td.priority] || "";
  const isOpen = state.openTodoIds.has(td.id);
  return `
    <li class="todo-item ${td.done ? "done" : ""}" data-id="${td.id}">
      <div class="todo-item-row" data-toggle-id="${td.id}">
        <button class="todo-checkbox ${td.done ? "checked" : ""}" data-id="${td.id}" aria-label="Erledigt"></button>
        <div class="todo-info">
          <div class="todo-title-text">${escHtml(td.title)}</div>
          <div class="todo-meta">
            ${td.dueDate ? `<span class="todo-date">${formatDate(td.dueDate)}${td.dueTime ? " · " + td.dueTime : ""}</span>` : ""}
            ${td.priority ? `<span class="prio-badge prio-${td.priority}">${prioLabel}</span>` : ""}
            ${(td.reminderMinutes !== undefined && td.reminderMinutes !== null) ? `<span class="prio-badge" style="color:var(--accent);background:var(--accent-dim)">🔔</span>` : ""}
          </div>
        </div>
        <button class="delete-btn" data-id="${td.id}" aria-label="Löschen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
      ${td.description && isOpen ? `<div class="todo-desc-text">${escHtml(td.description)}</div>` : ""}
    </li>`;
}

function attachTodoHandlers(container) {
  container.querySelectorAll(".todo-checkbox").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      toggleTodo(id, state.todos[id]?.done || false);
    });
  });
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const td = state.todos[btn.dataset.id];
      confirmDelete({
        title: "To-Do löschen?",
        text: td?.title ? `"${td.title}" wird endgültig gelöscht.` : "Dieses To-Do wird endgültig gelöscht.",
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteTodo(btn.dataset.id));
        }
      });
    });
  });
  // Punkt 2: Klick auf Zeile klappt Beschreibung auf/zu (falls vorhanden)
  container.querySelectorAll("[data-toggle-id]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".todo-checkbox") || e.target.closest(".delete-btn")) return;
      const id = row.dataset.toggleId;
      const td = state.todos[id];
      if (!td || !td.description) return;
      if (state.openTodoIds.has(id)) state.openTodoIds.delete(id);
      else state.openTodoIds.add(id);
      renderTodoList();
      renderTodayTodos();
      renderProjectDetail();
    });
  });
}

function renderTodoList() {
  const list = document.getElementById("todo-list");
  let items = toArray(state.todos);
  if (state.todoFilter === "open") items = items.filter(t => !t.done);
  if (state.todoFilter === "done") items = items.filter(t =>  t.done);

  const pOrder = { high:0, medium:1, low:2 };
  items.sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    return (pOrder[a.priority] ?? 3) - (pOrder[b.priority] ?? 3);
  });

  if (!items.length) {
    list.innerHTML = `<li class="empty-state">Keine To-Dos gefunden.</li>`;
    return;
  }
  list.innerHTML = items.map(td => buildTodoItem(td)).join("");
  attachTodoHandlers(list);
}

// ═══════════════════════════════════════════════════════
// 14. NOTIZEN RENDERING
// ═══════════════════════════════════════════════════════

function renderNotesList() {
  const grid = document.getElementById("notes-grid");
  const notes = toArray(state.notes).sort((a,b) => (b.createdAt||0)-(a.createdAt||0));
  if (!notes.length) {
    grid.innerHTML = `<div class="empty-state">Noch keine Notizen.</div>`;
    return;
  }
  grid.innerHTML = notes.map(n => buildNoteCard(n)).join("");
  attachNoteHandlers(grid);
}

function buildNoteCard(n) {
  const proj = n.projectId ? state.projects[n.projectId] : null;
  return `
    <div class="note-card" data-id="${n.id}">
      <div class="note-card-title">${escHtml(n.title || "Ohne Titel")}</div>
      <div class="note-card-preview">${escHtml(n.content || "")}</div>
      <div class="note-card-meta">
        <span class="note-date">${n.createdAt ? new Date(n.createdAt).toLocaleDateString("de-DE") : ""}</span>
        ${proj ? `<span class="prio-badge" style="color:${proj.color};background:${proj.color}22">${escHtml(proj.name)}</span>` : ""}
        <button class="delete-btn" data-id="${n.id}" aria-label="Notiz löschen">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function attachNoteHandlers(container) {
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const n = state.notes[btn.dataset.id];
      confirmDelete({
        title: "Notiz löschen?",
        text: n?.title ? `"${n.title}" wird endgültig gelöscht.` : "Diese Notiz wird endgültig gelöscht.",
        onConfirm: () => {
          const card = btn.closest(".note-card");
          animateRemoval(card, () => deleteNote(btn.dataset.id));
        }
      });
    });
  });
  // Punkt 2: Notiz öffnen (analog zu To-Dos) — Klick auf Karte außerhalb des Lösch-Buttons
  container.querySelectorAll(".note-card").forEach(card => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
      openNoteDetail(card.dataset.id);
    });
  });
}

// ── Notiz-Detail-Modal: öffnen, speichern, löschen ──

let activeNoteDetailId = null;

function openNoteDetail(id) {
  const n = state.notes[id];
  if (!n) return;
  activeNoteDetailId = id;
  document.getElementById("note-detail-title").value = n.title || "";
  document.getElementById("note-detail-content").value = n.content || "";
  populateProjectSelects(); // stellt sicher, dass note-detail-project befüllt ist
  document.getElementById("note-detail-project").value = n.projectId || "";
  const meta = document.getElementById("note-detail-meta");
  meta.textContent = n.createdAt ? `Erstellt am ${new Date(n.createdAt).toLocaleDateString("de-DE")}` : "";
  openModal("modal-note-detail");
}

document.getElementById("close-note-detail-btn").addEventListener("click", () => {
  closeModal("modal-note-detail");
  activeNoteDetailId = null;
});

document.getElementById("save-note-detail-btn").addEventListener("click", async () => {
  if (!activeNoteDetailId) return;
  const title = document.getElementById("note-detail-title").value.trim();
  const content = document.getElementById("note-detail-content").value.trim();
  const projectId = document.getElementById("note-detail-project").value || null;
  if (!title && !content) { showToast("Bitte Inhalt eingeben"); shakeModal("modal-note-detail"); return; }
  await update(REFS.note(activeNoteDetailId), { title, content, projectId });
  closeModal("modal-note-detail");
  activeNoteDetailId = null;
});

document.getElementById("delete-note-detail-btn").addEventListener("click", () => {
  if (!activeNoteDetailId) return;
  const n = state.notes[activeNoteDetailId];
  confirmDelete({
    title: "Notiz löschen?",
    text: n?.title ? `"${n.title}" wird endgültig gelöscht.` : "Diese Notiz wird endgültig gelöscht.",
    onConfirm: async () => {
      await deleteNote(activeNoteDetailId);
      closeModal("modal-note-detail");
      activeNoteDetailId = null;
    }
  });
});

// ═══════════════════════════════════════════════════════
// 14b. TRAINING RENDERING — Heutige Werte, Verletzungen, Verlauf
// ═══════════════════════════════════════════════════════

function qualityColor(q) {
  if (q >= 70) return "var(--success)";
  if (q >= 40) return "var(--warning)";
  return "var(--danger)";
}

/** Zählt, wie viele Aktivitätsarten (Training/Check-in/erledigte Aufgabe) an einem Tag stattfanden (0-3) */
function computeDayActivityLevel(dateStr) {
  let count = 0;
  if (toArray(state.workouts).some(w => w.date === dateStr)) count++;
  const c = state.checkins[dateStr];
  if (c && (c.weight || c.sleepHours || c.water || c.caffeine)) count++;
  if (toArray(state.todos).some(td => td.completedAt && toDateString(new Date(td.completedAt)) === dateStr)) count++;
  return count;
}

/** Rendert die 5-Wochen-Aktivitäts-Heatmap im Training-Tab (Redesign, an Bild 1 angelehnt) */
function renderActivityHeatmap() {
  const container = document.getElementById("activity-heatmap-grid");
  if (!container) return;

  const now = new Date();
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // Montag = 0
  const thisMonday = new Date(now);
  thisMonday.setDate(now.getDate() - dow);
  const startMonday = new Date(thisMonday);
  startMonday.setDate(thisMonday.getDate() - 28); // 4 weitere Wochen zurück = 5 Wochen gesamt

  const t = today();
  let html = "";
  for (let i = 0; i < 35; i++) {
    const d = new Date(startMonday);
    d.setDate(startMonday.getDate() + i);
    const ds = toDateString(d);
    if (ds > t) {
      html += `<div class="heat-cell heat-future"></div>`;
    } else {
      const level = Math.min(computeDayActivityLevel(ds), 3);
      html += `<div class="heat-cell ${level > 0 ? "heat-" + level : ""}" title="${formatDate(ds)}"></div>`;
    }
  }
  container.innerHTML = html;
}

function renderTodayStats() {
  const grid = document.getElementById("today-stats-grid");
  const t = today();
  const c = state.checkins[t] || {};

  const hasWeight  = c.weight !== undefined && c.weight !== null && c.weight !== "";
  const hasSleep   = c.sleepHours !== undefined && c.sleepHours !== null;
  const hasQuality = c.sleepQuality !== undefined && c.sleepQuality !== null;
  const water      = c.water || 0;
  const caffeine   = c.caffeine || 0;

  grid.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">⚖️ Gewicht</div>
      ${hasWeight
        ? `<div class="stat-card-value">${c.weight}<span class="unit">kg</span></div>`
        : `<div class="stat-card-value empty">—</div>`}
    </div>
    <div class="stat-card">
      <div class="stat-card-label">😴 Schlaf</div>
      ${hasSleep
        ? `<div class="stat-card-value">${formatSleepDuration(c.sleepHours)}</div>`
        : `<div class="stat-card-value empty">—</div>`}
    </div>
    <div class="stat-card full-width">
      <div class="stat-card-label">💤 Schlafqualität</div>
      ${hasQuality
        ? `<div class="stat-card-value">${c.sleepQuality}<span class="unit">/ 100</span></div>
           <div class="quality-bar-track"><div class="quality-bar-fill" style="width:${c.sleepQuality}%;background:${qualityColor(c.sleepQuality)}"></div></div>`
        : `<div class="stat-card-value empty">Noch nicht erfasst</div>`}
    </div>
    <div class="stat-card tappable" id="water-stat-card">
      <div class="stat-card-label">💧 Flüssigkeit</div>
      <div class="stat-card-value">${water}<span class="unit">ml</span></div>
    </div>
    <div class="stat-card tappable" id="caffeine-stat-card">
      <div class="stat-card-label">☕ Koffein</div>
      <div class="stat-card-value">${caffeine}<span class="unit">mg</span></div>
    </div>
  `;

  document.getElementById("water-stat-card").addEventListener("click", () => openIntakeDetail("water"));
  document.getElementById("caffeine-stat-card").addEventListener("click", () => openIntakeDetail("caffeine"));
}

// ═══════════════════════════════════════════════════════
// 14a2. FLÜSSIGKEIT/KOFFEIN-TRACKER — Vollbild, Garmin-Connect-Stil (Punkt 1)
// ═══════════════════════════════════════════════════════

const INTAKE_CONFIG = {
  water: {
    label: "Flüssigkeit",
    icon: "💧",
    unit: "ml",
    goal: 2500,
    color: "#4A9FF7",
    shortcuts: [
      { label: "Glas", sub: "250ml", icon: "🥛", amount: 250 },
      { label: "Flasche", sub: "500ml", icon: "🧴", amount: 500 },
      { label: "Große Flasche", sub: "750ml", icon: "🚰", amount: 750 },
      { label: "Tasse", sub: "200ml", icon: "☕", amount: 200 },
      { label: "Liter", sub: "1000ml", icon: "💧", amount: 1000 },
      { label: "Entfernen", sub: "−250ml", icon: "➖", amount: -250, negative: true }
    ]
  },
  caffeine: {
    label: "Koffein",
    icon: "☕",
    unit: "mg",
    goal: 400,
    color: "#B8793D",
    shortcuts: [
      { label: "Espresso", sub: "80mg", icon: "☕", amount: 80 },
      { label: "Filterkaffee", sub: "120mg", icon: "🫖", amount: 120 },
      { label: "Cola", sub: "40mg", icon: "🥤", amount: 40 },
      { label: "Energy-Drink", sub: "80mg", icon: "⚡", amount: 80 },
      { label: "Grüner Tee", sub: "30mg", icon: "🍵", amount: 30 },
      { label: "Entfernen", sub: "−40mg", icon: "➖", amount: -40, negative: true }
    ]
  }
};

let activeIntakeType = "water";
let intakeViewDate = today(); // Punkt 1: aktuell betrachtetes Datum im Tracker

function currentIntakeValue(type) {
  return state.checkins[intakeViewDate]?.[type] || 0;
}

/** Zeigt "Heute", "Gestern" oder das ausgeschriebene Datum für den Tracker-Header */
function formatIntakeDateLabel(dateStr) {
  if (dateStr === today()) return "Heute";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateStr === toDateString(yesterday)) return "Gestern";
  return formatDate(dateStr);
}

function renderIntakeRing(type) {
  const cfg = INTAKE_CONFIG[type];
  const value = currentIntakeValue(type);
  const percent = Math.min(value / cfg.goal, 1);

  const size = 220, strokeWidth = 16, r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - percent);
  const cx = size / 2, cy = size / 2;

  const container = document.getElementById("intake-ring-container");
  container.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--bg-3)" stroke-width="${strokeWidth}" />
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cfg.color}" stroke-width="${strokeWidth}"
        stroke-linecap="round" stroke-dasharray="${circumference.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
        transform="rotate(-90 ${cx} ${cy})" style="transition: stroke-dashoffset 400ms ease" />
      <text x="${cx}" y="${cy - 34}" text-anchor="middle" class="intake-ring-icon" style="font-size:36px">${cfg.icon}</text>
      <text x="${cx}" y="${cy + 14}" text-anchor="middle" class="intake-ring-value">${value}</text>
      <text x="${cx}" y="${cy + 34}" text-anchor="middle" class="intake-ring-unit">${cfg.unit}</text>
      <text x="${cx}" y="${cy + 58}" text-anchor="middle" class="intake-ring-goal">Ziel: ${cfg.goal} ${cfg.unit}</text>
    </svg>`;

  document.getElementById("intake-date-label").textContent = formatIntakeDateLabel(intakeViewDate);
  document.getElementById("intake-next-day").disabled = intakeViewDate >= today();
  document.getElementById("intake-next-day").style.opacity = intakeViewDate >= today() ? 0.35 : 1;
}

function renderIntakeShortcuts(type) {
  const cfg = INTAKE_CONFIG[type];
  const grid = document.getElementById("intake-shortcut-grid");
  grid.innerHTML = cfg.shortcuts.map(s => `
    <button type="button" class="intake-shortcut-btn ${s.negative ? "negative" : ""}" data-amount="${s.amount}">
      <span class="intake-shortcut-icon">${s.icon}</span>
      <span class="intake-shortcut-label">${escHtml(s.label)}</span>
      <span class="intake-shortcut-sub">${escHtml(s.sub)}</span>
    </button>
  `).join("");

  grid.querySelectorAll(".intake-shortcut-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const amount = Number(btn.dataset.amount);
      const current = currentIntakeValue(activeIntakeType);
      await saveCheckin(intakeViewDate, { [activeIntakeType]: Math.max(0, current + amount) });
      renderIntakeRing(activeIntakeType);
    });
  });
}

function openIntakeDetail(type) {
  activeIntakeType = type;
  intakeViewDate = today(); // jedes Öffnen startet wieder bei heute
  const cfg = INTAKE_CONFIG[type];
  document.getElementById("intake-title").textContent = cfg.label;
  document.getElementById("intake-manual-input").value = "";
  renderIntakeRing(type);
  renderIntakeShortcuts(type);
  openModal("modal-intake");
}

/** Wechselt das im Tracker angezeigte Datum um `delta` Tage (Punkt 1: rückwirkendes Tracking) */
function shiftIntakeDate(delta) {
  const d = new Date(intakeViewDate + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const newDate = toDateString(d);
  if (newDate > today()) return; // nicht in die Zukunft
  intakeViewDate = newDate;
  renderIntakeRing(activeIntakeType);
}

document.getElementById("intake-prev-day").addEventListener("click", () => shiftIntakeDate(-1));
document.getElementById("intake-next-day").addEventListener("click", () => shiftIntakeDate(1));

// Punkt 1: Wischen nach links/rechts über den Ring wechselt den Tag
(function setupIntakeSwipe() {
  const wrapper = document.getElementById("intake-ring-wrapper");
  let startX = 0, startY = 0, active = false;

  wrapper.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) { active = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    active = true;
  }, { passive: true });

  wrapper.addEventListener("touchend", (e) => {
    if (!active) return;
    active = false;
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const THRESHOLD = 40;
    if (Math.abs(deltaX) < THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;
    // Wischen nach links → nächster Tag, nach rechts → vorheriger Tag
    shiftIntakeDate(deltaX < 0 ? 1 : -1);
  }, { passive: true });
})();

document.getElementById("close-intake-btn").addEventListener("click", () => closeModal("modal-intake"));

document.getElementById("intake-manual-add-btn").addEventListener("click", async () => {
  const input = document.getElementById("intake-manual-input");
  const amount = Number(input.value);
  if (!amount || amount === 0) { showToast("Bitte eine Menge eingeben"); shakeModal("modal-intake"); return; }
  const current = currentIntakeValue(activeIntakeType);
  await saveCheckin(intakeViewDate, { [activeIntakeType]: Math.max(0, current + amount) });
  input.value = "";
  renderIntakeRing(activeIntakeType);
});

document.getElementById("intake-reset-btn").addEventListener("click", () => {
  const cfg = INTAKE_CONFIG[activeIntakeType];
  const dayLabel = formatIntakeDateLabel(intakeViewDate);
  confirmDelete({
    title: `${cfg.label} zurücksetzen?`,
    text: `Der Wert für ${cfg.label} (${dayLabel}) wird auf 0 gesetzt.`,
    onConfirm: async () => {
      await saveCheckin(intakeViewDate, { [activeIntakeType]: 0 });
      renderIntakeRing(activeIntakeType);
    }
  });
});

document.getElementById("edit-today-checkin-btn").addEventListener("click", () => {
  const t = today();
  const c = state.checkins[t] || {};
  document.getElementById("edit-weight").value = c.weight ?? "";
  const { h, m } = decimalHoursToHM(c.sleepHours);
  document.getElementById("edit-sleep-h").value = h;
  document.getElementById("edit-sleep-m").value = m;
  const q = c.sleepQuality ?? 75;
  document.getElementById("edit-sleep-quality").value = q;
  document.getElementById("edit-sleep-quality-val").textContent = q;
  openModal("modal-edit-checkin");
});

document.getElementById("edit-sleep-quality").addEventListener("input", (e) => {
  document.getElementById("edit-sleep-quality-val").textContent = e.target.value;
});

document.getElementById("cancel-edit-checkin-btn").addEventListener("click", () => closeModal("modal-edit-checkin"));

document.getElementById("save-edit-checkin-btn").addEventListener("click", async () => {
  const weight = document.getElementById("edit-weight").value;
  const sleepH = document.getElementById("edit-sleep-h").value;
  const sleepM = document.getElementById("edit-sleep-m").value;
  const hasSleepInput = sleepH !== "" || sleepM !== "";
  const sleepQuality = document.getElementById("edit-sleep-quality").value;

  await saveCheckin(today(), {
    weight:       weight === "" ? null : Number(weight),
    sleepHours:   hasSleepInput ? hmToDecimalHours(sleepH, sleepM) : null,
    sleepQuality: sleepQuality === "" ? null : Number(sleepQuality)
  });
  closeModal("modal-edit-checkin");
});

// ═══════════════════════════════════════════════════════
// 14d. VERLAUFS-DIAGRAMM: Gewicht (orange) + Schlafqualität (blau) — Punkt 3
// ═══════════════════════════════════════════════════════

const CHART_COLOR_WEIGHT = "#F7A94A";
const CHART_COLOR_SLEEP  = "#4A9FF7";

/** Baut ein SVG-Pfad-"d"-Attribut aus Punkten, wobei null-Werte den Pfad unterbrechen (kein Verbinden über Lücken) */
function buildSvgPathD(points) {
  let d = "";
  let penDown = false;
  points.forEach(p => {
    if (p === null) { penDown = false; return; }
    d += (penDown ? " L " : " M ") + p.x.toFixed(1) + " " + p.y.toFixed(1);
    penDown = true;
  });
  return d;
}

function renderProgressChart() {
  const container = document.getElementById("progress-chart");
  if (!container) return;

  // Alle Tage mit mindestens einem der beiden Werte, aufsteigend sortiert, letzte 30
  const dates = Object.keys(state.checkins)
    .filter(d => {
      const c = state.checkins[d];
      const hasWeight = c.weight !== undefined && c.weight !== null && c.weight !== "";
      const hasQuality = c.sleepQuality !== undefined && c.sleepQuality !== null;
      return hasWeight || hasQuality;
    })
    .sort()
    .slice(-30);

  if (dates.length < 2) {
    container.innerHTML = `<div class="chart-empty">Noch nicht genug Daten für ein Diagramm — trag ein paar Tage lang Gewicht &amp; Schlafqualität ein.</div>`;
    return;
  }

  const weights   = dates.map(d => { const v = state.checkins[d].weight; return (v === undefined || v === null || v === "") ? null : Number(v); });
  const qualities = dates.map(d => { const v = state.checkins[d].sleepQuality; return (v === undefined || v === null) ? null : Number(v); });

  const definedWeights = weights.filter(v => v !== null);
  const wMin = definedWeights.length ? Math.min(...definedWeights) : 0;
  const wMax = definedWeights.length ? Math.max(...definedWeights) : 1;
  const wPad = Math.max((wMax - wMin) * 0.15, 0.5);
  const wLow = wMin - wPad, wHigh = wMax + wPad;

  // Schlafqualität ist bereits 0-100, feste Skala für konsistente Vergleichbarkeit
  const qLow = 0, qHigh = 100;

  const W = 600, H = 220, padL = 34, padR = 34, padT = 12, padB = 12;
  const chartW = W - padL - padR, chartH = H - padT - padB;
  const n = dates.length;
  const xFor = (i) => padL + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yForWeight = (v) => padT + chartH - ((v - wLow) / (wHigh - wLow)) * chartH;
  const yForQuality = (v) => padT + chartH - ((v - qLow) / (qHigh - qLow)) * chartH;

  const weightPoints = weights.map((v, i) => v === null ? null : { x: xFor(i), y: yForWeight(v) });
  const qualityPoints = qualities.map((v, i) => v === null ? null : { x: xFor(i), y: yForQuality(v) });

  const weightPath = buildSvgPathD(weightPoints);
  const qualityPath = buildSvgPathD(qualityPoints);

  const weightDots = weightPoints.filter(Boolean).map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${CHART_COLOR_WEIGHT}" />`
  ).join("");
  const qualityDots = qualityPoints.filter(Boolean).map(p =>
    `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${CHART_COLOR_SLEEP}" />`
  ).join("");

  // Grid-Linien (horizontal, dezent)
  const gridLines = [0.25, 0.5, 0.75].map(frac =>
    `<line x1="${padL}" y1="${(padT + chartH * frac).toFixed(1)}" x2="${W - padR}" y2="${(padT + chartH * frac).toFixed(1)}" stroke="var(--border)" stroke-width="1" />`
  ).join("");

  const firstLabel = formatDate(dates[0]);
  const lastLabel  = formatDate(dates[dates.length - 1]);

  // Punkt 1: Orientierungswerte links (Gewicht, orange) & rechts (Schlafqualität, blau)
  const axisLabels = `
    <text x="2" y="${(padT + 4).toFixed(1)}" font-size="10" font-weight="700" fill="${CHART_COLOR_WEIGHT}">${wHigh.toFixed(1)}</text>
    <text x="2" y="${(padT + chartH).toFixed(1)}" font-size="10" font-weight="700" fill="${CHART_COLOR_WEIGHT}">${wLow.toFixed(1)}</text>
    <text x="${W - 2}" y="${(padT + 4).toFixed(1)}" font-size="10" font-weight="700" fill="${CHART_COLOR_SLEEP}" text-anchor="end">100</text>
    <text x="${W - 2}" y="${(padT + chartH).toFixed(1)}" font-size="10" font-weight="700" fill="${CHART_COLOR_SLEEP}" text-anchor="end">0</text>
  `;

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H + 20}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <path d="${weightPath}" fill="none" stroke="${CHART_COLOR_WEIGHT}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      <path d="${qualityPath}" fill="none" stroke="${CHART_COLOR_SLEEP}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
      ${weightDots}
      ${qualityDots}
      ${axisLabels}
      <text x="${padL}" y="${H + 16}" font-size="11" fill="var(--text-2)">${escHtml(firstLabel)}</text>
      <text x="${W - padR}" y="${H + 16}" font-size="11" fill="var(--text-2)" text-anchor="end">${escHtml(lastLabel)}</text>
    </svg>`;
}

function renderWeightHistory() {
  const list = document.getElementById("weight-history-list");
  const entries = Object.entries(state.checkins)
    .filter(([, c]) => c.weight !== undefined && c.weight !== null && c.weight !== "")
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 30);

  if (!entries.length) {
    list.innerHTML = `<li class="empty-state">Noch keine Gewichtseinträge.</li>`;
    return;
  }

  list.innerHTML = entries.map(([dateStr, c]) => `
    <li class="history-item">
      <span class="history-date">${formatDate(dateStr)}</span>
      <div class="history-values">
        ${(c.sleepHours !== undefined && c.sleepHours !== null) ? `<span class="history-sleep">😴 ${formatSleepDuration(c.sleepHours)}</span>` : ""}
        <span class="history-weight">${c.weight} kg</span>
      </div>
    </li>
  `).join("");
}

// ── Verletzungen / Krankheit ──

function injuryStatus(inj) {
  const t = today();
  if (!inj.to) return "active"; // kein Enddatum = noch aktiv
  return inj.to >= t ? "active" : "resolved";
}

function renderInjuryList() {
  const list = document.getElementById("injury-list");
  const items = toArray(state.injuries).sort((a, b) => (b.from || "").localeCompare(a.from || ""));

  if (!items.length) {
    list.innerHTML = `<li class="empty-state">Keine Einträge.</li>`;
    return;
  }

  list.innerHTML = items.map(inj => {
    const status = injuryStatus(inj);
    const isOpen = state.openInjuryIds.has(inj.id);
    const typeLabel = inj.type === "illness" ? "Krankheit" : "Verletzung";
    const dateRange = inj.to ? `${formatDate(inj.from)} – ${formatDate(inj.to)}` : `seit ${formatDate(inj.from)}`;
    return `
      <li class="injury-item ${status}" data-id="${inj.id}">
        <div class="injury-row" data-toggle-injury="${inj.id}">
          <div class="injury-info">
            <div class="injury-title-text">${escHtml(inj.title)}</div>
            <div class="injury-meta">
              <span class="injury-dates">${dateRange}</span>
              <span class="injury-badge ${status}">${status === "active" ? "Aktiv" : "Beendet"}</span>
              <span class="injury-badge resolved">${typeLabel}</span>
            </div>
          </div>
          <button class="delete-btn" data-id="${inj.id}" aria-label="Löschen">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </button>
        </div>
        ${inj.notes && isOpen ? `<div class="injury-notes-text">${escHtml(inj.notes)}</div>` : ""}
      </li>`;
  }).join("");

  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const inj = state.injuries[btn.dataset.id];
      confirmDelete({
        title: "Eintrag löschen?",
        text: inj?.title ? `"${inj.title}" wird endgültig gelöscht.` : "Dieser Eintrag wird endgültig gelöscht.",
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteInjury(btn.dataset.id));
        }
      });
    });
  });

  list.querySelectorAll("[data-toggle-injury]").forEach(row => {
    row.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
      const id = row.dataset.toggleInjury;
      const inj = state.injuries[id];
      if (!inj || !inj.notes) return;
      if (state.openInjuryIds.has(id)) state.openInjuryIds.delete(id);
      else state.openInjuryIds.add(id);
      renderInjuryList();
    });
  });
}

document.getElementById("add-injury-btn").addEventListener("click", () => {
  document.getElementById("injury-from").value = today();
  openModal("modal-injury");
});
document.getElementById("cancel-injury-btn").addEventListener("click", () => closeModal("modal-injury"));
document.getElementById("save-injury-btn").addEventListener("click", async () => {
  const title = document.getElementById("injury-title").value.trim();
  const from = document.getElementById("injury-from").value;
  const to = document.getElementById("injury-to").value || null;
  const type = document.getElementById("injury-type").value;
  const notes = document.getElementById("injury-notes").value.trim();
  if (!title) { showToast("Bitte Bezeichnung eingeben"); shakeModal("modal-injury"); return; }
  if (!from)  { showToast("Bitte Startdatum wählen"); shakeModal("modal-injury"); return; }
  await createInjury({ title, from, to, type, notes });
  closeModal("modal-injury");
  ["injury-title","injury-from","injury-to","injury-notes"].forEach(id => document.getElementById(id).value = "");
});

// ═══════════════════════════════════════════════════════
// 14c. TRAININGS RENDERING & MODAL-LOGIK (Punkt 3)
// ═══════════════════════════════════════════════════════

/** Datum N Tage vor heute als "YYYY-MM-DD" */
function daysAgoDateString(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toDateString(d);
}

/** Baut das HTML für einen einzelnen Trainings-Listeneintrag (für kompakte & volle Liste wiederverwendet) */
function buildWorkoutItemHtml(w) {
  const sport = workoutDisplayInfo(w);
  const isOpen = state.openWorkoutIds.has(w.id);
  const calName = w.calendarId ? state.calendars[w.calendarId]?.name : null;
  const zones = Array.isArray(w.zones) ? w.zones : [];
  const isDistanceBased = w.sport !== "other";

  const detailHtml = isOpen ? `
    <div class="workout-detail">
      ${isDistanceBased ? `
      <div class="workout-detail-cell">
        <div class="workout-detail-label">Distanz</div>
        <div class="workout-detail-value">${w.distance !== undefined && w.distance !== null ? w.distance + " " + distanceUnitFor(w.sport) : "–"}</div>
      </div>
      <div class="workout-detail-cell">
        <div class="workout-detail-label">${w.sport === "bike" ? "Ø Geschwindigkeit" : "Ø Pace"}</div>
        <div class="workout-detail-value">${computeWorkoutMetric(w.sport, w.distance, w.durationHours, w.durationMinutes, w.durationSeconds) || "–"}</div>
      </div>` : ""}
      <div class="workout-detail-cell">
        <div class="workout-detail-label">Belastung</div>
        <div class="workout-detail-value">${w.load ?? "–"}</div>
      </div>
      <div class="workout-detail-cell">
        <div class="workout-detail-label">Ø Herzfrequenz</div>
        <div class="workout-detail-value">${w.avgHr ? w.avgHr + " bpm" : "–"}</div>
      </div>
      <div class="workout-detail-cell">
        <div class="workout-detail-label">Fokus Aerob</div>
        <div class="workout-detail-value">${(w.focusAerobic ?? 0).toFixed(1)}</div>
      </div>
      <div class="workout-detail-cell">
        <div class="workout-detail-label">Fokus Anaerob</div>
        <div class="workout-detail-value">${(w.focusAnaerobic ?? 0).toFixed(1)}</div>
      </div>
      ${zones.length ? `
      <div class="workout-zones-row">
        ${zones.map(z => `<span class="workout-zone-tag">${zoneLabel(z)}</span>`).join("")}
      </div>` : ""}
      <div class="workout-zones-row workout-actions">
        <button type="button" class="workout-action-btn" data-edit-workout="${w.id}">Bearbeiten</button>
        <button type="button" class="workout-action-btn danger" data-delete-workout="${w.id}">Löschen</button>
      </div>
    </div>` : "";

  return `
    <li class="workout-item" data-id="${w.id}">
      <div class="workout-row" data-toggle-workout="${w.id}">
        <div class="workout-sport-icon">${sport.icon}</div>
        <div class="workout-info">
          <div class="workout-title-text">${escHtml(w.title || sport.label)}</div>
          <div class="workout-meta">
            <span class="workout-date">${formatDate(w.date)}</span>
            <span class="workout-badge">${formatWorkoutDuration(w.durationHours, w.durationMinutes, w.durationSeconds)}</span>
            ${calName ? `<span class="workout-badge">${escHtml(calName)}</span>` : ""}
          </div>
          ${buildZoneBarHtml(zones)}
        </div>
      </div>
      ${detailHtml}
    </li>`;
}

/** Farbige Segment-Leiste für die Zonen eines Trainings (Redesign, an Bild 2 angelehnt) */
const ZONE_COLORS = {
  z1_erholung: "#1B3A6B", // Dunkelblau
  z2_ausdauer: "#2F6FED", // Blau
  z2_fatmax:   "#6FA8FF", // Helleres Blau
  z3_tempo:    "#2DD4BF", // Türkis
  z4_schwelle: "#6EE7A8", // Helleres Grün
  z5_vo2max:   "#FFD93D", // Gelb
  z5_neuro:    "#EF4444", // Rot
  z5_anaerob:  "#FFD93D", // Gelb
};

function buildZoneBarHtml(zones) {
  if (!zones.length) return "";
  const segments = zones.map(z =>
    `<span class="zone-bar-segment" style="background:${ZONE_COLORS[z] || "var(--accent)"}"></span>`
  ).join("");
  return `<div class="workout-zone-bar">${segments}</div>`;
}

/** Verkabelt Aufklappen/Bearbeiten/Löschen für eine gerenderte Trainings-Liste */
function wireWorkoutListHandlers(container, rerenderFn) {
  container.querySelectorAll("[data-toggle-workout]").forEach(row => {
    row.addEventListener("click", () => {
      const id = row.dataset.toggleWorkout;
      if (state.openWorkoutIds.has(id)) state.openWorkoutIds.delete(id);
      else state.openWorkoutIds.add(id);
      rerenderFn();
    });
  });
  container.querySelectorAll("[data-edit-workout]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openWorkoutModal(state.workouts[btn.dataset.editWorkout], btn.dataset.editWorkout);
    });
  });
  container.querySelectorAll("[data-delete-workout]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const w = state.workouts[btn.dataset.deleteWorkout];
      confirmDelete({
        title: "Training löschen?",
        text: w?.title ? `"${w.title}" wird endgültig gelöscht.` : "Dieses Training wird endgültig gelöscht.",
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteWorkout(btn.dataset.deleteWorkout));
        }
      });
    });
  });
}

/** Punkt 3: Kompakte Liste zeigt nur Trainings der letzten 3 Tage, Rest über "Alle anzeigen" */
function renderWorkoutList() {
  const list = document.getElementById("workout-list");
  const allItems = toArray(state.workouts).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt||0)-(a.createdAt||0));

  const cutoff = daysAgoDateString(2); // heute + 2 Tage zurück = letzte 3 Tage
  const recentItems = allItems.filter(w => (w.date || "") >= cutoff);

  if (!allItems.length) {
    list.innerHTML = `<li class="empty-state">Noch keine Trainings erfasst.</li>`;
    updateShowAllWorkoutsButton(0);
    return;
  }

  if (!recentItems.length) {
    list.innerHTML = `<li class="empty-state">Keine Trainings in den letzten 3 Tagen.</li>`;
  } else {
    list.innerHTML = recentItems.map(buildWorkoutItemHtml).join("");
    wireWorkoutListHandlers(list, renderWorkoutList);
  }

  updateShowAllWorkoutsButton(allItems.length);
}

/** Zeigt/versteckt den "Alle Trainings anzeigen"-Button je nach Gesamtanzahl */
function updateShowAllWorkoutsButton(totalCount) {
  const btn = document.getElementById("show-all-workouts-btn");
  if (!btn) return;
  if (totalCount > 0) {
    btn.style.display = "block";
    btn.textContent = `Alle Trainings anzeigen (${totalCount})`;
  } else {
    btn.style.display = "none";
  }
}

/** Vollständige Trainings-Liste im Vollbild-Modal */
function renderAllWorkoutsList() {
  const list = document.getElementById("all-workout-list");
  const items = toArray(state.workouts).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt||0)-(a.createdAt||0));

  if (!items.length) {
    list.innerHTML = `<li class="empty-state">Noch keine Trainings erfasst.</li>`;
    return;
  }
  list.innerHTML = items.map(buildWorkoutItemHtml).join("");
  wireWorkoutListHandlers(list, renderAllWorkoutsList);
}

document.getElementById("show-all-workouts-btn").addEventListener("click", () => {
  renderAllWorkoutsList();
  openModal("modal-all-workouts");
});
document.getElementById("close-all-workouts-btn").addEventListener("click", () => closeModal("modal-all-workouts"));

// ═══════════════════════════════════════════════════════
// 14e. WOCHENRÜCKBLICK (Punkt 1+2)
// ═══════════════════════════════════════════════════════

/** Liefert Montag & Sonntag der Woche, die `offsetWeeks` Wochen von heute entfernt liegt */
function getWeekRange(offsetWeeks) {
  const now = new Date();
  const dow = now.getDay() === 0 ? 6 : now.getDay() - 1; // Montag = 0
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + offsetWeeks * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return {
    startStr: toDateString(monday),
    endStr: toDateString(sunday),
    startMs: monday.getTime(),
    endMs: sunday.getTime(),
    label: `${monday.getDate()}. ${monday.toLocaleString("de-DE", { month: "short" })} – ${sunday.getDate()}. ${sunday.toLocaleString("de-DE", { month: "short" })} ${sunday.getFullYear()}`
  };
}

function renderWeeklyReview() {
  const range = getWeekRange(state.weeklyReviewOffset);
  document.getElementById("weekly-review-range").textContent = range.label;

  // ── Trainings der Woche ──
  const weekWorkouts = toArray(state.workouts).filter(w => w.date >= range.startStr && w.date <= range.endStr);

  let totalMinutes = 0;
  let totalLoad = 0;
  let aerobSum = 0, aerobCount = 0;
  let anaerobSum = 0, anaerobCount = 0;
  const bySport = {};

  weekWorkouts.forEach(w => {
    const mins = (Number(w.durationHours) || 0) * 60 + (Number(w.durationMinutes) || 0) + (Number(w.durationSeconds) || 0) / 60;
    totalMinutes += mins;
    if (w.load !== undefined && w.load !== null) totalLoad += Number(w.load);
    // Punkt 5: "Sonstiges" (HIT/Athletik/Mobility) fließt nicht in den Ø Fokus Aerob/Anaerob ein
    if (w.sport !== "other") {
      if (w.focusAerobic !== undefined && w.focusAerobic !== null) { aerobSum += Number(w.focusAerobic); aerobCount++; }
      if (w.focusAnaerobic !== undefined && w.focusAnaerobic !== null) { anaerobSum += Number(w.focusAnaerobic); anaerobCount++; }
    }

    const key = w.sport === "other" ? (w.otherType || "other") : w.sport;
    if (!bySport[key]) bySport[key] = { count: 0, minutes: 0 };
    bySport[key].count++;
    bySport[key].minutes += mins;
  });

  const totalH = Math.floor(totalMinutes / 60);
  const totalM = Math.round(totalMinutes % 60);
  const avgAerob = aerobCount ? (aerobSum / aerobCount) : null;
  const avgAnaerob = anaerobCount ? (anaerobSum / anaerobCount) : null;

  document.getElementById("weekly-training-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">⏱️ Gesamtdauer</div>
      <div class="stat-card-value">${totalMinutes > 0 ? `${totalH}h ${totalM}min` : "–"}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">🏋️ Trainings</div>
      <div class="stat-card-value">${weekWorkouts.length}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">📈 Belastung (Summe)</div>
      <div class="stat-card-value">${totalLoad > 0 ? totalLoad : "–"}</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">💨 Ø Fokus Aerob</div>
      <div class="stat-card-value">${avgAerob !== null ? avgAerob.toFixed(1) : "–"}</div>
    </div>
    <div class="stat-card full-width">
      <div class="stat-card-label">🔥 Ø Fokus Anaerob</div>
      <div class="stat-card-value">${avgAnaerob !== null ? avgAnaerob.toFixed(1) : "–"}</div>
    </div>
  `;

  const breakdownList = document.getElementById("weekly-sport-breakdown");
  const sportEntries = Object.entries(bySport);
  if (!sportEntries.length) {
    breakdownList.innerHTML = `<li class="empty-state">Keine Trainings in dieser Woche.</li>`;
  } else {
    breakdownList.innerHTML = sportEntries.map(([key, data]) => {
      const info = key === "hit" || key === "athletics" || key === "mobility" ? otherTypeInfo(key) : (SPORTS[key] || { icon: "🏋️", label: key });
      const h = Math.floor(data.minutes / 60);
      const m = Math.round(data.minutes % 60);
      return `
        <li class="history-item">
          <span class="history-date">${info.icon} ${escHtml(info.label)}</span>
          <div class="history-values">
            <span class="history-sleep">${data.count}×</span>
            <span class="history-weight">${h}h ${m}min</span>
          </div>
        </li>`;
    }).join("");
  }

  // ── Ø Flüssigkeit & Koffein der Woche ──
  const weekCheckinDates = Object.keys(state.checkins).filter(d => d >= range.startStr && d <= range.endStr);
  const waterEntries = weekCheckinDates.map(d => state.checkins[d].water).filter(v => v !== undefined && v !== null);
  const avgWater = waterEntries.length ? Math.round(waterEntries.reduce((a, b) => a + Number(b), 0) / waterEntries.length) : null;

  // Punkt 2: Beim Koffein zählen auch Tage ohne Eintrag als 0 mit (fester Nenner = 7 Tage/Woche)
  const caffeineValues = weekCheckinDates.map(d => state.checkins[d].caffeine).filter(v => v !== undefined && v !== null);
  const caffeineSum = caffeineValues.reduce((a, b) => a + Number(b), 0);
  const avgCaffeine = Math.round(caffeineSum / 7);

  document.getElementById("weekly-intake-stats").innerHTML = `
    <div class="stat-card">
      <div class="stat-card-label">💧 Ø Flüssigkeit</div>
      <div class="stat-card-value">${avgWater !== null ? avgWater : "–"}<span class="unit">ml</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-card-label">☕ Ø Koffein</div>
      <div class="stat-card-value">${avgCaffeine !== null ? avgCaffeine : "–"}<span class="unit">mg</span></div>
    </div>
  `;

  // ── Erledigte Aufgaben der Woche ──
  const completedTodos = toArray(state.todos).filter(td =>
    td.done && td.completedAt && td.completedAt >= range.startMs && td.completedAt <= range.endMs
  ).sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  document.getElementById("weekly-todo-count-card").innerHTML = `
    <div class="stat-card-label">✅ Erledigte Aufgaben</div>
    <div class="stat-card-value">${completedTodos.length}</div>
  `;

  const todoList = document.getElementById("weekly-completed-todos");
  if (!completedTodos.length) {
    todoList.innerHTML = `<li class="empty-state">Keine erledigten Aufgaben in dieser Woche.</li>`;
  } else {
    todoList.innerHTML = completedTodos.map(td => buildTodoItem(td)).join("");
    // Nur Aufklapp-Verhalten für Beschreibungen, kein Checkbox/Delete nötig hier, aber schadet nicht
    attachTodoHandlers(todoList);
  }
}

document.getElementById("close-weekly-review-btn").addEventListener("click", () => closeModal("modal-weekly-review"));
document.getElementById("weekly-review-prev").addEventListener("click", () => {
  state.weeklyReviewOffset -= 1;
  renderWeeklyReview();
});
document.getElementById("weekly-review-next").addEventListener("click", () => {
  state.weeklyReviewOffset += 1;
  renderWeeklyReview();
});

function populateWorkoutCalendarSelect() {
  const sel = document.getElementById("workout-calendar");
  if (!sel) return;
  const current = sel.value;
  const cals = toArray(state.calendars).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  if (!cals.length) {
    sel.innerHTML = `<option value="">— Noch kein Kalender —</option>`;
    return;
  }
  sel.innerHTML = cals.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join("");
  sel.value = current || cals[0].id;
}

function renderZonePicker() {
  const picker = document.getElementById("zone-picker");
  picker.innerHTML = TRAINING_ZONES.map(z =>
    `<button type="button" class="zone-chip ${state.selectedZones.has(z.id) ? "selected" : ""}" data-zone="${z.id}">${z.label}</button>`
  ).join("");
  picker.querySelectorAll(".zone-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const zoneId = chip.dataset.zone;
      if (state.selectedZones.has(zoneId)) state.selectedZones.delete(zoneId);
      else state.selectedZones.add(zoneId);
      renderZonePicker();
    });
  });
}

let selectedSport = "swim";

/** Distanz-Einheit je Sportart: Rad/Lauf in km, Schwimmen in Metern */
function distanceUnitFor(sport) {
  if (sport === "swim") return "m";
  if (sport === "other") return null;
  return "km";
}

/**
 * Berechnet die sportartspezifische Kennzahl aus Distanz + Dauer:
 * Radfahren → Ø km/h, Laufen → Pace min/km, Schwimmen → Pace min/100m
 */
function computeWorkoutMetric(sport, distance, durationHours, durationMinutes, durationSeconds) {
  const dist = Number(distance);
  const totalMinutes = (Number(durationHours) || 0) * 60 + (Number(durationMinutes) || 0) + (Number(durationSeconds) || 0) / 60;
  if (!dist || dist <= 0 || !totalMinutes || totalMinutes <= 0) return null;

  if (sport === "bike") {
    const speed = dist / (totalMinutes / 60);
    return `${speed.toFixed(1)} km/h`;
  }
  if (sport === "run") {
    const paceMinPerKm = totalMinutes / dist;
    return `${formatPace(paceMinPerKm)} min/km`;
  }
  if (sport === "swim") {
    const paceMin100m = totalMinutes / (dist / 100);
    return `${formatPace(paceMin100m)} min/100m`;
  }
  return null;
}

/** Dezimalminuten → "M:SS" Format für Pace-Angaben */
function formatPace(decimalMinutes) {
  const totalSeconds = Math.round(decimalMinutes * 60);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function updateWorkoutPacePreview() {
  const distance = document.getElementById("workout-distance").value;
  const h = document.getElementById("workout-duration-h").value;
  const m = document.getElementById("workout-duration-m").value;
  const s = document.getElementById("workout-duration-s").value;
  const preview = document.getElementById("workout-pace-preview");
  const metric = computeWorkoutMetric(selectedSport, distance, h, m, s);
  preview.textContent = metric ? `Ø ${metric}` : "";
}

let selectedOtherType = "hit";

function setSelectedSport(sport) {
  selectedSport = sport;
  document.querySelectorAll("#sport-picker .sport-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.sport === sport);
  });

  const distanceGroup = document.getElementById("workout-distance-group");
  const otherTypeGroup = document.getElementById("other-type-group");

  if (sport === "other") {
    distanceGroup.style.display = "none";
    otherTypeGroup.style.display = "block";
    setSelectedOtherType(selectedOtherType);
  } else {
    distanceGroup.style.display = "block";
    otherTypeGroup.style.display = "none";
    document.getElementById("workout-distance-unit-label").textContent = `(${distanceUnitFor(sport)})`;
  }

  updateWorkoutPacePreview();
}

function setSelectedOtherType(typeId) {
  selectedOtherType = typeId;
  document.querySelectorAll("#other-type-picker .sport-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.otherType === typeId);
  });
}

document.getElementById("other-type-picker").addEventListener("click", (e) => {
  const btn = e.target.closest(".sport-btn");
  if (!btn) return;
  setSelectedOtherType(btn.dataset.otherType);
});

document.getElementById("sport-picker").addEventListener("click", (e) => {
  const btn = e.target.closest(".sport-btn");
  if (!btn) return;
  setSelectedSport(btn.dataset.sport);
});

document.getElementById("workout-distance").addEventListener("input", updateWorkoutPacePreview);
document.getElementById("workout-duration-h").addEventListener("input", updateWorkoutPacePreview);
document.getElementById("workout-duration-m").addEventListener("input", updateWorkoutPacePreview);
document.getElementById("workout-duration-s").addEventListener("input", updateWorkoutPacePreview);

document.getElementById("workout-focus-aerob").addEventListener("input", (e) => {
  document.getElementById("workout-focus-aerob-val").textContent = Number(e.target.value).toFixed(1);
});
document.getElementById("workout-focus-anaerob").addEventListener("input", (e) => {
  document.getElementById("workout-focus-anaerob-val").textContent = Number(e.target.value).toFixed(1);
});

/** Öffnet das Trainings-Modal. Ohne workout → neuer Eintrag, mit workout → Bearbeiten-Modus. */
function openWorkoutModal(workout, workoutId) {
  populateWorkoutCalendarSelect();

  if (!Object.keys(state.calendars).length) {
    showToast("Bitte zuerst einen Kalender anlegen");
    openModal("modal-calendar");
    return;
  }

  state.editingWorkoutId = workoutId || null;
  document.getElementById("workout-modal-title").textContent = workout ? "Training bearbeiten" : "Training erfassen";

  selectedOtherType = workout?.otherType || "hit";
  setSelectedSport(workout?.sport || "swim");
  document.getElementById("workout-title").value = workout?.title || "";
  document.getElementById("workout-calendar").value = workout?.calendarId || document.getElementById("workout-calendar").value;
  document.getElementById("workout-date").value = workout?.date || state.selectedDate || today();
  document.getElementById("workout-duration-h").value = workout?.durationHours ?? "";
  document.getElementById("workout-duration-m").value = workout?.durationMinutes ?? "";
  document.getElementById("workout-duration-s").value = workout?.durationSeconds ?? "";
  document.getElementById("workout-distance").value = workout?.distance ?? "";
  document.getElementById("workout-load").value = workout?.load ?? "";
  document.getElementById("workout-hr").value = workout?.avgHr ?? "";

  const aerob = workout?.focusAerobic ?? 0;
  const anaerob = workout?.focusAnaerobic ?? 0;
  document.getElementById("workout-focus-aerob").value = aerob;
  document.getElementById("workout-focus-aerob-val").textContent = Number(aerob).toFixed(1);
  document.getElementById("workout-focus-anaerob").value = anaerob;
  document.getElementById("workout-focus-anaerob-val").textContent = Number(anaerob).toFixed(1);

  state.selectedZones = new Set(Array.isArray(workout?.zones) ? workout.zones : []);
  renderZonePicker();
  updateWorkoutPacePreview();

  openModal("modal-workout");
}

document.getElementById("add-workout-btn").addEventListener("click", () => openWorkoutModal(null, null));
document.getElementById("cancel-workout-btn").addEventListener("click", () => closeModal("modal-workout"));

document.getElementById("save-workout-btn").addEventListener("click", async () => {
  const title = document.getElementById("workout-title").value.trim();
  const calendarId = document.getElementById("workout-calendar").value;
  const date = document.getElementById("workout-date").value;
  const durationHours = document.getElementById("workout-duration-h").value;
  const durationMinutes = document.getElementById("workout-duration-m").value;
  const durationSeconds = document.getElementById("workout-duration-s").value;
  const distance = document.getElementById("workout-distance").value;
  const load = document.getElementById("workout-load").value;
  const avgHr = document.getElementById("workout-hr").value;
  const focusAerobic = document.getElementById("workout-focus-aerob").value;
  const focusAnaerobic = document.getElementById("workout-focus-anaerob").value;

  if (!calendarId) { showToast("Bitte Kalender wählen"); shakeModal("modal-workout"); return; }
  if (!date) { showToast("Bitte Datum wählen"); shakeModal("modal-workout"); return; }

  const payload = {
    sport: selectedSport,
    otherType: selectedSport === "other" ? selectedOtherType : null,
    title,
    calendarId,
    date,
    durationHours: durationHours === "" ? 0 : Number(durationHours),
    durationMinutes: durationMinutes === "" ? 0 : Number(durationMinutes),
    durationSeconds: durationSeconds === "" ? 0 : Number(durationSeconds),
    distance: selectedSport === "other" ? null : (distance === "" ? null : Number(distance)),
    load: load === "" ? null : Number(load),
    avgHr: avgHr === "" ? null : Number(avgHr),
    focusAerobic: Number(focusAerobic),
    focusAnaerobic: Number(focusAnaerobic),
    zones: Array.from(state.selectedZones)
  };

  if (state.editingWorkoutId) {
    await updateWorkout(state.editingWorkoutId, payload);
  } else {
    await createWorkout(payload);
  }

  closeModal("modal-workout");
  state.editingWorkoutId = null;
});

// ═══════════════════════════════════════════════════════
// 15. PROJEKT RENDERING
// ═══════════════════════════════════════════════════════

function renderProjectGrid() {
  const grid = document.getElementById("project-grid");
  const projects = toArray(state.projects).sort((a,b) => (a.createdAt||0)-(b.createdAt||0));
  if (!projects.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:span 2">Noch keine Projekte. Erstelle dein erstes!</div>`;
    return;
  }
  grid.innerHTML = projects.map(p => {
    const todoCount = toArray(state.todos).filter(t => t.projectId === p.id).length;
    const noteCount = toArray(state.notes).filter(n => n.projectId === p.id).length;
    return `
      <div class="project-card" data-id="${p.id}" style="--project-color:${p.color || "var(--accent)"}">
        <div class="project-color-dot"></div>
        <div class="project-card-name">${escHtml(p.name)}</div>
        <div class="project-card-count">${todoCount} To-Do${todoCount!==1?"s":""} · ${noteCount} Notiz${noteCount!==1?"en":""}</div>
      </div>`;
  }).join("");
  grid.querySelectorAll(".project-card").forEach(card => {
    card.addEventListener("click", () => openProjectDetail(card.dataset.id));
  });
}

function openProjectDetail(projectId) {
  state.activeProjectId = projectId;
  const proj = state.projects[projectId];
  if (!proj) return;
  document.getElementById("project-detail-title").textContent = proj.name;
  renderProjectDetail();
  document.getElementById("modal-project-detail").classList.add("open");
}

function renderProjectDetail() {
  if (!state.activeProjectId) return;
  const id = state.activeProjectId;

  const pTodos = toArray(state.todos).filter(t => t.projectId === id);
  const tList = document.getElementById("project-todo-list");
  if (!pTodos.length) {
    tList.innerHTML = `<li class="empty-state">Keine To-Dos in diesem Projekt.</li>`;
  } else {
    tList.innerHTML = pTodos.map(td => buildTodoItem(td)).join("");
    attachTodoHandlers(tList);
  }

  const pNotes = toArray(state.notes).filter(n => n.projectId === id);
  const nGrid = document.getElementById("project-notes-grid");
  if (!pNotes.length) {
    nGrid.innerHTML = `<div class="empty-state">Keine Notizen in diesem Projekt.</div>`;
  } else {
    nGrid.innerHTML = pNotes.map(n => buildNoteCard(n)).join("");
    attachNoteHandlers(nGrid);
  }
}

// ═══════════════════════════════════════════════════════
// 16. PROJEKT-SELECTS BEFÜLLEN
// ═══════════════════════════════════════════════════════

function populateProjectSelects() {
  ["todo-project", "note-project", "note-detail-project"].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">— Kein Projekt —</option>`;
    toArray(state.projects).forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id; opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  });
}

// ═══════════════════════════════════════════════════════
// 17. MODAL MANAGEMENT
// ═══════════════════════════════════════════════════════

function openModal(id)  { document.getElementById(id).classList.add("open"); }
function closeModal(id) { document.getElementById(id).classList.remove("open"); }
function closeAllModals(){ document.querySelectorAll(".modal-overlay.open").forEach(m => m.classList.remove("open")); }

document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => { if (e.target === overlay) closeAllModals(); });
});

// Lösch-Bestätigung: Buttons verkabeln (Punkt 2)
document.getElementById("confirm-cancel-btn").addEventListener("click", () => {
  pendingDeleteAction = null;
  closeModal("modal-confirm");
});
document.getElementById("confirm-delete-btn").addEventListener("click", () => {
  const action = pendingDeleteAction;
  pendingDeleteAction = null;
  closeModal("modal-confirm");
  action?.();
});

// ═══════════════════════════════════════════════════════
// 18. HEADER AKTION (+ Button)
// ═══════════════════════════════════════════════════════

document.getElementById("header-action-btn").addEventListener("click", () => {
  if (state.currentView === "training") {
    openWorkoutModal(null, null);
    return;
  }

  const modalMap = { calendar:"modal-event", projects:"modal-project", todos:"modal-todo", notes:"modal-note" };
  const m = modalMap[state.currentView];
  if (!m) return;

  if (state.currentView === "calendar") {
    openEventModal(null, null);
    return;
  }
  if (state.currentView === "todos") document.getElementById("todo-date").value = "";
  openModal(m);
});

// ═══════════════════════════════════════════════════════
// 19. TERMIN-MODAL (Punkt 1: umbenannt, Punkt 2: bearbeitbar)
// ═══════════════════════════════════════════════════════

let editingEventId = null;

/** Öffnet das Termin-Modal. Ohne event → neuer Termin, mit event → Bearbeiten-Modus. */
function openEventModal(event, eventId) {
  if (!Object.keys(state.calendars).length) {
    showToast("Bitte zuerst einen Kalender anlegen");
    openModal("modal-calendar");
    return;
  }

  editingEventId = eventId || null;
  document.getElementById("event-modal-title").textContent = event ? "Termin bearbeiten" : "Termin erstellen";

  populateCalendarSelect();

  document.getElementById("event-title").value = event?.title || "";
  document.getElementById("event-date").value = event?.date || state.selectedDate || today();
  document.getElementById("event-time").value = event?.time || "";
  document.getElementById("event-desc").value = event?.description || "";
  document.getElementById("event-recurrence").value = event?.recurrence || "none";
  document.getElementById("event-reminder").value = (event?.reminderMinutes !== undefined && event?.reminderMinutes !== null) ? String(event.reminderMinutes) : "15";
  if (event?.calendarId) document.getElementById("event-calendar").value = event.calendarId;

  openModal("modal-event");
}

document.getElementById("add-event-btn").addEventListener("click", () => openEventModal(null, null));

document.getElementById("cancel-event-btn").addEventListener("click", () => closeModal("modal-event"));

document.getElementById("save-event-btn").addEventListener("click", async () => {
  const title = document.getElementById("event-title").value.trim();
  const calendarId = document.getElementById("event-calendar").value;
  const date = document.getElementById("event-date").value;
  const time = document.getElementById("event-time").value;
  const desc = document.getElementById("event-desc").value.trim();
  const recurrence = document.getElementById("event-recurrence").value;
  const reminderRaw = document.getElementById("event-reminder").value;
  const reminderMinutes = reminderRaw === "" ? null : Number(reminderRaw);
  if (!title) { showToast("Bitte Titel eingeben"); shakeModal("modal-event"); return; }
  if (!date)  { showToast("Bitte Datum wählen"); shakeModal("modal-event"); return; }
  if (!calendarId) { showToast("Bitte Kalender wählen"); shakeModal("modal-event"); return; }

  const payload = { title, date, time, description: desc, calendarId, recurrence, reminderMinutes };

  if (editingEventId) {
    await updateEvent(editingEventId, payload);
  } else {
    await createEvent(payload);
  }

  closeModal("modal-event");
  editingEventId = null;
  ["event-title","event-time","event-desc"].forEach(id => document.getElementById(id).value = "");
});

// ═══════════════════════════════════════════════════════
// 20. TO-DO MODAL (Punkt 2 + 3)
// ═══════════════════════════════════════════════════════

document.getElementById("cancel-todo-btn").addEventListener("click", () => closeModal("modal-todo"));

document.getElementById("save-todo-btn").addEventListener("click", async () => {
  const title = document.getElementById("todo-title").value.trim();
  const description = document.getElementById("todo-desc").value.trim();
  const dueDate = document.getElementById("todo-date").value || null; // Punkt 3: optional
  const dueTime = document.getElementById("todo-time").value || null;
  const priority = document.getElementById("todo-priority").value;
  const projectId = document.getElementById("todo-project").value || null;
  const reminderRaw = document.getElementById("todo-reminder").value;
  const reminderMinutes = reminderRaw === "" ? null : Number(reminderRaw);
  if (!title) { showToast("Bitte Aufgabe eingeben"); shakeModal("modal-todo"); return; }
  await createTodo({ title, description, dueDate, dueTime, priority, projectId, reminderMinutes });
  closeModal("modal-todo");
  ["todo-title","todo-desc","todo-date","todo-time"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("todo-project").value = "";
});

// ═══════════════════════════════════════════════════════
// 21. NOTIZ MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("cancel-note-btn").addEventListener("click", () => closeModal("modal-note"));

document.getElementById("save-note-btn").addEventListener("click", async () => {
  const title = document.getElementById("note-title").value.trim();
  const content = document.getElementById("note-content").value.trim();
  const projectId = document.getElementById("note-project").value || null;
  if (!title && !content) { showToast("Bitte Inhalt eingeben"); shakeModal("modal-note"); return; }
  await createNote({ title, content, projectId });
  closeModal("modal-note");
  ["note-title","note-content"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("note-project").value = "";
});

// ═══════════════════════════════════════════════════════
// 22. PROJEKT MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("color-picker").addEventListener("click", e => {
  const dot = e.target.closest(".color-dot");
  if (!dot) return;
  document.querySelectorAll("#color-picker .color-dot").forEach(d => d.classList.remove("selected"));
  dot.classList.add("selected");
  state.selectedProjectColor = dot.dataset.color;
});
document.getElementById("cancel-project-btn").addEventListener("click", () => closeModal("modal-project"));
document.getElementById("save-project-btn").addEventListener("click", async () => {
  const name = document.getElementById("project-name").value.trim();
  if (!name) { showToast("Bitte Projektname eingeben"); shakeModal("modal-project"); return; }
  await createProject({ name, color: state.selectedProjectColor });
  closeModal("modal-project");
  document.getElementById("project-name").value = "";
});

// ═══════════════════════════════════════════════════════
// 23. KALENDER MODAL (Punkt 5)
// ═══════════════════════════════════════════════════════

document.getElementById("cal-color-picker").addEventListener("click", e => {
  const dot = e.target.closest(".color-dot");
  if (!dot) return;
  document.querySelectorAll("#cal-color-picker .color-dot").forEach(d => d.classList.remove("selected"));
  dot.classList.add("selected");
  state.selectedCalendarColor = dot.dataset.color;
});
document.getElementById("cancel-calendar-btn").addEventListener("click", () => closeModal("modal-calendar"));
document.getElementById("save-calendar-btn").addEventListener("click", async () => {
  const name = document.getElementById("calendar-name").value.trim();
  if (!name) { showToast("Bitte Kalendernamen eingeben"); shakeModal("modal-calendar"); return; }
  await createCalendar({ name, color: state.selectedCalendarColor });
  closeModal("modal-calendar");
  document.getElementById("calendar-name").value = "";
});

document.getElementById("add-calendar-btn").addEventListener("click", () => openModal("modal-calendar"));
document.getElementById("close-calendar-manage-btn").addEventListener("click", () => closeModal("modal-calendar-manage"));

// ═══════════════════════════════════════════════════════
// 26b. EINSTELLUNGEN-TAB (Punkt 4)
// ═══════════════════════════════════════════════════════

document.getElementById("accent-color-picker").addEventListener("click", async (e) => {
  const dot = e.target.closest(".color-dot");
  if (!dot) return;
  const hex = dot.dataset.color;
  applyAccentColor(hex);
  try {
    await update(REFS.settings(), { accentColor: hex });
  } catch (err) {
    showToast("Fehler beim Speichern: " + err.message);
  }
});

document.getElementById("settings-manage-calendars-btn").addEventListener("click", () => {
  renderCalendarManageList();
  openModal("modal-calendar-manage");
});

document.getElementById("settings-add-calendar-btn").addEventListener("click", () => {
  openModal("modal-calendar");
});

// ═══════════════════════════════════════════════════════
// 24. PROJEKT-DETAIL MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("close-project-detail-btn").addEventListener("click", () => {
  closeModal("modal-project-detail");
  state.activeProjectId = null;
});
document.getElementById("delete-project-btn").addEventListener("click", () => {
  if (!state.activeProjectId) return;
  const proj = state.projects[state.activeProjectId];
  confirmDelete({
    title: "Projekt löschen?",
    text: proj?.name ? `"${proj.name}" wird gelöscht. Verknüpfte To-Dos und Notizen bleiben erhalten, verlieren aber die Zuordnung.` : "Dieses Projekt wird gelöscht.",
    onConfirm: async () => {
      await deleteProject(state.activeProjectId);
      closeModal("modal-project-detail");
      state.activeProjectId = null;
    }
  });
});

// ═══════════════════════════════════════════════════════
// 25. TODO-FILTER
// ═══════════════════════════════════════════════════════

document.querySelectorAll(".filter-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    state.todoFilter = chip.dataset.filter;
    renderTodoList();
  });
});

// ═══════════════════════════════════════════════════════
// 26. KALENDER NAVIGATION + AUFKLAPPEN (Punkt 4)
// ═══════════════════════════════════════════════════════

document.getElementById("cal-prev").addEventListener("click", () => {
  const d = state.currentDate;
  state.currentDate = new Date(d.getFullYear(), d.getMonth()-1, 1);
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  const d = state.currentDate;
  state.currentDate = new Date(d.getFullYear(), d.getMonth()+1, 1);
  renderCalendar();
});
document.getElementById("expand-toggle").addEventListener("click", toggleMonthExpand);

// Punkt 1: Gewichts-/Schlaf-Liste nur bei Klick auf das Diagramm anzeigen
let weightHistoryExpanded = false;
document.getElementById("progress-chart-card").addEventListener("click", () => {
  weightHistoryExpanded = !weightHistoryExpanded;
  document.getElementById("weight-history-expand").classList.toggle("open", weightHistoryExpanded);
  document.getElementById("chart-tap-hint").classList.toggle("open", weightHistoryExpanded);
});

// ═══════════════════════════════════════════════════════
// 27. BOTTOM NAV
// ═══════════════════════════════════════════════════════

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    const fromIndex = TAB_ORDER.indexOf(state.currentView);
    const toIndex = TAB_ORDER.indexOf(btn.dataset.view);
    const direction = toIndex > fromIndex ? "forward" : (toIndex < fromIndex ? "backward" : undefined);
    navigate(btn.dataset.view, direction);
    btn.classList.add("nav-bounce");
    setTimeout(() => btn.classList.remove("nav-bounce"), 350);
  });
});

// ═══════════════════════════════════════════════════════
// 27b. SWIPE-NAVIGATION ZWISCHEN TABS (Punkt 4)
// ═══════════════════════════════════════════════════════

const TAB_ORDER = ["calendar", "projects", "todos", "notes", "training"];

// Container, innerhalb derer horizontales Wischen NICHT den Tab wechseln soll
// (z.B. horizontal scrollbare Chip-Leisten)
const SWIPE_EXCLUDE_SELECTOR = ".filter-bar, .cal-filter-bar, .week-strip, .sport-picker, .zone-picker, .intake-shortcut-grid, .color-picker";

let swipeStartX = 0, swipeStartY = 0, swipeActive = false;

const mainContent = document.getElementById("main-content");

mainContent.addEventListener("touchstart", (e) => {
  if (e.target.closest(SWIPE_EXCLUDE_SELECTOR)) { swipeActive = false; return; }
  if (e.touches.length !== 1) { swipeActive = false; return; }
  swipeStartX = e.touches[0].clientX;
  swipeStartY = e.touches[0].clientY;
  swipeActive = true;
}, { passive: true });

mainContent.addEventListener("touchend", (e) => {
  if (!swipeActive) return;
  swipeActive = false;
  const touch = e.changedTouches[0];
  const deltaX = touch.clientX - swipeStartX;
  const deltaY = touch.clientY - swipeStartY;

  const SWIPE_THRESHOLD = 65;
  // Nur reagieren, wenn die Bewegung deutlich horizontaler als vertikaler Natur ist
  if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY) * 1.5) return;

  const currentIndex = TAB_ORDER.indexOf(state.currentView);
  if (currentIndex === -1) return;

  if (deltaX < 0 && currentIndex < TAB_ORDER.length - 1) {
    navigate(TAB_ORDER[currentIndex + 1], "forward");
  } else if (deltaX > 0 && currentIndex > 0) {
    navigate(TAB_ORDER[currentIndex - 1], "backward");
  }
}, { passive: true });

// ═══════════════════════════════════════════════════════
// 28b. MORGEN-BRIEFING (Punkt 2)
// ═══════════════════════════════════════════════════════

const BRIEFING_LAST_SHOWN_KEY = "allInOne_briefingLastShown";

function shouldShowBriefingToday() {
  const lastShown = localStorage.getItem(BRIEFING_LAST_SHOWN_KEY);
  return lastShown !== today();
}

function buildBriefingHTML() {
  const t = today();

  // Events von heute (alle Kalender)
  const todayEvents = Object.values(state.events)
    .filter(e => e.date === t)
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));

  // Offene To-Dos, die heute fällig sind
  const todayTodos = toArray(state.todos)
    .filter(td => td.dueDate === t && !td.done)
    .sort((a, b) => (a.dueTime || "").localeCompare(b.dueTime || ""));

  const hasAnything = todayEvents.length > 0 || todayTodos.length > 0;

  if (!hasAnything) {
    const quote = pickDailyQuote();
    return `
      <div class="briefing-quote">
        <div class="briefing-quote-text">„${escHtml(quote.text)}"</div>
        ${quote.author ? `<div class="briefing-quote-author">${escHtml(quote.author)}</div>` : `<div class="briefing-quote-author">Heute steht nichts an — genieß den freien Tag.</div>`}
      </div>`;
  }

  let html = "";

  if (todayEvents.length) {
    html += `<div class="briefing-section">
      <div class="briefing-section-label">Termine heute</div>
      ${todayEvents.map(e => `
        <div class="briefing-row">
          <span class="briefing-dot" style="background:${calColor(e.calendarId)}"></span>
          <span class="briefing-row-text">${escHtml(e.title)}</span>
          <span class="briefing-row-time">${e.time || ""}</span>
        </div>
      `).join("")}
    </div>`;
  }

  if (todayTodos.length) {
    const pColor = { high: "var(--prio-high)", medium: "var(--prio-medium)", low: "var(--prio-low)" };
    html += `<div class="briefing-section">
      <div class="briefing-section-label">Aufgaben heute</div>
      ${todayTodos.map(td => `
        <div class="briefing-row">
          <span class="briefing-dot" style="background:${pColor[td.priority] || 'var(--accent)'}"></span>
          <span class="briefing-row-text">${escHtml(td.title)}</span>
          <span class="briefing-row-time">${td.dueTime || ""}</span>
        </div>
      `).join("")}
    </div>`;
  }

  return html;
}

function showMorningBriefing() {
  const now = new Date();
  const dateLabel = now.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long" });
  document.getElementById("briefing-date").textContent = dateLabel;

  const hour = now.getHours();
  let greeting = "Guten Morgen!";
  if (hour >= 11 && hour < 17) greeting = "Hallo!";
  else if (hour >= 17) greeting = "Guten Abend!";

  document.getElementById("briefing-greeting").textContent = greeting;
  document.getElementById("briefing-content").innerHTML = buildBriefingHTML();

  openModal("modal-briefing");
  localStorage.setItem(BRIEFING_LAST_SHOWN_KEY, today());
}

document.getElementById("briefing-close-btn").addEventListener("click", () => closeModal("modal-briefing"));

// ═══════════════════════════════════════════════════════
// 28c. PFLICHT-CHECK-IN (Schlaf + Gewicht) — läuft VOR dem Briefing
// ═══════════════════════════════════════════════════════

/** Prüft, ob für heute bereits Gewicht UND Schlafdauer erfasst wurden */
function hasTodayCheckin() {
  const c = state.checkins[today()];
  if (!c) return false;
  const hasWeight = c.weight !== undefined && c.weight !== null && c.weight !== "";
  const hasSleep  = c.sleepHours !== undefined && c.sleepHours !== null && c.sleepHours !== "";
  return hasWeight && hasSleep;
}

document.getElementById("checkin-sleep-quality").addEventListener("input", (e) => {
  document.getElementById("checkin-sleep-quality-val").textContent = e.target.value;
});

document.getElementById("save-checkin-btn").addEventListener("click", async () => {
  const weight = document.getElementById("checkin-weight").value;
  const sleepH = document.getElementById("checkin-sleep-h").value;
  const sleepM = document.getElementById("checkin-sleep-m").value;
  const sleepQuality = document.getElementById("checkin-sleep-quality").value;

  if (!weight) { showToast("Bitte Gewicht eingeben"); shakeModal("modal-checkin"); return; }
  if (sleepH === "" && sleepM === "") { showToast("Bitte Schlafdauer eingeben"); shakeModal("modal-checkin"); return; }

  await saveCheckin(today(), {
    weight: Number(weight),
    sleepHours: hmToDecimalHours(sleepH, sleepM),
    sleepQuality: Number(sleepQuality)
  });

  closeModal("modal-checkin");
  // Direkt im Anschluss das Briefing zeigen
  showMorningBriefing();
});

/** Orchestriert: erst Pflicht-Check-in (falls nötig), danach Morgen-Briefing */
function runMorningFlow() {
  if (!hasTodayCheckin()) {
    // Felder zurücksetzen / Defaults setzen
    document.getElementById("checkin-weight").value = "";
    document.getElementById("checkin-sleep-h").value = "";
    document.getElementById("checkin-sleep-m").value = "";
    document.getElementById("checkin-sleep-quality").value = 75;
    document.getElementById("checkin-sleep-quality-val").textContent = "75";
    openModal("modal-checkin");
  } else {
    showMorningBriefing();
  }
}

// ═══════════════════════════════════════════════════════
// 28d. AUTH-SCREEN: Login / Registrierung (Punkt 3)
// ═══════════════════════════════════════════════════════

let authMode = "login";

function showAuthScreen() {
  document.getElementById("auth-screen").classList.add("show");
  document.getElementById("app").style.display = "none";
}
function hideAuthScreen() {
  document.getElementById("auth-screen").classList.remove("show");
  document.getElementById("app").style.display = "flex";
}
function setAuthError(msg) {
  document.getElementById("auth-error").textContent = msg || "";
}

function translateAuthError(code) {
  const map = {
    "auth/invalid-email": "Ungültige E-Mail-Adresse.",
    "auth/user-not-found": "Kein Konto mit dieser E-Mail gefunden.",
    "auth/wrong-password": "Falsches Passwort.",
    "auth/invalid-credential": "E-Mail oder Passwort ist falsch.",
    "auth/email-already-in-use": "Für diese E-Mail existiert bereits ein Konto.",
    "auth/weak-password": "Das Passwort muss mindestens 6 Zeichen haben.",
    "auth/too-many-requests": "Zu viele Versuche. Bitte später erneut versuchen.",
    "auth/network-request-failed": "Keine Verbindung. Bitte Internetverbindung prüfen."
  };
  return map[code] || "Etwas ist schiefgelaufen. Bitte erneut versuchen.";
}

document.getElementById("auth-toggle-btn").addEventListener("click", () => {
  authMode = authMode === "login" ? "signup" : "login";
  document.getElementById("auth-submit-btn").textContent = authMode === "login" ? "Anmelden" : "Registrieren";
  document.getElementById("auth-subtitle").textContent = authMode === "login" ? "Melde dich an, um fortzufahren." : "Erstelle ein neues Konto.";
  document.getElementById("auth-toggle-btn").textContent = authMode === "login" ? "Noch kein Konto? Registrieren" : "Bereits ein Konto? Anmelden";
  setAuthError("");
});

document.getElementById("auth-submit-btn").addEventListener("click", async () => {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  setAuthError("");
  if (!email || !password) { setAuthError("Bitte E-Mail und Passwort eingeben."); return; }

  const btn = document.getElementById("auth-submit-btn");
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Bitte warten…";

  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    document.getElementById("auth-password").value = "";
  } catch (e) {
    setAuthError(translateAuthError(e.code));
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
});

// ── Konto-Modal (Punkt 3: Logout, Punkt 1: Profil) ──

/** Verfügbare Optionen für die Hauptsportarten-Auswahl im Profil */
const MAIN_SPORT_OPTIONS = [
  { id: "swim", label: "Swim", icon: "🏊" },
  { id: "bike", label: "Bike", icon: "🚴" },
  { id: "run",  label: "Run",  icon: "🏃" },
  { id: "hit",       label: "HIT",      icon: "🔥" },
  { id: "athletics", label: "Athletik", icon: "🏋️" },
  { id: "mobility",  label: "Mobility", icon: "🧘" }
];

function renderMainSportsPicker() {
  const picker = document.getElementById("main-sports-picker");
  picker.innerHTML = MAIN_SPORT_OPTIONS.map(s =>
    `<button type="button" class="zone-chip ${state.selectedMainSports.has(s.id) ? "selected" : ""}" data-main-sport="${s.id}">${s.icon} ${s.label}</button>`
  ).join("");
  picker.querySelectorAll(".zone-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const id = chip.dataset.mainSport;
      if (state.selectedMainSports.has(id)) state.selectedMainSports.delete(id);
      else state.selectedMainSports.add(id);
      renderMainSportsPicker();
    });
  });
}

document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("account-email-display").textContent = auth.currentUser?.email || "";

  const p = state.profile || {};
  document.getElementById("profile-name").value = p.name || "";
  document.getElementById("profile-age").value = p.age ?? "";
  document.getElementById("profile-weight").value = p.weight ?? "";
  document.getElementById("profile-target-weight").value = p.targetWeight ?? "";
  state.selectedMainSports = new Set(Array.isArray(p.mainSports) ? p.mainSports : []);
  renderMainSportsPicker();

  openModal("modal-settings");
});
document.getElementById("close-settings-btn").addEventListener("click", () => closeModal("modal-settings"));

document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const name = document.getElementById("profile-name").value.trim();
  const age = document.getElementById("profile-age").value;
  const weight = document.getElementById("profile-weight").value;
  const targetWeight = document.getElementById("profile-target-weight").value;

  try {
    await update(REFS.profile(), {
      name,
      age: age === "" ? null : Number(age),
      weight: weight === "" ? null : Number(weight),
      targetWeight: targetWeight === "" ? null : Number(targetWeight),
      mainSports: Array.from(state.selectedMainSports)
    });
    showToast("Profil gespeichert ✓");
    closeModal("modal-settings");
  } catch (e) {
    showToast("Fehler beim Speichern: " + e.message);
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  confirmDelete({
    title: "Abmelden?",
    text: "Du wirst von diesem Gerät abgemeldet.",
    confirmLabel: "Abmelden",
    onConfirm: async () => {
      closeModal("modal-settings");
      await signOut(auth);
    }
  });
});

// ── Service Worker über den aktuellen Nutzer informieren (für Hintergrund-Erinnerungen) ──

function notifyServiceWorkerOfUid(uid) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.ready.then(reg => {
    reg.active?.postMessage({ type: "SET_UID", uid });
  }).catch(() => {});
}

// ═══════════════════════════════════════════════════════
// 29. APP START — Login-Status prüfen, dann pro Nutzer initialisieren
// ═══════════════════════════════════════════════════════

function init() {
  renderCalendar();
  renderWeekStrip();
  renderDashboardHero();
  navigate("calendar");
  updateNotifBanner();

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const isNewUser = currentUid !== user.uid;
      currentUid = user.uid;
      hideAuthScreen();

      if (isNewUser) resetAppState();

      await migrateLegacyDataIfNeeded(user.uid);
      notifyServiceWorkerOfUid(user.uid);
      initListeners();

      // Morgen-Flow: zeigen, sobald Events, To-Dos UND Check-ins einmal geladen sind
      // (nur beim ersten Öffnen des Tages, danach nicht mehr automatisch)
      if (shouldShowBriefingToday()) {
        let eventsLoaded = false, todosLoaded = false, checkinsLoaded = false;
        const tryRunFlow = () => {
          if (eventsLoaded && todosLoaded && checkinsLoaded) runMorningFlow();
        };
        onValue(REFS.events(),   () => { eventsLoaded = true;   tryRunFlow(); }, { onlyOnce: true });
        onValue(REFS.todos(),    () => { todosLoaded = true;    tryRunFlow(); }, { onlyOnce: true });
        onValue(REFS.checkins(), () => { checkinsLoaded = true; tryRunFlow(); }, { onlyOnce: true });
      }
    } else {
      currentUid = null;
      resetAppState();
      notifyServiceWorkerOfUid(null);
      showAuthScreen();
    }
  });
}

init();
