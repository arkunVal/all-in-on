/**
 * ALL-IN-ONE PRODUKTIVITÄTS-APP — app.js
 * Firebase Realtime Database · Vanilla JS ES6+ Modules
 */

// ═══════════════════════════════════════════════════════
// 1. FIREBASE KONFIGURATION & INITIALISIERUNG
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase,
  ref,
  push,
  set,
  update,
  remove,
  onValue,
  get
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

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
const db = getDatabase(firebaseApp);

// Firebase Referenzen (Pfade in der Realtime DB)
const REFS = {
  events:   () => ref(db, "events"),
  event:    (id) => ref(db, `events/${id}`),
  todos:    () => ref(db, "todos"),
  todo:     (id) => ref(db, `todos/${id}`),
  notes:    () => ref(db, "notes"),
  note:     (id) => ref(db, `notes/${id}`),
  projects: () => ref(db, "projects"),
  project:  (id) => ref(db, `projects/${id}`)
};

// ═══════════════════════════════════════════════════════
// 2. APP STATE
// ═══════════════════════════════════════════════════════

const state = {
  currentView:      "calendar",
  currentDate:      new Date(),          // angezeigte Monats-Basis
  selectedDate:     toDateString(new Date()), // "YYYY-MM-DD"
  events:           {},
  todos:            {},
  notes:            {},
  projects:         {},
  todoFilter:       "all",
  activeProjectId:  null,
  selectedProjectColor: "#6C63FF"
};

// ═══════════════════════════════════════════════════════
// 3. HILFSFUNKTIONEN
// ═══════════════════════════════════════════════════════

/** Datum → "YYYY-MM-DD" */
function toDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Heute als "YYYY-MM-DD" */
function today() { return toDateString(new Date()); }

/** "YYYY-MM-DD" → "DD.MM.YYYY" */
function formatDate(str) {
  if (!str) return "";
  const [y, m, d] = str.split("-");
  return `${d}.${m}.${y}`;
}

/** Monat + Jahr auf Deutsch */
function formatMonthYear(date) {
  return date.toLocaleString("de-DE", { month: "long", year: "numeric" });
}

/** Toast-Benachrichtigung */
let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}

/** Objekt → sortiertes Array mit id-Schlüssel */
function toArray(obj) {
  if (!obj) return [];
  return Object.entries(obj).map(([id, val]) => ({ ...val, id }));
}

// ═══════════════════════════════════════════════════════
// 4. FIREBASE CRUD — EVENTS
// ═══════════════════════════════════════════════════════

async function createEvent(data) {
  try {
    const newRef = push(REFS.events());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Event gespeichert ✓");
  } catch (e) {
    showToast("Fehler beim Speichern: " + e.message);
  }
}

