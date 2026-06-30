/**
 * ALL-IN-ONE PRODUKTIVITÄTS-APP — app.js
 * Firebase Realtime Database · Anonyme Auth · Vanilla JS ES6+ Modules
 */

// ═══════════════════════════════════════════════════════
// 1. FIREBASE KONFIGURATION & INITIALISIERUNG
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, push, set, update, remove, onValue, get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import {
  getAuth, signInAnonymously, onAuthStateChanged
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

const REFS = {
  events:    () => ref(db, "events"),
  event:     (id) => ref(db, `events/${id}`),
  todos:     () => ref(db, "todos"),
  todo:      (id) => ref(db, `todos/${id}`),
  notes:     () => ref(db, "notes"),
  note:      (id) => ref(db, `notes/${id}`),
  projects:  () => ref(db, "projects"),
  project:   (id) => ref(db, `projects/${id}`),
  calendars: () => ref(db, "calendars"),
  calendar:  (id) => ref(db, `calendars/${id}`)
};

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
  openTodoIds:          new Set() // welche To-Do-Beschreibungen aufgeklappt sind
};

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
function confirmDelete({ title = "Wirklich löschen?", text = "Diese Aktion kann nicht rückgängig gemacht werden.", onConfirm }) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-text").textContent = text;
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
// 4. FIREBASE CRUD — EVENTS
// ═══════════════════════════════════════════════════════

async function createEvent(data) {
  try {
    const newRef = push(REFS.events());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Event gespeichert ✓");
  } catch (e) { showToast("Fehler beim Speichern: " + e.message); }
}
async function deleteEvent(id) {
  try { await remove(REFS.event(id)); showToast("Event gelöscht"); }
  catch (e) { showToast("Fehler beim Löschen: " + e.message); }
}

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
  try { await update(REFS.todo(id), { done: !currentDone }); }
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
// 9. FIREBASE REALTIME LISTENER
// ═══════════════════════════════════════════════════════

function initListeners() {
  onValue(REFS.events(), snap => {
    state.events = snap.exists() ? snap.val() : {};
    renderCalendar();
    renderWeekStrip();
    renderDayEvents();
    renderTodayTodos();
  });

  onValue(REFS.todos(), snap => {
    state.todos = snap.exists() ? snap.val() : {};
    renderTodoList();
    renderTodayTodos();
    renderProjectDetail();
    populateProjectSelects();
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
    renderCalendarManageList();
    renderCalendar();
    renderWeekStrip();
    renderDayEvents();
  });
}

// ═══════════════════════════════════════════════════════
// 10. SPA ROUTING
// ═══════════════════════════════════════════════════════

function navigate(viewName) {
  state.currentView = viewName;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.getElementById(`view-${viewName}`)?.classList.add("active");
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  const titles = { calendar:"Kalender", projects:"Projekte", todos:"To-Dos", notes:"Notizen" };
  document.getElementById("header-title").textContent = titles[viewName] || "";
  renderHeaderActions();
}

/** Punkt 5: Im Kalender-View zusätzlich einen "Kalender verwalten"-Button anzeigen */
function renderHeaderActions() {
  const right = document.getElementById("header-right");
  let manageBtn = document.getElementById("manage-calendars-btn");
  if (state.currentView === "calendar") {
    if (!manageBtn) {
      manageBtn = document.createElement("button");
      manageBtn.id = "manage-calendars-btn";
      manageBtn.className = "icon-btn";
      manageBtn.setAttribute("aria-label", "Kalender verwalten");
      manageBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
      manageBtn.addEventListener("click", () => {
        renderCalendarManageList();
        openModal("modal-calendar-manage");
      });
      right.insertBefore(manageBtn, document.getElementById("header-action-btn"));
    }
    manageBtn.style.display = "flex";
  } else if (manageBtn) {
    manageBtn.style.display = "none";
  }
}

