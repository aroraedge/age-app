// Assign board (drag & drop), Schedule, Team, Alerts, Me/settings and notification UI.
import { CONFIG } from "./config.js";
import * as api from "./api.js";
import {
  html, useState, useEffect, useMemo, useRef,
  S, setS, useStore, loadAll, act, toast, friendlyError, isBoss, person, activePeople, jobById, jobColor, crewOf, assigneesOf,
  onSiteAt, go, today, isoDate, addDays, parseDate, fmtDate, fmtTime, ago, firstName,
  PRIORITY, I, Avatar, AvatarStack, Sheet, Field, PeoplePicker, Empty, Confirm,
} from "./lib.js";
import { TaskSheet } from "./job.js";

// =================================================================== BOARD
export function BoardPage() {
  const s = useStore();
  const [jobFilter, setJobFilter] = useState("all");
  const [showDone, setShowDone] = useState(false);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const wrap = useRef();

  const openJobs = s.jobs.filter((j) => j.status !== "done");
  const tasks = s.tasks.filter((t) => {
    const j = jobById(t.job_id);
    if (!j || j.status === "done") return false;
    if (jobFilter !== "all" && t.job_id !== jobFilter) return false;
    return showDone || t.status !== "done";
  }).sort((a, b) => a.priority - b.priority || a.sort_order - b.sort_order);

  const people = activePeople().sort((a, b) => (a.role === "boss") - (b.role === "boss") || a.full_name.localeCompare(b.full_name));
  const cols = [{ id: "", name: "Unassigned" }, ...people.map((p) => ({ id: p.id, name: p.full_name }))];
  const tasksFor = (uid) => tasks.filter((t) => (uid ? assigneesOf(t.id).includes(uid) : assigneesOf(t.id).length === 0));

  async function move(taskId, from, to) {
    if (from === to) return;
    const t = s.tasks.find((x) => x.id === taskId);
    const who = assigneesOf(taskId);
    const toName = to ? firstName(person(to)) : "Unassigned";
    await act(async () => {
      if (from) await api.remove("task_assignments", { task_id: taskId, user_id: from });
      if (to && !who.includes(to)) {
        await api.insert("task_assignments", { task_id: taskId, user_id: to });
        if (!S.members.some((m) => m.job_id === t.job_id && m.user_id === to)) {
          await api.insert("job_members", { job_id: t.job_id, user_id: to, status: "approved", added_by: S.me.id });
        }
      }
    }, to ? `Assigned to ${toName}` : "Moved to Unassigned");
  }
  const drag = useDragDrop(wrap, move);

  return html`<main class="page">
    <div class="page-head"><h1>Assign work</h1><button class="btn sm" onClick=${() => setCreating(true)}>${I.plus} Task</button></div>
    <p class="board-hint">Drag a task onto a person to assign it. On a phone, press and hold a card, then drag. Tap a card to edit.</p>
    <div class="row" style="margin-bottom:14px;gap:8px">
      <select value=${jobFilter} onChange=${(e) => setJobFilter(e.target.value)} style="flex:1">
        <option value="all">All open jobs</option>
        ${openJobs.map((j) => html`<option key=${j.id} value=${j.id}>${j.title}</option>`)}
      </select>
      <label class="switch small" style="flex:none"><input type="checkbox" checked=${showDone} onChange=${(e) => setShowDone(e.target.checked)} />Done</label>
    </div>
    <div class="board-wrap" ref=${wrap}><div class="board">
      ${cols.map((c) => {
        const list = tasksFor(c.id);
        const p = c.id && person(c.id);
        return html`<section class="col" key=${c.id || "none"} data-drop=${c.id}>
          <div class="col-head">${c.id ? html`<${Avatar} id=${c.id} size=${30} />` : html`<span class="avatar" style="width:30px;height:30px;background:var(--muted)">?</span>`}
            <strong>${c.name}</strong>${p?.role === "boss" && html`<span class="tag">Boss</span>`}<span class="count">${list.length}</span></div>
          ${list.map((t) => {
            const j = jobById(t.job_id);
            return html`<div class="tcard" key=${t.id + c.id} style=${`--c:${jobColor(t.job_id)}`}
              onPointerDown=${(e) => drag.start(e, t.id, c.id)} onClick=${() => drag.wasDragging() || setOpen(t)}>
              <div class="job">${j?.title}</div>
              <div class="tt" style=${t.status === "done" ? "text-decoration:line-through;opacity:.6" : ""}>${t.title}</div>
              <div class="row">
                ${t.priority === 1 && html`<span class="flag pr-high">${I.flag} High</span>`}
                ${t.status === "in_progress" && html`<span class="tag accent">Doing</span>`}
                ${t.due_date && html`<span class="muted">Due ${fmtDate(t.due_date)}</span>`}
                ${!c.id ? "" : assigneesOf(t.id).length > 1 && html`<span class="muted">+${assigneesOf(t.id).length - 1} more</span>`}
              </div>
            </div>`;
          })}
          ${!list.length && html`<div class="col-empty">${c.id ? "Drop tasks here" : "All tasks assigned 👍"}</div>`}
        </section>`;
      })}
    </div></div>
    ${open && html`<${TaskSheet} task=${open} onClose=${() => setOpen(null)} />`}
    ${creating && html`<${TaskSheet} jobId=${jobFilter !== "all" ? jobFilter : undefined} onClose=${() => setCreating(false)} />`}
  </main>`;
}