async function deleteEvent(id) {
  try {
    await remove(REFS.event(id));
    showToast("Event gelöscht");
  } catch (e) {
    showToast("Fehler beim Löschen: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════
// 5. FIREBASE CRUD — TO-DOS
// ═══════════════════════════════════════════════════════

async function createTodo(data) {
  try {
    const newRef = push(REFS.todos());
    await set(newRef, { ...data, done: false, createdAt: Date.now() });
    showToast("To-Do gespeichert ✓");
  } catch (e) {
    showToast("Fehler beim Speichern: " + e.message);
  }
}

async function toggleTodo(id, currentDone) {
  try {
    await update(REFS.todo(id), { done: !currentDone });
  } catch (e) {
    showToast("Fehler: " + e.message);
  }
}

async function deleteTodo(id) {
  try {
    await remove(REFS.todo(id));
    showToast("To-Do gelöscht");
  } catch (e) {
    showToast("Fehler beim Löschen: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════
// 6. FIREBASE CRUD — NOTIZEN
// ═══════════════════════════════════════════════════════

async function createNote(data) {
  try {
    const newRef = push(REFS.notes());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast("Notiz gespeichert ✓");
  } catch (e) {
    showToast("Fehler beim Speichern: " + e.message);
  }
}

async function deleteNote(id) {
  try {
    await remove(REFS.note(id));
    showToast("Notiz gelöscht");
  } catch (e) {
    showToast("Fehler beim Löschen: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════
// 7. FIREBASE CRUD — PROJEKTE
// ═══════════════════════════════════════════════════════

async function createProject(data) {
  try {
    const newRef = push(REFS.projects());
    await set(newRef, { ...data, createdAt: Date.now() });
    showToast(`Projekt "${data.name}" erstellt ✓`);
  } catch (e) {
    showToast("Fehler: " + e.message);
  }
}

async function deleteProject(id) {
  try {
    await remove(REFS.project(id));
    // Verknüpfungen in To-Dos und Notizen entfernen
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
  } catch (e) {
    showToast("Fehler: " + e.message);
  }
}

// ═══════════════════════════════════════════════════════
// 8. FIREBASE REALTIME LISTENER (onValue)
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
}

// ═══════════════════════════════════════════════════════
// 9. SPA ROUTING — BOTTOM NAVIGATION
// ═══════════════════════════════════════════════════════

function navigate(viewName) {
  state.currentView = viewName;

  // Views
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  const target = document.getElementById(`view-${viewName}`);
  if (target) target.classList.add("active");

  // Nav-Items
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });

  // Header-Titel + Aktion
  const titles = {
    calendar: "Kalender",
    projects: "Projekte",
    todos:    "To-Dos",
    notes:    "Notizen"
  };
  document.getElementById("header-title").textContent = titles[viewName] || "";
}

// ═══════════════════════════════════════════════════════
// 10. KALENDER RENDERING
// ═══════════════════════════════════════════════════════

function renderCalendar() {
  const grid   = document.getElementById("calendar-grid");
  const label  = document.getElementById("cal-month-label");
  const d      = state.currentDate;
  const yr     = d.getFullYear();
  const mo     = d.getMonth();

  label.textContent = formatMonthYear(d);

  // Erster Tag des Monats → Wochentag (Mo=0 … So=6)
  const firstDay = new Date(yr, mo, 1);
  let startOffset = firstDay.getDay() - 1; // JS: 0=So
  if (startOffset < 0) startOffset = 6;

  const daysInMonth = new Date(yr, mo + 1, 0).getDate();
  const daysInPrev  = new Date(yr, mo, 0).getDate();

  // Events-Index: date-string → array
  const evDates = new Set(
    Object.values(state.events).map(e => e.date).filter(Boolean)
  );

  let html = "";
  let cellCount = 0;

  // Vormonat auffüllen
  for (let i = startOffset - 1; i >= 0; i--) {
    const day = daysInPrev - i;
    html += `<div class="cal-day other-month"><span class="cal-day-num">${day}</span></div>`;
    cellCount++;
  }

  // Aktueller Monat
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    const isToday    = dateStr === today();
    const isSelected = dateStr === state.selectedDate;
    const hasEvent   = evDates.has(dateStr);

    const classes = [
      "cal-day",
      isToday    ? "today"    : "",
      isSelected ? "selected" : "",
      hasEvent   ? "has-event": ""
    ].filter(Boolean).join(" ");

    html += `<div class="${classes}" data-date="${dateStr}">
      <span class="cal-day-num">${day}</span>
    </div>`;
    cellCount++;
  }

  // Nächster Monat auffüllen bis 42 Zellen (6 Wochen)
  let nextDay = 1;
  while (cellCount < 42) {
    html += `<div class="cal-day other-month"><span class="cal-day-num">${nextDay++}</span></div>`;
    cellCount++;
  }

  grid.innerHTML = html;

  // Click-Handler auf Tage
  grid.querySelectorAll(".cal-day[data-date]").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedDate = el.dataset.date;
      renderCalendar();
      renderWeekStrip();
      renderDayEvents();
      renderTodayTodos();
    });
  });
}

function renderWeekStrip() {
  const strip = document.getElementById("week-strip");
  const sel   = new Date(state.selectedDate + "T00:00:00");
  // Woche (Mo–So) um das gewählte Datum
  const dow   = sel.getDay() === 0 ? 6 : sel.getDay() - 1;
  const mon   = new Date(sel);
  mon.setDate(sel.getDate() - dow);

  const dayNames = ["Mo","Di","Mi","Do","Fr","Sa","So"];
  const evDates  = new Set(Object.values(state.events).map(e => e.date).filter(Boolean));

  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    const ds  = toDateString(d);
    const isT = ds === today();
    const isSel = ds === state.selectedDate;
    const hasEv = evDates.has(ds);

    html += `<div class="week-day-item ${isT?"today":""} ${isSel?"selected":""}" data-date="${ds}">
      <span class="week-day-name">${dayNames[i]}</span>
      <span class="week-day-num">${d.getDate()}</span>
      ${hasEv ? '<span class="event-dot"></span>' : '<span style="height:4px"></span>'}
    </div>`;
  }
  strip.innerHTML = html;

  strip.querySelectorAll(".week-day-item").forEach(el => {
    el.addEventListener("click", () => {
      state.selectedDate = el.dataset.date;
      // Monat anpassen falls nötig
      const clicked = new Date(el.dataset.date + "T00:00:00");
      if (
        clicked.getMonth() !== state.currentDate.getMonth() ||
        clicked.getFullYear() !== state.currentDate.getFullYear()
      ) {
        state.currentDate = new Date(clicked.getFullYear(), clicked.getMonth(), 1);
        renderCalendar();
      } else {
        renderCalendar();
      }
      renderWeekStrip();
      renderDayEvents();
      renderTodayTodos();
    });
  });
}

