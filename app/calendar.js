// Schedule: a Google Calendar-style view with Day, Week, Month and 3 Month layouts.
import * as api from "./api.js";
import {
  html, useState, useEffect, useRef, useMemo,
  useStore, isBoss, person, jobById, jobColor, crewOf, onSiteAt, go, today, isoDate, addDays, parseDate,
  fmtDate, fmtTime, firstName, I, Avatar, Empty,
} from "./lib.js";
import { EventSheet, ShiftSheet, EventCard, evColor, URGENCY } from "./screens.js";

const VIEWS = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["3month", "3 Month"]];
const HOUR_PX = 48;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------- dates
const sundayOf = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - x.getDay()); return x; };
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d, n) => new Date(d.getFullYear(), d.getMonth() + n, 1);
const range = (a, n) => [...Array(n)].map((_, i) => isoDate(addDays(a, i)));
const mins = (t) => { if (!t) return null; const [h, m] = t.split(":").map(Number); return h * 60 + (m || 0); };
const dayDiff = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const isoDow = (date) => ((parseDate(date).getDay() + 6) % 7) + 1; // 1 = Mon … 7 = Sun

// Visible dates for a view anchored on `anchor` (ISO date string).
function viewRange(view, anchor) {
  const a = parseDate(anchor);
  if (view === "day") return { start: anchor, end: anchor };
  if (view === "week") { const s = sundayOf(a); return { start: isoDate(s), end: isoDate(addDays(s, 6)) }; }
  const months = view === "3month" ? 3 : 1;
  const first = monthStart(a);
  const gridStart = sundayOf(first);
  const last = addDays(addMonths(first, months), -1);
  const gridEnd = addDays(sundayOf(last), 6);
  return { start: isoDate(gridStart), end: isoDate(gridEnd), first, months };
}
function step(view, anchor, dir) {
  const a = parseDate(anchor);
  if (view === "day") return isoDate(addDays(a, dir));
  if (view === "week") return isoDate(addDays(a, 7 * dir));
  return isoDate(addMonths(a, (view === "3month" ? 3 : 1) * dir));
}
function title(view, anchor) {
  const a = parseDate(anchor);
  if (view === "day") return a.toLocaleDateString(undefined, { weekday: innerWidth < 560 ? "short" : "long", month: innerWidth < 560 ? "short" : "long", day: "numeric", year: "numeric" });
  if (view === "week") {
    const s = sundayOf(a), e = addDays(s, 6);
    const same = s.getMonth() === e.getMonth();
    return same ? `${s.toLocaleDateString(undefined, { month: "long" })} ${s.getDate()} – ${e.getDate()}, ${e.getFullYear()}`
      : `${s.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${e.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }
  if (view === "month") return a.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const f = monthStart(a), l = addMonths(f, 2);
  return `${f.toLocaleDateString(undefined, { month: "short" })} – ${l.toLocaleDateString(undefined, { month: "short", year: "numeric" })}`;
}

// Give each multi-day bar a row ("lane") so bars in the same week never overlap.
function lanes(spans, from, to) {
  const clipped = spans
    .filter((s) => s.start <= to && s.end >= from)
    .map((s) => ({ ...s, cs: s.start < from ? from : s.start, ce: s.end > to ? to : s.end }))
    .sort((a, b) => a.cs.localeCompare(b.cs) || dayDiff(b.cs, b.ce) - dayDiff(a.cs, a.ce));
  const laneEnds = [];
  for (const s of clipped) {
    let lane = laneEnds.findIndex((end) => end < s.cs);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(s.ce); } else laneEnds[lane] = s.ce;
    s.lane = lane;
  }
  return clipped;
}

// Side-by-side columns for overlapping timed blocks in one day.
function layoutTimed(items) {
  const sorted = [...items].sort((a, b) => a.s - b.s || b.e - a.e);
  const groups = []; let cur = [], curEnd = -1;
  for (const it of sorted) {
    if (cur.length && it.s >= curEnd) { groups.push(cur); cur = []; curEnd = -1; }
    cur.push(it); curEnd = Math.max(curEnd, it.e);
  }
  if (cur.length) groups.push(cur);
  for (const g of groups) {
    const cols = [];
    for (const it of g) {
      let c = cols.findIndex((end) => end <= it.s);
      if (c === -1) { c = cols.length; cols.push(it.e); } else cols[c] = it.e;
      it.col = c;
    }
    g.forEach((it) => { it.cols = cols.length; });
  }
  return sorted;
}

// ================================================================ PAGE
export function SchedulePage() {
  const s = useStore();
  const boss = isBoss();
  const [view, setView] = useState(() => { try { return localStorage.getItem("calView") || "month"; } catch (_) { return "month"; } });
  const [anchor, setAnchor] = useState(today());
  const [scope, setScope] = useState(() => { try { return localStorage.getItem("calScope") || (boss ? "all" : "mine"); } catch (_) { return boss ? "all" : "mine"; } });
  const [shifts, setShifts] = useState([]);
  const [events, setEvents] = useState([]);
  const [sheet, setSheet] = useState(null);
  const [evSheet, setEvSheet] = useState(null);
  useEffect(() => { try { localStorage.setItem("calView", view); localStorage.setItem("calScope", scope); } catch (_) { /* ignore */ } }, [view, scope]);

  const r = viewRange(view, anchor);
  async function reload() {
    try { setShifts(await api.list("shifts", { gte: { work_date: r.start }, lte: { work_date: r.end }, order: ["start_time"] })); } catch (e) { console.error(e); setShifts([]); }
    try { setEvents(await api.list("events", { gte: { event_date: r.start }, lte: { event_date: r.end }, order: ["start_time"] })); } catch (e) { console.error(e); setEvents([]); }
  }
  useEffect(() => { reload(); }, [r.start, r.end, s.jobs, s.members]);

  // ---- everything on the calendar, filtered by "My schedule" / "Everyone"
  const mine = scope === "mine";
  const jobs = useMemo(() => s.jobs
    .filter((j) => j.start_date)
    .filter((j) => !mine || crewOf(j.id).includes(s.me.id) || shifts.some((x) => x.job_id === j.id && x.user_id === s.me.id))
    .map((j) => ({ kind: "job", id: j.id, job: j, title: j.title, start: j.start_date, end: j.end_date && j.end_date >= j.start_date ? j.end_date : j.start_date, color: jobColor(j.id), done: j.status === "done" })),
  [s.jobs, s.members, shifts, scope]);
  const allDayEvents = events.filter((e) => !e.start_time).filter((e) => !mine || e.created_by === s.me.id || (e.assignees || []).includes(s.me.id))
    .map((e) => ({ kind: "event", id: e.id, ev: e, title: e.title, start: e.event_date, end: e.event_date, color: evColor(e), done: e.done }));
  const spans = [...jobs, ...allDayEvents];
  const timedEvents = events.filter((e) => e.start_time).filter((e) => !mine || e.created_by === s.me.id || (e.assignees || []).includes(s.me.id));
  const myShifts = shifts.filter((x) => !mine || x.user_id === s.me.id);

  // Timed blocks for one date (events + crew shifts)
  function timedOn(date) {
    const out = [];
    for (const e of timedEvents.filter((x) => x.event_date === date)) {
      const st = mins(e.start_time), en = mins(e.end_time);
      out.push({ kind: "event", id: e.id, ev: e, s: st, e: en && en > st ? en : st + 60, title: e.title, color: evColor(e), done: e.done, urgency: e.urgency });
    }
    for (const sh of myShifts.filter((x) => x.work_date === date)) {
      const job = jobById(sh.job_id); if (!job) continue;
      const st = mins(sh.start_time || job.start_time) ?? 8 * 60, en = mins(sh.end_time);
      out.push({ kind: "shift", id: sh.id, shift: sh, s: st, e: en && en > st ? en : st + 8 * 60, title: `${firstName(person(sh.user_id))} · ${job.title}`, color: jobColor(job.id) });
    }
    return out;
  }
  const chipsOn = (date) => [
    ...timedEvents.filter((e) => e.event_date === date).map((e) => ({ kind: "event", id: e.id, ev: e, t: e.start_time, title: e.title, color: evColor(e), done: e.done, urgency: e.urgency })),
    ...myShifts.filter((x) => x.work_date === date).map((sh) => ({ kind: "shift", id: sh.id, shift: sh, t: sh.start_time || jobById(sh.job_id)?.start_time, title: `${firstName(person(sh.user_id))} · ${jobById(sh.job_id)?.title || ""}`, color: jobColor(sh.job_id) })),
  ].sort((a, b) => (a.t || "").localeCompare(b.t || ""));

  const open = (it) => {
    if (it.kind === "job") go("/job/" + it.id);
    else if (it.kind === "event") setEvSheet({ ev: it.ev });
    else if (it.kind === "shift" && boss) setSheet({ shift: it.shift });
  };
  const openDay = (date) => { setAnchor(date); setView("day"); };
  const newAt = (date, hour) => setEvSheet({ date, start: hour != null ? `${String(hour).padStart(2, "0")}:00` : undefined });
  const ctx = { r, spans, timedOn, chipsOn, open, openDay, newAt, anchor };

  return html`<main class="page cal-page">
    <div class="page-head sched-head"><h1>Schedule</h1>
      <div class="row" style="gap:8px">
        <button class="btn sm ghost" onClick=${() => setEvSheet({ date: view === "day" ? anchor : today() })}>${I.plus} Event</button>
        ${boss && html`<button class="btn sm" onClick=${() => setSheet({ date: view === "day" ? anchor : today() })}>${I.plus} Schedule crew</button>`}
      </div></div>

    <div class="cal-toolbar">
      <div class="row" style="gap:6px">
        <button class="btn sm ghost" onClick=${() => setAnchor(today())}>Today</button>
        <button class="icon-btn" onClick=${() => setAnchor(step(view, anchor, -1))} aria-label="Previous">${I.chevL}</button>
        <button class="icon-btn" onClick=${() => setAnchor(step(view, anchor, 1))} aria-label="Next">${I.chevR}</button>
        <strong class="cal-title">${title(view, anchor)}</strong>
      </div>
      <div class="row cal-switch" style="gap:8px">
        <div class="seg cal-views" role="tablist" aria-label="Calendar view">${VIEWS.map(([k, l]) => html`<button key=${k} role="tab" aria-selected=${view === k} class=${view === k ? "on" : ""} onClick=${() => setView(k)}>${l}</button>`)}</div>
        <div class="seg cal-scope">
          <button class=${scope === "mine" ? "on" : ""} onClick=${() => setScope("mine")}>Mine</button>
          <button class=${scope === "all" ? "on" : ""} onClick=${() => setScope("all")}>Everyone</button>
        </div>
      </div>
    </div>

    ${view === "month" && html`<${MonthGrid} ...${ctx} first=${r.first} />`}
    ${view === "3month" && html`<${ThreeMonths} ...${ctx} jobs=${jobs} />`}
    ${(view === "week" || view === "day") && html`<${TimeGrid} ...${ctx} days=${view === "day" ? [anchor] : range(parseDate(r.start), 7)} />`}
    ${view === "day" && html`<${DayDetail} date=${anchor} scope=${scope} shifts=${shifts} events=${timedEvents.concat(allDayEvents.map((x) => x.ev)).filter((e) => e.event_date === anchor)}
      onShift=${(sh) => boss && setSheet({ shift: sh })} onEvent=${(e) => setEvSheet({ ev: e })} />`}

    ${sheet && html`<${ShiftSheet} ...${sheet} onClose=${() => setSheet(null)} onSaved=${reload} />`}
    ${evSheet && html`<${EventSheet} ...${evSheet} onClose=${() => setEvSheet(null)} onSaved=${reload} />`}
  </main>`;
}

// ================================================================ MONTH
function MonthGrid({ r, first, spans, chipsOn, open, openDay }) {
  const weeks = [];
  for (let d = parseDate(r.start); isoDate(d) <= r.end; d = addDays(d, 7)) weeks.push(range(d, 7));
  const month = first.getMonth();
  const MAX_LANES = 3, MAX_CHIPS = 2;
  return html`<div class="cal-month">
    <div class="cal-dow">${DOW.map((d) => html`<span key=${d}>${d.slice(0, 1)}<span class="dow-rest">${d.slice(1)}</span></span>`)}</div>
    ${weeks.map((days) => {
      const bars = lanes(spans, days[0], days[6]);
      const shown = bars.filter((b) => b.lane < MAX_LANES);
      const usedLanes = Math.min(MAX_LANES, bars.reduce((m, b) => Math.max(m, b.lane + 1), 0));
      return html`<div class="cal-week" key=${days[0]} style=${`--lanes:${usedLanes}`}>
        ${days.map((d, i) => {
          const hidden = bars.filter((b) => b.lane >= MAX_LANES && b.cs <= d && b.ce >= d).length;
          const chips = chipsOn(d);
          const more = hidden + Math.max(0, chips.length - MAX_CHIPS);
          return html`<div key=${d} class="cal-cell ${parseDate(d).getMonth() !== month ? "out" : ""} ${d === today() ? "is-today" : ""}" style=${`grid-column:${i + 1};grid-row:1 / span ${usedLanes + 2}`}
            onClick=${(e) => e.target === e.currentTarget && openDay(d)}>
            <button class="cal-date" onClick=${() => openDay(d)} aria-label=${fmtDate(d, { weekday: "long", month: "long", day: "numeric" })}>${parseDate(d).getDate()}</button>
            <div class="cal-chips">
              ${chips.slice(0, MAX_CHIPS).map((c) => html`<button key=${c.kind + c.id} class="cal-chip ${c.done ? "done" : ""} ${c.urgency === "urgent" ? "urgent" : ""}" style=${`--cc:${c.color}`} onClick=${(e) => { e.stopPropagation(); open(c); }}>
                <i></i><span>${c.t ? fmtTime(c.t).replace(":00", "").replace(" ", "").toLowerCase() + " " : ""}${c.title}</span></button>`)}
              ${more > 0 && html`<button class="cal-more" onClick=${(e) => { e.stopPropagation(); openDay(d); }}>+${more} more</button>`}
            </div>
          </div>`;
        })}
        ${shown.map((b) => html`<button key=${b.kind + b.id} class="cal-bar ${b.done ? "done" : ""} ${b.cs !== b.start ? "cont-l" : ""} ${b.ce !== b.end ? "cont-r" : ""}"
          style=${`--bc:${b.color};grid-column:${days.indexOf(b.cs) + 1} / span ${dayDiff(b.cs, b.ce) + 1};grid-row:${b.lane + 2}`}
          onClick=${() => open(b)} title=${`${b.title} · ${fmtDate(b.start)}${b.end !== b.start ? " – " + fmtDate(b.end) : ""}`}>${b.title}</button>`)}
      </div>`;
    })}
  </div>`;
}

// ============================================================= 3 MONTHS
function ThreeMonths({ r, spans, chipsOn, openDay, open, jobs }) {
  const months = [0, 1, 2].map((i) => addMonths(r.first, i));
  const lastDay = isoDate(addDays(addMonths(r.first, 3), -1));
  const firstDay = isoDate(r.first);
  const inRange = jobs.filter((j) => j.start <= lastDay && j.end >= firstDay).sort((a, b) => a.start.localeCompare(b.start));
  return html`<div>
    <div class="cal-3m">${months.map((m) => {
      const gs = sundayOf(m), ge = addDays(sundayOf(addDays(addMonths(m, 1), -1)), 6);
      const weeks = []; for (let d = gs; d <= ge; d = addDays(d, 7)) weeks.push(range(d, 7));
      return html`<section class="mini" key=${m.getMonth()}>
        <h3>${m.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h3>
        <div class="mini-dow">${DOW.map((d) => html`<span key=${d}>${d[0]}</span>`)}</div>
        ${weeks.map((days) => {
          const bars = lanes(spans, days[0], days[6]).filter((b) => b.lane < 4);
          const n = bars.reduce((mx, b) => Math.max(mx, b.lane + 1), 0);
          return html`<div class="mini-week" key=${days[0]} style=${`--lanes:${n}`}>
            ${days.map((d, i) => {
              const dots = chipsOn(d).slice(0, 3);
              return html`<button key=${d} class="mini-day ${parseDate(d).getMonth() !== m.getMonth() ? "out" : ""} ${d === today() ? "is-today" : ""}"
                style=${`grid-column:${i + 1};grid-row:1 / span ${n + 2}`} onClick=${() => openDay(d)}>
                <span class="mini-num">${parseDate(d).getDate()}</span>
                <span class="mini-dots">${dots.map((c) => html`<i key=${c.kind + c.id} style=${`background:${c.color}`}></i>`)}</span>
              </button>`;
            })}
            ${bars.map((b) => html`<span key=${b.kind + b.id} class="mini-bar ${b.done ? "done" : ""}" title=${b.title}
              style=${`--bc:${b.color};grid-column:${days.indexOf(b.cs) + 1} / span ${dayDiff(b.cs, b.ce) + 1};grid-row:${b.lane + 2}`}></span>`)}
          </div>`;
        })}
      </section>`;
    })}</div>

    <div class="section-title" style="margin-top:22px"><h3>Jobs in this period · ${inRange.length}</h3></div>
    ${inRange.length ? html`<div class="list">${inRange.map((j) => {
      const len = dayDiff(j.start, j.end) + 1;
      const workdays = range(parseDate(j.start), len).filter((d) => (j.job.work_days || [1, 2, 3, 4, 5]).includes(isoDow(d))).length;
      const startPct = Math.max(0, dayDiff(firstDay, j.start)) / (dayDiff(firstDay, lastDay) + 1) * 100;
      const endPct = Math.min(dayDiff(firstDay, lastDay) + 1, dayDiff(firstDay, j.end) + 1) / (dayDiff(firstDay, lastDay) + 1) * 100;
      return html`<button class="li gantt-row" key=${j.id} onClick=${() => open(j)}>
        <span class="jobdot" style=${`--c:${j.color}`}></span>
        <span class="grow" style="min-width:0">
          <strong style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${j.title}</strong>
          <span class="small">${fmtDate(j.start)}${j.end !== j.start ? " – " + fmtDate(j.end) : ""} · ${workdays} work ${workdays === 1 ? "day" : "days"}${j.done ? " · Complete" : ""}</span>
          <span class="gantt-track"><i style=${`left:${startPct}%;width:${Math.max(1.5, endPct - startPct)}%;background:${j.color}`}></i></span>
        </span>
      </button>`;
    })}</div>` : html`<p class="muted">No jobs scheduled in these three months.</p>`}
  </div>`;
}

// ======================================================= WEEK / DAY GRID
function TimeGrid({ days, spans, timedOn, open, openDay, newAt }) {
  const scroller = useRef();
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60000); return () => clearInterval(t); }, []);
  const blocks = days.map((d) => layoutTimed(timedOn(d)));
  const earliest = Math.min(7 * 60, ...blocks.flat().map((b) => b.s));
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = Math.max(0, (earliest / 60 - 0.5) * HOUR_PX); }, [days[0], days.length]);
  const bars = lanes(spans, days[0], days[days.length - 1]);
  const nLanes = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0);
  const now = new Date(); const nowMin = now.getHours() * 60 + now.getMinutes();
  const single = days.length === 1;

  return html`<div class="tgrid ${single ? "single" : ""}" style=${`--cols:${days.length}`}>
    <div class="tg-head">
      <span class="tg-gutter"></span>
      ${days.map((d) => html`<button key=${d} class="tg-day ${d === today() ? "is-today" : ""}" onClick=${() => !single && openDay(d)}>
        <small>${DOW[parseDate(d).getDay()]}</small><b>${parseDate(d).getDate()}</b></button>`)}
    </div>
    ${nLanes > 0 && html`<div class="tg-allday" style=${`--lanes:${nLanes}`}>
      <span class="tg-gutter small muted">all-day</span>
      ${bars.map((b) => html`<button key=${b.kind + b.id} class="cal-bar ${b.done ? "done" : ""} ${b.cs !== b.start ? "cont-l" : ""} ${b.ce !== b.end ? "cont-r" : ""}"
        style=${`--bc:${b.color};grid-column:${days.indexOf(b.cs) + 2} / span ${dayDiff(b.cs, b.ce) + 1};grid-row:${b.lane + 1}`}
        onClick=${() => open(b)}>${b.title}</button>`)}
    </div>`}
    <div class="tg-scroll" ref=${scroller}>
      <div class="tg-body" style=${`height:${24 * HOUR_PX}px`}>
        <div class="tg-hours">${[...Array(24)].map((_, h) => html`<span key=${h} style=${`top:${h * HOUR_PX}px`}>${h === 0 ? "" : fmtTime(`${h}:00`).replace(":00", "")}</span>`)}</div>
        ${days.map((d, i) => html`<div key=${d} class="tg-col ${d === today() ? "is-today" : ""}" style=${`grid-column:${i + 2}`}
          onClick=${(e) => { if (e.target !== e.currentTarget) return; const y = e.nativeEvent?.offsetY ?? e.offsetY; newAt(d, Math.floor(y / HOUR_PX)); }}>
          ${blocks[i].map((b) => html`<button key=${b.kind + b.id} class="tg-block ${b.kind} ${b.done ? "done" : ""} ${b.urgency === "urgent" ? "urgent" : ""}"
            style=${`--bc:${b.color};top:${b.s / 60 * HOUR_PX}px;height:${Math.max(22, (b.e - b.s) / 60 * HOUR_PX - 2)}px;left:calc(${(b.col / b.cols) * 100}% + 1px);width:calc(${100 / b.cols}% - 3px)`}
            onClick=${() => open(b)}>
            <strong>${b.title}</strong><span>${fmtTime(`${Math.floor(b.s / 60)}:${String(b.s % 60).padStart(2, "0")}`)}${b.e - b.s >= 45 ? ` – ${fmtTime(`${Math.floor(b.e / 60) % 24}:${String(b.e % 60).padStart(2, "0")}`)}` : ""}</span>
          </button>`)}
          ${d === today() && html`<span class="tg-now" style=${`top:${nowMin / 60 * HOUR_PX}px`}></span>`}
        </div>`)}
      </div>
    </div>
  </div>`;
}

// ========================================== DAY: crew list under the grid
function DayDetail({ date, scope, shifts, events, onShift, onEvent }) {
  const s = useStore();
  const boss = isBoss();
  const dow = isoDow(date);
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
  for (const sh of shifts.filter((x) => x.work_date === date)) { const job = jobById(sh.job_id); if (job) add(job, sh.user_id, sh.start_time || job.start_time, sh.end_time, sh); }
  const list = [...byJob.values()].map((g) => ({ ...g, rows: [...g.rows.values()].sort((a, b) => (a.start || "").localeCompare(b.start || "")) }));
  const evs = [...events].sort((a, b) => (a.start_time || "").localeCompare(b.start_time || "") || (URGENCY[b.urgency]?.rank || 0) - (URGENCY[a.urgency]?.rank || 0));

  if (!list.length && !evs.length) return html`<${Empty} icon=${I.calendar} title="Nothing scheduled" text=${boss ? "Use “Schedule crew” to put people on a job, or “Event” for something like “Call contractor.”" : "Tap “Event” to add a reminder for yourself."} />`;
  return html`<div style="margin-top:18px">
    ${evs.length > 0 && html`<div class="section-title"><h3>Events · ${evs.length}</h3></div><div class="events">${evs.map((e) => html`<${EventCard} key=${e.id} ev=${e} onOpen=${() => onEvent(e)} />`)}</div>`}
    ${list.length > 0 && html`<div class="section-title"><h3>Crew · ${list.length} ${list.length === 1 ? "job" : "jobs"}</h3></div>`}
    ${list.map(({ job, rows }) => html`<div class="card shift-group" key=${job.id} style=${`--c:${jobColor(job.id)}`}>
      <div class="row"><span class="jobdot"></span><a class="grow" href=${"#/job/" + job.id} style="color:inherit;text-decoration:none"><strong>${job.title}</strong>
        <div class="small muted">${job.address || "No address"}</div></a>${job.start_time && html`<span class="tag">${fmtTime(job.start_time)}</span>`}</div>
      ${rows.length ? html`<div class="list" style="box-shadow:none">${rows.map((r) => html`<button class="li" key=${r.uid} onClick=${() => r.shift && onShift(r.shift)}>
        <${Avatar} id=${r.uid} size=${32} /><span class="grow"><strong>${person(r.uid)?.full_name || "—"}</strong>
        <span class="small">${r.start ? fmtTime(r.start) : "Time TBD"}${r.end ? " – " + fmtTime(r.end) : ""}${!r.shift ? " · on crew" : ""}</span></span>
        ${onSiteAt(job.id).includes(r.uid) && date === today() && html`<span class="tag" style="color:var(--done)">On site</span>`}</button>`)}</div>`
        : html`<p class="small muted" style="margin:4px 0 0">Nobody scheduled.</p>`}
    </div>`)}
  </div>`;
}