// Pointer-based drag & drop that works with mouse and touch (press-and-hold on touch).
function useDragDrop(scrollRef, onDrop) {
  const st = useRef({});
  useEffect(() => {
    const block = (e) => { if (st.current.dragging) e.preventDefault(); };
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  function cleanup() {
    const d = st.current;
    clearTimeout(d.timer);
    cancelAnimationFrame(d.raf);
    d.ghost?.remove();
    d.card?.classList.remove("dragging");
    document.querySelectorAll(".col.over").forEach((x) => x.classList.remove("over"));
    removeEventListener("pointermove", onMove);
    removeEventListener("pointerup", onUp);
    removeEventListener("pointercancel", onCancel);
    st.current = { justDragged: d.dragging };
    if (d.dragging) setTimeout(() => { st.current.justDragged = false; }, 50);
  }
  function begin() {
    const d = st.current;
    d.dragging = true;
    const r = d.card.getBoundingClientRect();
    d.dx = d.x - r.left; d.dy = d.y - r.top;
    d.ghost = d.card.cloneNode(true);
    d.ghost.classList.add("drag-ghost");
    document.body.appendChild(d.ghost);
    d.card.classList.add("dragging");
    navigator.vibrate?.(15);
    place();
    const edgeScroll = () => {
      const el = scrollRef.current;
      if (el && st.current.dragging) {
        const w = innerWidth;
        if (st.current.x > w - 50) el.scrollLeft += 12;
        else if (st.current.x < 50) el.scrollLeft -= 12;
        st.current.raf = requestAnimationFrame(edgeScroll);
      }
    };
    d.raf = requestAnimationFrame(edgeScroll);
  }
  function place() {
    const d = st.current;
    d.ghost.style.left = d.x - d.dx + "px";
    d.ghost.style.top = d.y - d.dy + "px";
    document.querySelectorAll(".col.over").forEach((x) => x.classList.remove("over"));
    const col = document.elementFromPoint(d.x, d.y)?.closest("[data-drop]");
    col?.classList.add("over");
    d.target = col ? col.dataset.drop : null;
  }
  function onMove(e) {
    const d = st.current;
    const moved = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    d.x = e.clientX; d.y = e.clientY;
    if (!d.dragging) {
      if (d.touch && moved > 10) return cleanup(); // it's a scroll, not a drag
      if (!d.touch && moved > 6) begin();
      return;
    }
    place();
  }
  function onUp() {
    const d = st.current;
    const go = d.dragging && d.target !== null && d.target !== undefined;
    const args = [d.taskId, d.from, d.target];
    cleanup();
    if (go) onDrop(...args);
  }
  function onCancel() { if (!st.current.dragging) cleanup(); }

  return {
    start(e, taskId, from) {
      if (e.button > 0) return;
      cleanup();
      const d = st.current;
      Object.assign(d, { taskId, from, card: e.currentTarget, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, touch: e.pointerType !== "mouse" });
      if (d.touch) d.timer = setTimeout(() => { if (!st.current.dragging && st.current.card) begin(); }, 280);
      addEventListener("pointermove", onMove);
      addEventListener("pointerup", onUp);
      addEventListener("pointercancel", onCancel);
    },
    wasDragging: () => !!st.current.justDragged,
  };
}

// ================================================================ SCHEDULE
const startOfWeek = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

export function SchedulePage() {
  const s = useStore();
  const boss = isBoss();
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const [day, setDay] = useState(today());
  const [scope, setScope] = useState(boss ? "all" : "mine");
  const [shifts, setShifts] = useState([]);
  const [events, setEvents] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [evSheet, setEvSheet] = useState(null);

  const days = [...Array(7)].map((_, i) => isoDate(addDays(week, i)));
  async function reload() {
    try { setShifts(await api.list("shifts", { gte: { work_date: days[0] }, lte: { work_date: days[6] }, order: ["start_time"] })); } catch (e) { console.error(e); }
    try { setEvents(await api.list("events", { gte: { event_date: days[0] }, lte: { event_date: days[6] }, order: ["start_time"] })); } catch (e) { console.error(e); setEvents([]); }
  }
  useEffect(() => { reload(); }, [week.getTime(), s.jobs, s.members]);
  useEffect(() => { if (!days.includes(day)) setDay(days[0] <= today() && today() <= days[6] ? today() : days[0]); }, [week.getTime()]);

  // Everything happening on a date: jobs that run that day + explicit shifts
  function agenda(date) {
    const dow = ((parseDate(date).getDay() + 6) % 7) + 1;
    const byJob = new Map();
    const add = (job, uid, start, end, shift) => {
      if (scope === "mine" && uid !== s.me.id) return;
      if (!byJob.has(job.id)) byJob.set(job.id, { job, rows: new Map() });
      const rows = byJob.get(job.id).rows;
      if (!rows.has(uid) || shift) rows.set(uid, { uid, start, end, shift });
    };
    for (const job of s.jobs) {
      if (!["active", "planned"].includes(job.status) || !job.start_date) continue;
      if (date < job.start_date || date > (job.end_date || job.start_date) || !(job.work_days || []).includes(dow)) continue;
      for (const uid of crewOf(job.id)) add(job, uid, job.start_time, null, null);
      if (scope === "all" && !byJob.has(job.id)) byJob.set(job.id, { job, rows: new Map() });
    }
    for (const sh of shifts.filter((x) => x.work_date === date)) {
      const job = jobById(sh.job_id);
      if (job) add(job, sh.user_id, sh.start_time || job.start_time, sh.end_time, sh);
    }
    return [...byJob.values()].map((g) => ({ ...g, rows: [...g.rows.values()].sort((a, b) => (a.start || "").localeCompare(b.start || "")) }))
      .sort((a, b) => (a.job.start_time || "").localeCompare(b.job.start_time || ""));
  }
  const eventsOn = (date) => events
    .filter((e) => e.event_date === date && (scope === "all" || e.created_by === s.me.id || (e.assignees || []).includes(s.me.id)))
    .sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "") || (URGENCY[b.urgency]?.rank || 0) - (URGENCY[a.urgency]?.rank || 0));
  const list = agenda(day);
  const dayEvents = eventsOn(day);
  const label = `${fmtDate(days[0])} – ${fmtDate(days[6])}`;

  return html`<main class="page">
    <div class="page-head sched-head"><h1>Schedule</h1>
      <div class="row" style="gap:8px">
        <button class="btn sm ghost" onClick=${() => setEvSheet({ date: day })}>${I.plus} Event</button>
        ${boss && html`<button class="btn sm" onClick=${() => setSheet({ date: day })}>${I.plus} Schedule crew</button>`}
      </div></div>
    <div class="seg" style="margin-bottom:14px">
      <button class=${scope === "mine" ? "on" : ""} onClick=${() => setScope("mine")}>My schedule</button>
      <button class=${scope === "all" ? "on" : ""} onClick=${() => setScope("all")}>Everyone</button>
    </div>
    <div class="weekbar">
      <button class="icon-btn" onClick=${() => setWeek(addDays(week, -7))} aria-label="Previous week">${I.chevL}</button>
      <strong>${label}</strong>
      <button class="icon-btn" onClick=${() => setWeek(addDays(week, 7))} aria-label="Next week">${I.chevR}</button>
    </div>
    <div class="days">${days.map((d) => {
      const has = agenda(d).some((g) => g.rows.length || scope === "all");
      const evs = eventsOn(d);
      return html`<button key=${d} class="daybtn ${d === day ? "on" : ""} ${d === today() ? "today" : ""} ${has ? "has" : ""}" onClick=${() => setDay(d)}>
        <small>${fmtDate(d, { weekday: "short" }).slice(0, 2)}</small><b>${parseDate(d).getDate()}</b>
        ${evs.length ? html`<span class="evdots">${evs.slice(0, 3).map((e) => html`<span key=${e.id} style=${`background:${evColor(e)}`}></span>`)}</span>` : html`<i></i>`}</button>`;
    })}</div>
    <h3 style="margin-bottom:12px">${day === today() ? "Today" : fmtDate(day, { weekday: "long", month: "long", day: "numeric" })}</h3>
    ${dayEvents.length > 0 && html`<div class="events">${dayEvents.map((e) => html`<${EventCard} key=${e.id} ev=${e} onOpen=${() => setEvSheet({ ev: e })} />`)}</div>`}
    ${list.length ? list.map(({ job, rows }) => html`<div class="card shift-group" key=${job.id} style=${`--c:${jobColor(job.id)}`}>
      <div class="row"><span class="jobdot"></span><a class="grow" href=${"#/job/" + job.id} style="color:inherit;text-decoration:none"><strong>${job.title}</strong>
        <div class="small muted">${job.address || "No address"}</div></a>${job.start_time && html`<span class="tag">${fmtTime(job.start_time)}</span>`}</div>
      ${rows.length ? html`<div class="list" style="box-shadow:none">${rows.map((r) => html`<button class="li" key=${r.uid} onClick=${() => boss && r.shift && setSheet({ shift: r.shift })}>
        <${Avatar} id=${r.uid} size=${32} /><span class="grow"><strong>${person(r.uid)?.full_name || "—"}</strong>
        <span class="small">${r.start ? fmtTime(r.start) : "Time TBD"}${r.end ? " – " + fmtTime(r.end) : ""}${!r.shift ? " · on crew" : ""}</span></span>
        ${onSiteAt(job.id).includes(r.uid) && day === today() && html`<span class="tag" style="color:var(--done)">On site</span>`}</button>`)}</div>`
        : html`<p class="small muted" style="margin:4px 0 0">Nobody scheduled.</p>`}
    </div>`)
    : !dayEvents.length && html`<${Empty} icon=${I.calendar} title=${scope === "mine" ? "Nothing scheduled for you" : "Nothing scheduled"} text=${boss ? "Use “Schedule crew” to put people on a job, or “Event” for a reminder like “Call contractor.”" : "Tap “Event” to add a reminder for yourself."} />`}
    ${sheet && html`<${ShiftSheet} ...${sheet} onClose=${() => setSheet(null)} onSaved=${reload} />`}
    ${evSheet && html`<${EventSheet} ...${evSheet} onClose=${() => setEvSheet(null)} onSaved=${reload} />`}
  </main>`;
}