function renderDayEvents() {
  const list = document.getElementById("day-event-list");
  const title = document.getElementById("day-events-title");
  const sd = state.selectedDate;
  title.textContent = sd === today() ? "Heute" : formatDate(sd);

  const dayEvents = Object.entries(state.events)
    .filter(([, e]) => e.date === sd)
    .sort(([, a], [, b]) => (a.time || "").localeCompare(b.time || ""));

  if (!dayEvents.length) {
    list.innerHTML = `<li class="empty-state">Keine Events für diesen Tag.</li>`;
    return;
  }

  list.innerHTML = dayEvents.map(([id, e]) => `
    <li class="event-item">
      <span class="event-time">${e.time || "–"}</span>
      <div class="event-info">
        <div class="event-title-text">${escHtml(e.title)}</div>
        ${e.description ? `<div class="event-desc-text">${escHtml(e.description)}</div>` : ""}
      </div>
      <button class="delete-btn" data-id="${id}" aria-label="Löschen">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>
  `).join("");

  list.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteEvent(btn.dataset.id));
  });
}

function renderTodayTodos() {
  const list = document.getElementById("today-todo-list");
  const t    = today();
  const due  = toArray(state.todos).filter(td => td.dueDate === t && !td.done);

  if (!due.length) {
    list.innerHTML = `<li class="empty-state">Keine offenen Aufgaben für heute.</li>`;
    return;
  }
  list.innerHTML = due.map(td => buildTodoItem(td)).join("");
  attachTodoHandlers(list);
}

// ═══════════════════════════════════════════════════════
// 11. TO-DO RENDERING
// ═══════════════════════════════════════════════════════

function buildTodoItem(td) {
  const prioLabel = { high: "Hoch", medium: "Mittel", low: "Niedrig" }[td.priority] || "";
  return `
    <li class="todo-item ${td.done ? "done" : ""}" data-id="${td.id}">
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
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
      </button>
    </li>`;
}

function attachTodoHandlers(container) {
  container.querySelectorAll(".todo-checkbox").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id   = btn.dataset.id;
      const done = state.todos[id]?.done || false;
      toggleTodo(id, done);
    });
  });
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTodo(btn.dataset.id);
    });
  });
}