// ═══════════════════════════════════════════════════════
// 11. KALENDER RENDERING (Punkt 4: Wochenstreifen + Aufklappbar)
// ═══════════════════════════════════════════════════════

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

  // Events gruppiert nach Datum, mit Kalenderfarben (gefiltert nach calFilter)
  const eventsByDate = {};
  Object.values(state.events).forEach(e => {
    if (!e.date) return;
    if (state.calFilter !== "all" && e.calendarId !== state.calFilter) return;
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  });

  let html = "", cellCount = 0;

  for (let i = startOffset - 1; i >= 0; i--) {
    html += `<div class="cal-day other-month"><span class="cal-day-num">${daysInPrev - i}</span></div>`;
    cellCount++;
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const isToday = dateStr === today();
    const isSelected = dateStr === state.selectedDate;
    const dayEvents = eventsByDate[dateStr] || [];
    const classes = ["cal-day", isToday?"today":"", isSelected?"selected":""].filter(Boolean).join(" ");

    const dots = dayEvents.slice(0,3).map(e =>
      `<span class="event-dot" style="background:${calColor(e.calendarId)}"></span>`
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

  const eventsByDate = {};
  Object.values(state.events).forEach(e => {
    if (!e.date) return;
    if (state.calFilter !== "all" && e.calendarId !== state.calFilter) return;
    if (!eventsByDate[e.date]) eventsByDate[e.date] = [];
    eventsByDate[e.date].push(e);
  });

  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    const ds = toDateString(d);
    const isT = ds === today(), isSel = ds === state.selectedDate;
    const dayEvents = eventsByDate[ds] || [];
    const dots = dayEvents.slice(0,3).map(e =>
      `<span class="event-dot" style="background:${calColor(e.calendarId)}"></span>`
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

  let dayEvents = Object.entries(state.events).filter(([, e]) => e.date === sd);
  if (state.calFilter !== "all") dayEvents = dayEvents.filter(([, e]) => e.calendarId === state.calFilter);
  dayEvents.sort(([, a], [, b]) => (a.time || "").localeCompare(b.time || ""));

  if (!dayEvents.length) {
    list.innerHTML = `<li class="empty-state">Keine Events für diesen Tag.</li>`;
    return;
  }

  list.innerHTML = dayEvents.map(([id, e]) => {
    const color = calColor(e.calendarId);
    const calName = e.calendarId ? state.calendars[e.calendarId]?.name : null;
    return `
    <li class="event-item" style="--event-color:${color}">
      <span class="event-time">${e.time || "–"}</span>
      <div class="event-info">
        <div class="event-title-text">${escHtml(e.title)}</div>
        ${e.description ? `<div class="event-desc-text">${escHtml(e.description)}</div>` : ""}
        ${calName ? `<span class="event-cal-badge" style="margin-top:4px;display:inline-block">${escHtml(calName)}</span>` : ""}
      </div>
      <button class="delete-btn" data-id="${id}" aria-label="Löschen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>`;
  }).join("");

  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const ev = state.events[btn.dataset.id];
      confirmDelete({
        title: "Event löschen?",
        text: ev?.title ? `"${ev.title}" wird endgültig gelöscht.` : "Dieses Event wird endgültig gelöscht.",
        onConfirm: () => {
          const li = btn.closest("li");
          animateRemoval(li, () => deleteEvent(btn.dataset.id));
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
            ${td.dueDate ? `<span class="todo-date">${formatDate(td.dueDate)}</span>` : ""}
            ${td.priority ? `<span class="prio-badge prio-${td.priority}">${prioLabel}</span>` : ""}
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
}

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
  ["todo-project", "note-project"].forEach(id => {
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
  const modalMap = { calendar:"modal-event", projects:"modal-project", todos:"modal-todo", notes:"modal-note" };
  const m = modalMap[state.currentView];
  if (!m) return;

  if (state.currentView === "calendar") {
    if (!Object.keys(state.calendars).length) {
      showToast("Bitte zuerst einen Kalender anlegen");
      openModal("modal-calendar");
      return;
    }
    document.getElementById("event-date").value = state.selectedDate;
    populateCalendarSelect();
  }
  if (state.currentView === "todos") document.getElementById("todo-date").value = "";
  openModal(m);
});

// ═══════════════════════════════════════════════════════
// 19. EVENT MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("add-event-btn").addEventListener("click", () => {
  if (!Object.keys(state.calendars).length) {
    showToast("Bitte zuerst einen Kalender anlegen");
    openModal("modal-calendar");
    return;
  }
  document.getElementById("event-date").value = state.selectedDate;
  populateCalendarSelect();
  openModal("modal-event");
});

document.getElementById("cancel-event-btn").addEventListener("click", () => closeModal("modal-event"));

document.getElementById("save-event-btn").addEventListener("click", async () => {
  const title = document.getElementById("event-title").value.trim();
  const calendarId = document.getElementById("event-calendar").value;
  const date = document.getElementById("event-date").value;
  const time = document.getElementById("event-time").value;
  const desc = document.getElementById("event-desc").value.trim();
  if (!title) { showToast("Bitte Titel eingeben"); shakeModal("modal-event"); return; }
  if (!date)  { showToast("Bitte Datum wählen"); shakeModal("modal-event"); return; }
  if (!calendarId) { showToast("Bitte Kalender wählen"); shakeModal("modal-event"); return; }
  await createEvent({ title, date, time, description: desc, calendarId });
  closeModal("modal-event");
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
  const priority = document.getElementById("todo-priority").value;
  const projectId = document.getElementById("todo-project").value || null;
  if (!title) { showToast("Bitte Aufgabe eingeben"); shakeModal("modal-todo"); return; }
  await createTodo({ title, description, dueDate, priority, projectId });
  closeModal("modal-todo");
  ["todo-title","todo-desc","todo-date"].forEach(id => document.getElementById(id).value = "");
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

// ═══════════════════════════════════════════════════════
// 27. BOTTOM NAV
// ═══════════════════════════════════════════════════════

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    navigate(btn.dataset.view);
    btn.classList.add("nav-bounce");
    setTimeout(() => btn.classList.remove("nav-bounce"), 350);
  });
});

// ═══════════════════════════════════════════════════════
// 28. APP START — Anonyme Auth → dann Listener starten
// ═══════════════════════════════════════════════════════

function init() {
  renderCalendar();
  renderWeekStrip();
  navigate("calendar");

  onAuthStateChanged(auth, user => {
    if (user) {
      initListeners();
    } else {
      signInAnonymously(auth).catch(e => showToast("Auth-Fehler: " + e.message));
    }
  });
}

init();