// ------------------------------------------------------------- events
export const EV_COLORS = [
  ["orange", "#ef4a2b"], ["blue", "#3f6c99"], ["green", "#2f8a4f"], ["purple", "#7b4fc4"], ["yellow", "#c78a00"], ["gray", "#6b7480"],
];
export const URGENCY = {
  low: { label: "Low", rank: 0 },
  normal: { label: "Normal", rank: 1 },
  high: { label: "High", rank: 2 },
  urgent: { label: "Urgent", rank: 3 },
};
const evColor = (e) => (EV_COLORS.find(([k]) => k === e.color) || EV_COLORS[0])[1];

function EventCard({ ev, onOpen }) {
  const job = ev.job_id && jobById(ev.job_id);
  const done = !!ev.done;
  return html`<button class="evcard ${done ? "done" : ""} u-${ev.urgency}" style=${`--ec:${evColor(ev)}`} onClick=${onOpen}>
    <span class="evtime">${ev.start_time ? fmtTime(ev.start_time) : "All day"}${ev.end_time ? html`<small>${fmtTime(ev.end_time)}</small>` : ""}</span>
    <span class="grow">
      <strong>${ev.title}</strong>
      ${ev.notes && html`<span class="evnotes">${ev.notes}</span>`}
      <span class="evmeta">
        ${ev.urgency !== "normal" && html`<span class="urg u-${ev.urgency}">${URGENCY[ev.urgency]?.label}</span>`}
        ${job && html`<span>${job.title}</span>`}
        ${ev.private ? html`<span>Only me</span>` : html`<span>by ${firstName(person(ev.created_by))}</span>`}
        ${(ev.assignees || []).length > 0 && html`<${AvatarStack} ids=${ev.assignees} max=${3} size=${20} />`}
      </span>
    </span>
    ${done && html`<span class="tag" style="color:var(--done)">Done</span>`}
  </button>`;
}