function renderTodoList() {
  const list = document.getElementById("todo-list");
  let items  = toArray(state.todos);

  if (state.todoFilter === "open")  items = items.filter(t => !t.done);
  if (state.todoFilter === "done")  items = items.filter(t => t.done);

  // Sortierung: offen zuerst, dann nach Priorität
  const pOrder = { high: 0, medium: 1, low: 2 };
  items.sort((a, b) => {
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
// 12. NOTIZEN RENDERING
// ═══════════════════════════════════════════════════════

function renderNotesList() {
  const grid = document.getElementById("notes-grid");
  const notes = toArray(state.notes)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

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
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6"/><path d="M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
      </div>
    </div>`;
}

function attachNoteHandlers(container) {
  container.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteNote(btn.dataset.id);
    });
  });
}

// ═══════════════════════════════════════════════════════
// 13. PROJEKT RENDERING
// ═══════════════════════════════════════════════════════

function renderProjectGrid() {
  const grid = document.getElementById("project-grid");
  const projects = toArray(state.projects)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

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
        <div class="project-card-count">${todoCount} To-Do${todoCount !== 1 ? "s" : ""} · ${noteCount} Notiz${noteCount !== 1 ? "en" : ""}</div>
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
  const id    = state.activeProjectId;

  // To-Dos des Projekts
  const pTodos = toArray(state.todos).filter(t => t.projectId === id);
  const tList  = document.getElementById("project-todo-list");
  if (!pTodos.length) {
    tList.innerHTML = `<li class="empty-state">Keine To-Dos in diesem Projekt.</li>`;
  } else {
    tList.innerHTML = pTodos.map(td => buildTodoItem(td)).join("");
    attachTodoHandlers(tList);
  }

  // Notizen des Projekts
  const pNotes = toArray(state.notes).filter(n => n.projectId === id);
  const nGrid  = document.getElementById("project-notes-grid");
  if (!pNotes.length) {
    nGrid.innerHTML = `<div class="empty-state">Keine Notizen in diesem Projekt.</div>`;
  } else {
    nGrid.innerHTML = pNotes.map(n => buildNoteCard(n)).join("");
    attachNoteHandlers(nGrid);
  }
}

// ═══════════════════════════════════════════════════════
// 14. PROJEKT-SELECTS BEFÜLLEN
// ═══════════════════════════════════════════════════════

function populateProjectSelects() {
  const selects = ["todo-project", "note-project"];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">— Kein Projekt —</option>`;
    toArray(state.projects).forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  });
}

// ═══════════════════════════════════════════════════════
// 15. MODAL MANAGEMENT
// ═══════════════════════════════════════════════════════

function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}
function closeAllModals() {
  document.querySelectorAll(".modal-overlay.open").forEach(m => m.classList.remove("open"));
}

// Schließen bei Klick auf Overlay (außerhalb des Sheets)
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) closeAllModals();
  });
});

// ═══════════════════════════════════════════════════════
// 16. HEADER AKTION (kontextabhängiger + Button)
// ═══════════════════════════════════════════════════════

document.getElementById("header-action-btn").addEventListener("click", () => {
  const modalMap = {
    calendar: "modal-event",
    projects: "modal-project",
    todos:    "modal-todo",
    notes:    "modal-note"
  };
  const m = modalMap[state.currentView];
  if (!m) return;

  // Datum vorbelegen
  if (state.currentView === "calendar") {
    document.getElementById("event-date").value = state.selectedDate;
  }
  if (state.currentView === "todos") {
    document.getElementById("todo-date").value = today();
  }
  openModal(m);
});

// ═══════════════════════════════════════════════════════
// 17. EVENT MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("add-event-btn").addEventListener("click", () => {
  document.getElementById("event-date").value = state.selectedDate;
  openModal("modal-event");
});

document.getElementById("cancel-event-btn").addEventListener("click", () => closeModal("modal-event"));

document.getElementById("save-event-btn").addEventListener("click", async () => {
  const title = document.getElementById("event-title").value.trim();
  const date  = document.getElementById("event-date").value;
  const time  = document.getElementById("event-time").value;
  const desc  = document.getElementById("event-desc").value.trim();
  if (!title) { showToast("Bitte Titel eingeben"); return; }
  if (!date)  { showToast("Bitte Datum wählen");   return; }
  await createEvent({ title, date, time, description: desc });
  closeModal("modal-event");
  // Felder leeren
  ["event-title","event-time","event-desc"].forEach(id => document.getElementById(id).value = "");
});

// ═══════════════════════════════════════════════════════
// 18. TO-DO MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("cancel-todo-btn").addEventListener("click", () => closeModal("modal-todo"));

document.getElementById("save-todo-btn").addEventListener("click", async () => {
  const title     = document.getElementById("todo-title").value.trim();
  const dueDate   = document.getElementById("todo-date").value;
  const priority  = document.getElementById("todo-priority").value;
  const projectId = document.getElementById("todo-project").value || null;
  if (!title) { showToast("Bitte Aufgabe eingeben"); return; }
  await createTodo({ title, dueDate, priority, projectId });
  closeModal("modal-todo");
  document.getElementById("todo-title").value = "";
  document.getElementById("todo-date").value  = "";
  document.getElementById("todo-project").value = "";
});

// ═══════════════════════════════════════════════════════
// 19. NOTIZ MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("cancel-note-btn").addEventListener("click", () => closeModal("modal-note"));

document.getElementById("save-note-btn").addEventListener("click", async () => {
  const title     = document.getElementById("note-title").value.trim();
  const content   = document.getElementById("note-content").value.trim();
  const projectId = document.getElementById("note-project").value || null;
  if (!title && !content) { showToast("Bitte Inhalt eingeben"); return; }
  await createNote({ title, content, projectId });
  closeModal("modal-note");
  document.getElementById("note-title").value   = "";
  document.getElementById("note-content").value = "";
  document.getElementById("note-project").value = "";
});

// ═══════════════════════════════════════════════════════
// 20. PROJEKT MODAL
// ═══════════════════════════════════════════════════════

// Farbauswahl
document.getElementById("color-picker").addEventListener("click", e => {
  const dot = e.target.closest(".color-dot");
  if (!dot) return;
  document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("selected"));
  dot.classList.add("selected");
  state.selectedProjectColor = dot.dataset.color;
});

document.getElementById("cancel-project-btn").addEventListener("click", () => closeModal("modal-project"));

document.getElementById("save-project-btn").addEventListener("click", async () => {
  const name = document.getElementById("project-name").value.trim();
  if (!name) { showToast("Bitte Projektname eingeben"); return; }
  await createProject({ name, color: state.selectedProjectColor });
  closeModal("modal-project");
  document.getElementById("project-name").value = "";
});

// ═══════════════════════════════════════════════════════
// 21. PROJEKT-DETAIL MODAL
// ═══════════════════════════════════════════════════════

document.getElementById("close-project-detail-btn").addEventListener("click", () => {
  closeModal("modal-project-detail");
  state.activeProjectId = null;
});

document.getElementById("delete-project-btn").addEventListener("click", async () => {
  if (!state.activeProjectId) return;
  await deleteProject(state.activeProjectId);
  closeModal("modal-project-detail");
  state.activeProjectId = null;
});

// ═══════════════════════════════════════════════════════
// 22. TODO-FILTER
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
// 23. KALENDER NAVIGATION
// ═══════════════════════════════════════════════════════

document.getElementById("cal-prev").addEventListener("click", () => {
  const d = state.currentDate;
  state.currentDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  renderCalendar();
  renderWeekStrip();
});

document.getElementById("cal-next").addEventListener("click", () => {
  const d = state.currentDate;
  state.currentDate = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  renderCalendar();
  renderWeekStrip();
});

// ═══════════════════════════════════════════════════════
// 24. BOTTOM NAV LISTENER
// ═══════════════════════════════════════════════════════

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => navigate(btn.dataset.view));
});

// ═══════════════════════════════════════════════════════
// 25. XSS-SCHUTZ
// ═══════════════════════════════════════════════════════

function escHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ═══════════════════════════════════════════════════════
// 26. APP START
// ═══════════════════════════════════════════════════════

function init() {
  renderCalendar();
  renderWeekStrip();
  navigate("calendar");
  initListeners();
}

init();