function EventSheet({ date, ev, onClose, onSaved }) {
  const s = useStore();
  const isNew = !ev;
  const canEdit = isNew || ev.created_by === s.me.id || isBoss();
  const [f, setF] = useState(() => ({
    title: ev?.title || "", notes: ev?.notes || "", event_date: ev?.event_date || date || today(),
    allDay: ev ? !ev.start_time : false, start: (ev?.start_time || "09:00").slice(0, 5), end: (ev?.end_time || "").slice(0, 5),
    color: ev?.color || "orange", urgency: ev?.urgency || "normal", job_id: ev?.job_id || "", private: ev?.private ?? false,
    assignees: ev?.assignees || [], done: !!ev?.done,
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  async function save() {
    if (!f.title.trim()) return toast("Give the event a name", "error");
    if (!f.allDay && f.end && f.end <= f.start) return toast("End time must be after the start time", "error");
    const row = {
      title: f.title.trim(), notes: f.notes.trim() || null, event_date: f.event_date,
      start_time: f.allDay ? null : f.start, end_time: f.allDay || !f.end ? null : f.end,
      color: f.color, urgency: f.urgency, job_id: f.job_id || null, private: f.private,
      assignees: f.private ? [] : f.assignees, done: f.done,
    };
    const ok = await act(() => (isNew ? api.insert("events", { ...row, created_by: s.me.id }) : api.update("events", { id: ev.id }, row)), isNew ? "Event added" : "Saved");
    if (ok) { onSaved(); onClose(); }
  }

  if (!canEdit) {
    return html`<${Sheet} title="Event" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Close</button>`}>
      <div class="row" style="margin-bottom:6px"><span class="jobdot" style=${`--c:${evColor(ev)}`}></span><h2>${ev.title}</h2></div>
      <p class="muted">${fmtDate(ev.event_date, { weekday: "long", month: "long", day: "numeric" })} · ${ev.start_time ? fmtTime(ev.start_time) + (ev.end_time ? " – " + fmtTime(ev.end_time) : "") : "All day"}</p>
      ${ev.urgency !== "normal" && html`<p><span class="urg u-${ev.urgency}">${URGENCY[ev.urgency]?.label}</span></p>`}
      ${ev.notes && html`<p style="white-space:pre-wrap">${ev.notes}</p>`}
      <p class="small muted">Added by ${person(ev.created_by)?.full_name || "someone"}</p>
    </${Sheet}>`;
  }

  return html`<${Sheet} title=${isNew ? "New event" : "Edit event"} onClose=${onClose}
    footer=${html`${!isNew && html`<button class="icon-btn" onClick=${() => setConfirmDel(true)} aria-label="Delete event">${I.trash}</button>`}
      <button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" onClick=${save}>${isNew ? "Add event" : "Save"}</button>`}>
    <${Field} label="What"><input type="text" value=${f.title} maxlength="80" onInput=${(e) => set("title", e.target.value)} placeholder="e.g. Call contractor" /></${Field}>
    <${Field} label="Date"><input type="date" value=${f.event_date} onInput=${(e) => set("event_date", e.target.value)} /></${Field}>
    <label class="switch" style="margin:-4px 0 12px"><input type="checkbox" checked=${f.allDay} onChange=${(e) => set("allDay", e.target.checked)} /> All day</label>
    ${!f.allDay && html`<div class="two">
      <${Field} label="Start"><input type="time" value=${f.start} onInput=${(e) => set("start", e.target.value)} /></${Field}>
      <${Field} label="End (optional)"><input type="time" value=${f.end} onInput=${(e) => set("end", e.target.value)} /></${Field}>
    </div>`}
    <${Field} label="Urgency"><div class="seg">${Object.entries(URGENCY).map(([k, v]) => html`<button type="button" key=${k} class="${f.urgency === k ? "on" : ""} useg-${k}" onClick=${() => set("urgency", k)}>${v.label}</button>`)}</div></${Field}>
    <${Field} label="Color"><div class="swatches">${EV_COLORS.map(([k, c]) => html`<button type="button" key=${k} class="swatch ${f.color === k ? "on" : ""}" style=${`--sw:${c}`} aria-label=${k} onClick=${() => set("color", k)}>${f.color === k ? I.check : ""}</button>`)}</div></${Field}>
    <${Field} label="Notes (optional)"><textarea rows="3" value=${f.notes} onInput=${(e) => set("notes", e.target.value)} placeholder="Phone number, what to ask, materials…"></textarea></${Field}>
    <${Field} label="Related job (optional)"><select value=${f.job_id} onChange=${(e) => set("job_id", e.target.value)}>
      <option value="">None</option>
      ${s.jobs.filter((j) => j.status !== "done" || j.id === f.job_id).map((j) => html`<option key=${j.id} value=${j.id}>${j.title}</option>`)}</select></${Field}>
    <${Field} label="Who sees this"><div class="seg">
      <button type="button" class=${f.private ? "on" : ""} onClick=${() => set("private", true)}>Only me</button>
      <button type="button" class=${!f.private ? "on" : ""} onClick=${() => set("private", false)}>Everyone</button></div></${Field}>
    ${!f.private && html`<${Field} label="Assign to (optional)" hint="Assigned people see it under My schedule."><${PeoplePicker} value=${f.assignees} onChange=${(v) => set("assignees", v)} /></${Field}>`}
    ${!isNew && html`<label class="switch"><input type="checkbox" checked=${f.done} onChange=${(e) => set("done", e.target.checked)} /> Mark as done</label>`}
    ${confirmDel && html`<${Confirm} title="Delete this event?" text=${`“${ev.title}” will be removed.`} onClose=${() => setConfirmDel(false)}
      onOk=${async () => { if (await act(() => api.remove("events", { id: ev.id }), "Event deleted")) { onSaved(); onClose(); } }} />`}
  </${Sheet}>`;
}

function ShiftSheet({ date, shift, onClose, onSaved }) {
  const s = useStore();
  const isNew = !shift;
  const firstJob = s.jobs.find((j) => j.status !== "done");
  const [f, setF] = useState(() => ({
    job_id: shift?.job_id || firstJob?.id || "", who: shift ? [shift.user_id] : [], from: shift?.work_date || date || today(), to: shift?.work_date || date || today(),
    start: (shift?.start_time || firstJob?.start_time || "08:00").slice(0, 5), end: (shift?.end_time || "16:30").slice(0, 5),
    weekdaysOnly: ![0, 6].includes(parseDate(date || today()).getDay()),
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  useEffect(() => { if (isNew) { const j = jobById(f.job_id); if (j?.start_time) set("start", j.start_time.slice(0, 5)); } }, [f.job_id]);

  async function save() {
    if (!f.job_id) return toast("Pick a job", "error");
    if (isNew && !f.who.length) return toast("Pick at least one person", "error");
    const ok = await act(async () => {
      if (!isNew) return api.update("shifts", { id: shift.id }, { job_id: f.job_id, work_date: f.from, start_time: f.start || null, end_time: f.end || null });
      const rows = [];
      for (let d = parseDate(f.from); isoDate(d) <= f.to; d = addDays(d, 1)) {
        if (f.weekdaysOnly && [0, 6].includes(d.getDay())) continue;
        for (const user_id of f.who) rows.push({ job_id: f.job_id, user_id, work_date: isoDate(d), start_time: f.start || null, end_time: f.end || null, created_by: s.me.id });
      }
      if (!rows.length) throw new Error("Those dates are all on a weekend. Turn off “Skip weekends” to schedule them.");
      await api.insert("shifts", rows);
      const crew = s.members.filter((m) => m.job_id === f.job_id).map((m) => m.user_id);
      const add = f.who.filter((u) => !crew.includes(u));
      if (add.length) await api.insert("job_members", add.map((user_id) => ({ job_id: f.job_id, user_id, status: "approved", added_by: s.me.id })));
    }, isNew ? "Scheduled" : "Saved");
    if (ok) { onSaved(); onClose(); }
  }

  return html`<${Sheet} title=${isNew ? "Schedule crew" : "Edit shift"} onClose=${onClose}
    footer=${html`${!isNew && html`<button class="icon-btn" onClick=${() => setConfirmDel(true)} aria-label="Delete shift">${I.trash}</button>`}
      <button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" onClick=${save}>${isNew ? "Schedule" : "Save"}</button>`}>
    <${Field} label="Job"><select value=${f.job_id} onChange=${(e) => set("job_id", e.target.value)}>
      ${s.jobs.filter((j) => j.status !== "done").map((j) => html`<option key=${j.id} value=${j.id}>${j.title}</option>`)}</select></${Field}>
    ${isNew ? html`<div class="two">
        <${Field} label="From"><input type="date" value=${f.from} onInput=${(e) => setF({ ...f, from: e.target.value, to: e.target.value > f.to ? e.target.value : f.to })} /></${Field}>
        <${Field} label="To"><input type="date" value=${f.to} min=${f.from} onInput=${(e) => set("to", e.target.value)} /></${Field}>
      </div>
      <label class="switch" style="margin:-4px 0 12px"><input type="checkbox" checked=${f.weekdaysOnly} onChange=${(e) => set("weekdaysOnly", e.target.checked)} /> Skip weekends</label>`
      : html`<${Field} label="Date"><input type="date" value=${f.from} onInput=${(e) => set("from", e.target.value)} /></${Field}>`}
    <div class="two">
      <${Field} label="Start"><input type="time" value=${f.start} onInput=${(e) => set("start", e.target.value)} /></${Field}>
      <${Field} label="End"><input type="time" value=${f.end} onInput=${(e) => set("end", e.target.value)} /></${Field}>
    </div>
    ${isNew ? html`<${Field} label="Who"><${PeoplePicker} value=${f.who} onChange=${(v) => set("who", v)} /></${Field}>`
      : html`<p><strong>${person(shift.user_id)?.full_name}</strong></p>`}
    ${confirmDel && html`<${Confirm} title="Remove this shift?" text="They'll come off the schedule for this day." onClose=${() => setConfirmDel(false)}
      onOk=${async () => { if (await act(() => api.remove("shifts", { id: shift.id }), "Shift removed")) { onSaved(); onClose(); } }} />`}
  </${Sheet}>`;
}

// ==================================================================== TEAM
export function TeamPage() {
  const s = useStore();
  const boss = isBoss();
  const [invites, setInvites] = useState([]);
  const [sheet, setSheet] = useState(null);
  const loadInvites = async () => { if (boss) try { setInvites(await api.list("invites", { order: ["created_at", false] })); } catch (_) { /* ignore */ } };
  useEffect(() => { loadInvites(); }, [s.profiles]);

  const pending = s.profiles.filter((p) => p.status === "pending");
  const active = s.profiles.filter((p) => p.status === "active");
  const off = s.profiles.filter((p) => p.status === "disabled");
  const where = (uid) => { const l = s.openLogs.find((x) => x.user_id === uid); return l && jobById(l.job_id); };

  const row = (p) => {
    const at = where(p.id);
    return html`<button class="li" key=${p.id} onClick=${() => setSheet({ person: p })}>
      <${Avatar} id=${p.id} size=${42} />
      <span class="grow"><strong>${p.full_name}${p.id === s.me.id ? " (you)" : ""}</strong>
        <span class="small">${at ? html`<span style="color:var(--done);font-weight:700">● At ${at.title}</span>` : p.role === "boss" ? "Boss" : "Crew"}</span></span>
      ${p.role === "boss" && html`<span class="tag accent">Boss</span>`}
    </button>`;
  };

  return html`<main class="page">
    <div class="page-head"><h1>Team</h1>${boss && html`<button class="btn sm" onClick=${() => setSheet({ invite: true })}>${I.plus} Add person</button>`}</div>
    ${boss && pending.length > 0 && html`<div class="section-title"><h3>Waiting for approval · ${pending.length}</h3></div>
      <div class="list" style="margin-bottom:20px">${pending.map((p) => html`<div class="li" key=${p.id}><${Avatar} id=${p.id} size=${40} />
        <span class="grow"><strong>${p.full_name}</strong><span class="small">${p.email}</span></span>
        <button class="btn sm ghost" onClick=${() => act(() => api.update("profiles", { id: p.id }, { status: "disabled" }), "Declined")}>Decline</button>
        <button class="btn sm" onClick=${() => act(() => api.update("profiles", { id: p.id }, { status: "active" }), `${firstName(p)} approved`)}>Approve</button>
      </div>`)}</div>`}
    <div class="list">${active.map(row)}</div>
    ${boss && invites.length > 0 && html`<div class="section-title" style="margin-top:22px"><h3>Invited · not signed up yet</h3></div>
      <div class="list">${invites.map((v) => html`<div class="li" key=${v.email}><span class="avatar" style="width:40px;height:40px;background:var(--muted)">${I.send}</span>
        <span class="grow"><strong>${v.full_name || v.email}</strong><span class="small">${v.email} · ${v.role === "boss" ? "Boss" : "Crew"}</span></span>
        <button class="icon-btn" aria-label="Cancel invite" onClick=${() => act(() => api.remove("invites", { email: v.email }), "Invite cancelled").then(loadInvites)}>${I.x}</button></div>`)}</div>`}
    ${boss && off.length > 0 && html`<div class="section-title" style="margin-top:22px"><h3>Turned off</h3></div><div class="list">${off.map(row)}</div>`}
    ${sheet?.invite && html`<${InviteSheet} onClose=${() => setSheet(null)} onSaved=${loadInvites} />`}
    ${sheet?.person && html`<${PersonSheet} p=${sheet.person} onClose=${() => setSheet(null)} />`}
  </main>`;
}

function appLink() { return location.origin + location.pathname; }
async function shareLink(name) {
  const text = `${name ? name + ", you" : "You"}'re invited to the ${CONFIG.COMPANY_NAME} crew app. Sign up with your email here:`;
  const url = appLink();
  if (navigator.share) { try { await navigator.share({ title: CONFIG.APP_NAME, text, url }); return; } catch (_) { /* cancelled */ } }
  await navigator.clipboard?.writeText(`${text} ${url}`);
  toast("Invite link copied — paste it in a text");
}

function InviteSheet({ onClose, onSaved }) {
  const s = useStore();
  const [f, setF] = useState({ full_name: "", email: "", role: "employee" });
  const [done, setDone] = useState(false);
  async function save() {
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) return toast("Enter a valid email", "error");
    const ok = await act(() => api.insert("invites", { full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), role: f.role, created_by: s.me.id }));
    if (ok) { onSaved(); setDone(true); }
  }
  if (done) return html`<${Sheet} title="Almost done" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Done</button><button class="btn" onClick=${() => shareLink(f.full_name)}>${I.share} Send link</button>`}>
    <p><strong>${f.full_name || f.email}</strong> is pre-approved. Send them the app link — when they sign up with <strong>${f.email}</strong> they'll get in right away as ${f.role === "boss" ? "a Boss" : "crew"}.</p>
    <div class="card small" style="word-break:break-all">${appLink()}</div></${Sheet}>`;
  return html`<${Sheet} title="Add a person" onClose=${onClose} footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" onClick=${save}>Add</button>`}>
    <${Field} label="Name"><input type="text" value=${f.full_name} onInput=${(e) => setF({ ...f, full_name: e.target.value })} /></${Field}>
    <${Field} label="Email" hint="They'll sign up with this email."><input type="email" value=${f.email} onInput=${(e) => setF({ ...f, email: e.target.value })} /></${Field}>
    <${Field} label="Role"><div class="seg">
      <button type="button" class=${f.role === "employee" ? "on" : ""} onClick=${() => setF({ ...f, role: "employee" })}>Employee</button>
      <button type="button" class=${f.role === "boss" ? "on" : ""} onClick=${() => setF({ ...f, role: "boss" })}>Boss</button></div></${Field}>
    <p class="small muted">Bosses can create jobs, assign work, schedule crew and manage people. Employees see jobs, clock in and out, add notes and photos.</p>
  </${Sheet}>`;
}

function PersonSheet({ p, onClose }) {
  const s = useStore();
  const boss = isBoss();
  const self = p.id === s.me.id;
  const [f, setF] = useState({ role: p.role, status: p.status, phone: p.phone || "" });
  const jobs = s.members.filter((m) => m.user_id === p.id && m.status === "approved").map((m) => jobById(m.job_id)).filter((j) => j && j.status !== "done");
  async function save() {
    if (self && f.role !== "boss" && s.profiles.filter((x) => x.role === "boss" && x.status === "active").length < 2) return toast("You're the only boss — add another boss first", "error");
    if (await act(() => api.update("profiles", { id: p.id }, { role: f.role, status: f.status, phone: f.phone.trim() || null }), "Saved")) onClose();
  }
  return html`<${Sheet} title=${p.full_name} onClose=${onClose}
    footer=${boss ? html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" onClick=${save}>Save</button>` : html`<button class="btn ghost" onClick=${onClose}>Close</button>`}>
    <div class="row" style="margin-bottom:16px"><${Avatar} id=${p.id} size=${56} /><div class="grow"><strong>${p.full_name}</strong><div class="small muted">${p.email || ""}</div></div></div>
    ${p.phone && html`<div class="row" style="margin-bottom:16px"><a class="btn grow" href=${"tel:" + p.phone}>${I.phone} Call</a><a class="btn ghost grow" href=${"sms:" + p.phone}>Text</a></div>`}
    ${jobs.length > 0 && html`<${Field} label="On these jobs"><div class="list">${jobs.map((j) => html`<a class="li" key=${j.id} href=${"#/job/" + j.id} style="color:inherit;text-decoration:none" onClick=${onClose}>
      <span class="jobdot" style=${`--c:${jobColor(j.id)}`}></span><span class="grow"><strong>${j.title}</strong></span>${I.chevR}</a>`)}</div></${Field}>`}
    ${boss && html`
      <${Field} label="Phone"><input type="tel" value=${f.phone} onInput=${(e) => setF({ ...f, phone: e.target.value })} /></${Field}>
      <${Field} label="Role"><div class="seg">
        <button type="button" class=${f.role === "employee" ? "on" : ""} onClick=${() => setF({ ...f, role: "employee" })}>Employee</button>
        <button type="button" class=${f.role === "boss" ? "on" : ""} onClick=${() => setF({ ...f, role: "boss" })}>Boss</button></div></${Field}>
      ${!self && html`<label class="switch"><input type="checkbox" checked=${f.status === "active"} onChange=${(e) => setF({ ...f, status: e.target.checked ? "active" : "disabled" })} />
        <span><strong>Account on</strong><br /><span class="small muted">Turn off when someone leaves the company. Their history is kept.</span></span></label>`}`}
  </${Sheet}>`;
}

// ================================================================== ALERTS
export function AlertsPage() {
  const s = useStore();
  const boss = isBoss();
  const [compose, setCompose] = useState(false);
  const [scope, setScope] = useState("mine");
  const seen = useRef(s.seenAlertsAt);
  useEffect(() => {
    const now = new Date().toISOString();
    try { localStorage.setItem("seenAlertsAt", now); } catch (_) { /* ignore */ }
    setS({ seenAlertsAt: now });
  }, []);
  const list = s.notifications.filter((n) => scope === "all" || n.recipients.includes(s.me.id));
  return html`<main class="page">
    <div class="page-head"><h1>Alerts</h1>${boss && html`<button class="btn sm" onClick=${() => setCompose(true)}>${I.send} Send alert</button>`}</div>
    ${boss && html`<div class="seg" style="margin-bottom:14px">
      <button class=${scope === "mine" ? "on" : ""} onClick=${() => setScope("mine")}>For me</button>
      <button class=${scope === "all" ? "on" : ""} onClick=${() => setScope("all")}>Everything sent</button></div>`}
    ${list.length ? html`<div class="list">${list.map((n) => html`<a class="notif ${n.created_at > (seen.current || "") ? "unread" : ""}" key=${n.id}
        href=${n.job_id ? "#/job/" + n.job_id : "#/alerts"} style="color:inherit;text-decoration:none">
      <span class="ic ${n.kind === "reminder" ? "rem" : ""}">${n.kind === "reminder" ? I.clock : I.bell}</span>
      <span class="grow"><strong>${n.title}</strong>${n.body && html`<div class="small" style="color:var(--ink-2)">${n.body}</div>`}
        <div class="small muted">${ago(n.created_at)}${n.created_by ? ` · from ${firstName(person(n.created_by))}` : n.kind === "reminder" ? " · automatic reminder" : ""}${scope === "all" ? ` · to ${n.recipients.length}` : ""}</div></span>
    </a>`)}</div>` : html`<${Empty} icon=${I.bell} title="No alerts yet" text="Job reminders and messages from the boss show up here." />`}
    ${compose && html`<${ComposeSheet} onClose=${() => setCompose(false)} />`}
  </main>`;
}

const TEMPLATES = [
  ["Rain delay", "Rain delay — stand by for an update before heading out."],
  ["Start pushed", "Start time pushed back 1 hour today."],
  ["Safety meeting", "Quick safety meeting on site at start time. Don't be late."],
  ["Inspection", "Inspector coming today — make sure the site is clean."],
];

export function ComposeSheet({ preset = {}, onClose }) {
  const s = useStore();
  const [f, setF] = useState({ title: "", body: "", target: preset.target || "all", job_id: preset.job_id || s.jobs.find((j) => j.status !== "done")?.id || "", who: [] });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  async function send() {
    if (!f.title.trim()) return toast("Add a title", "error");
    if (f.target === "users" && !f.who.length) return toast("Pick who gets it", "error");
    setBusy(true);
    try {
      const r = await api.sendPush({ title: f.title.trim(), body: f.body.trim(), target: f.target, job_id: f.target === "job" ? f.job_id : null, user_ids: f.who },
        s.me.id, activePeople().map((p) => p.id));
      await loadAll();
      toast(`Sent to ${r.recipients} ${r.recipients === 1 ? "person" : "people"}`);
      onClose();
    } catch (e) { toast(friendlyError(e), "error"); }
    setBusy(false);
  }
  return html`<${Sheet} title="Send an alert" onClose=${onClose}
    footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" disabled=${busy} onClick=${send}>${I.send} ${busy ? "Sending…" : "Send now"}</button>`}>
    <${Field} label="Send to"><div class="seg">
      <button type="button" class=${f.target === "all" ? "on" : ""} onClick=${() => set("target", "all")}>Everyone</button>
      <button type="button" class=${f.target === "job" ? "on" : ""} onClick=${() => set("target", "job")}>A job's crew</button>
      <button type="button" class=${f.target === "users" ? "on" : ""} onClick=${() => set("target", "users")}>Pick people</button></div></${Field}>
    ${f.target === "job" && html`<${Field} label="Job"><select value=${f.job_id} onChange=${(e) => set("job_id", e.target.value)}>
      ${s.jobs.filter((j) => j.status !== "done").map((j) => html`<option key=${j.id} value=${j.id}>${j.title}</option>`)}</select></${Field}>`}
    ${f.target === "users" && html`<${Field} label="People"><${PeoplePicker} value=${f.who} onChange=${(v) => set("who", v)} /></${Field}>`}
    <div class="chips" style="margin-bottom:10px">${TEMPLATES.map(([t, b]) => html`<button type="button" key=${t} class="chip" onClick=${() => setF({ ...f, title: t, body: b })}>${t}</button>`)}</div>
    <${Field} label="Title"><input type="text" maxlength="60" value=${f.title} onInput=${(e) => set("title", e.target.value)} placeholder="Short headline" /></${Field}>
    <${Field} label="Message"><textarea rows="3" maxlength="240" value=${f.body} onInput=${(e) => set("body", e.target.value)} placeholder="Details (optional)"></textarea></${Field}>
  </${Sheet}>`;
}

// ============================================================ PUSH BANNER
export function PushBanner() {
  const s = useStore();
  const [st, setSt] = useState(null);
  const [hide, setHide] = useState(() => { try { return localStorage.getItem("hidePushBanner") === "1"; } catch (_) { return false; } });
  useEffect(() => { api.pushStatus().then(setSt).catch(() => {}); }, []);
  if (!st || hide || st.subscribed || (!st.supported && !st.needsInstall) || st.permission === "denied") return null;
  const dismiss = () => { setHide(true); try { localStorage.setItem("hidePushBanner", "1"); } catch (_) { /* ignore */ } };
  return html`<div class="banner">
    <span style="color:var(--accent)">${I.bell}</span>
    <div class="grow"><strong>${st.needsInstall ? "Add this app to your Home Screen" : "Turn on job reminders"}</strong>
      <p>${st.needsInstall ? "On iPhone, tap the Share button, then “Add to Home Screen.” Open the app from there to get reminders." : "Get a heads-up before each job starts, with the address."}</p>
      ${!st.needsInstall && html`<button class="btn sm" style="margin-top:8px" onClick=${async () => {
        try { await api.enablePush(s.me.id); toast("Reminders are on"); setSt({ ...st, subscribed: true }); } catch (e) { toast(e.message, "error"); }
      }}>Turn on</button>`}
    </div>
    <button class="icon-btn" onClick=${dismiss} aria-label="Dismiss">${I.x}</button>
  </div>`;
}

// ====================================================================== ME
const TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export function MePage() {
  const s = useStore();
  const boss = isBoss();
  const [f, setF] = useState({ full_name: s.me.full_name, phone: s.me.phone || "" });
  const [push, setPush] = useState(null);
  const [pw, setPw] = useState("");
  useEffect(() => { api.pushStatus().then(setPush).catch(() => setPush({ supported: false })); }, []);

  async function enable() {
    try { await api.enablePush(s.me.id); setPush(await api.pushStatus()); toast("Notifications are on"); } catch (e) { toast(e.message, "error"); }
  }
  async function test() {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) return toast("Open the installed app to test", "error");
    reg.showNotification("Test notification", { body: "If you can see this, notifications work on this phone 👍", icon: "icons/icon-192.png" });
  }
  const setSetting = (key, value) => act(() => api.update("settings", { key }, { value: String(value) }), "Setting saved");

  return html`<main class="page">
    <div class="page-head"><h1>Me</h1></div>
    <div class="card">
      <div class="row" style="margin-bottom:14px"><${Avatar} id=${s.me.id} size=${54} />
        <div class="grow"><strong style="font-size:19px">${s.me.full_name}</strong><div class="small muted">${s.me.email} · ${boss ? "Boss" : "Crew"}</div></div></div>
      <${Field} label="Your name"><input type="text" value=${f.full_name} onInput=${(e) => setF({ ...f, full_name: e.target.value })} /></${Field}>
      <${Field} label="Phone" hint="Lets your crew tap to call you."><input type="tel" value=${f.phone} onInput=${(e) => setF({ ...f, phone: e.target.value })} /></${Field}>
      <button class="btn block" disabled=${f.full_name === s.me.full_name && f.phone === (s.me.phone || "")}
        onClick=${() => act(() => api.update("profiles", { id: s.me.id }, { full_name: f.full_name.trim(), phone: f.phone.trim() || null }), "Profile saved")}>Save profile</button>
    </div>

    <div class="card">
      <h3 style="margin-bottom:10px">Notifications</h3>
      ${!push ? html`<div class="spinner"></div>`
        : push.needsInstall ? html`<p><strong>Install the app first.</strong> iPhones only allow notifications from apps on the Home Screen.</p>
            <ol class="steps"><li>Open this page in <strong>Safari</strong>.</li><li>Tap the <strong>Share</strong> button ${I.share}.</li><li>Tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li><li>Open the app from your Home Screen and come back here.</li></ol>`
        : !push.supported ? html`<p class="muted">This browser can't show notifications. Use Chrome on Android or Safari on iPhone (installed to the Home Screen).</p>`
        : push.permission === "denied" ? html`<p>Notifications are blocked for this app. Turn them on in your phone's <strong>Settings → Notifications</strong>, then reopen the app.</p>`
        : push.subscribed ? html`<p style="color:var(--done);font-weight:700">● Notifications are on for this device.</p>
            <p class="small muted">You'll get a reminder ${s.settings.reminder_minutes || 30} minutes before your jobs start, plus messages from the boss.</p>
            <button class="btn ghost block" onClick=${test}>Send a test to this phone</button>`
        : html`<p>Get a reminder with the address before each job starts, and messages from the boss.</p><button class="btn block" onClick=${enable}>${I.bell} Turn on notifications</button>`}
    </div>

    ${boss && html`<div class="card">
      <h3 style="margin-bottom:12px">Company settings</h3>
      <${Field} label="Job reminder" hint="Sent to everyone on the crew (and the boss who created the job).">
        <select value=${s.settings.reminder_minutes || "30"} onChange=${(e) => setSetting("reminder_minutes", e.target.value)}>
          ${[15, 30, 45, 60, 90, 120].map((m) => html`<option key=${m} value=${String(m)}>${m < 60 ? m + " minutes" : m / 60 + (m === 60 ? " hour" : " hours")} before start</option>`)}
        </select></${Field}>
      <label class="switch" style="margin-bottom:14px"><input type="checkbox" checked=${s.settings.join_requires_approval === "true"} onChange=${(e) => setSetting("join_requires_approval", e.target.checked)} />
        <span><strong>Approve job requests</strong><br /><span class="small muted">When on, employees ask to join a job and a boss approves.</span></span></label>
      <${Field} label="Time zone"><select value=${s.settings.timezone || "America/New_York"} onChange=${(e) => setSetting("timezone", e.target.value)}>
        ${TIMEZONES.map((t) => html`<option key=${t} value=${t}>${t.split("/")[1].replace("_", " ")}</option>`)}</select></${Field}>
    </div>`}

    <div class="card">
      <h3 style="margin-bottom:8px">Install on your phone</h3>
      <p class="small"><strong>iPhone:</strong> in Safari tap Share ${I.share} → Add to Home Screen.<br /><strong>Android:</strong> in Chrome tap ⋮ → Add to Home screen (or Install app).</p>
      ${boss && html`<button class="btn ghost block" onClick=${() => shareLink("")}>${I.share} Share app link with crew</button>`}
    </div>

    ${!api.DEMO && html`<div class="card">
      <h3 style="margin-bottom:10px">Change password</h3>
      <div class="row"><input type="password" placeholder="New password (8+ characters)" value=${pw} onInput=${(e) => setPw(e.target.value)} autocomplete="new-password" />
        <button class="btn" disabled=${pw.length < 8} onClick=${async () => { try { await api.auth.updatePassword(pw); setPw(""); toast("Password updated"); } catch (e) { toast(friendlyError(e), "error"); } }}>Save</button></div>
    </div>`}

    ${api.DEMO && html`<div class="card">
      <h3 style="margin-bottom:10px">Demo controls</h3>
      <div class="stack-v">
        <button class="btn block" onClick=${async () => { api.auth.demoSignIn(boss ? "employee" : "boss"); setS({ session: await api.auth.session() }); await loadAll(); go("/"); }}>Switch to ${boss ? "Employee" : "Boss"} view</button>
        <button class="btn ghost block" onClick=${async () => { api.demoReset(); api.auth.demoSignIn(boss ? "boss" : "employee"); setS({ session: await api.auth.session() }); await loadAll(); go("/"); toast("Demo data reset"); }}>Reset sample data</button>
      </div>
    </div>`}

    <button class="btn ghost block" style="margin-top:16px" onClick=${async () => { await api.auth.signOut(); setS({ session: null, me: null }); go("/"); }}>Sign out</button>
    <p class="small muted" style="text-align:center;margin-top:18px">${CONFIG.APP_NAME} for ${CONFIG.COMPANY_NAME}</p>
  </main>`;
}
