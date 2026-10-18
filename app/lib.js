// Shared helpers, global store and small UI components.
export {
  html, render, useState, useEffect, useRef, useMemo, useCallback,
} from "./vendor/htm-preact.js";
import { html, useState, useEffect, useRef } from "./vendor/htm-preact.js";
import * as api from "./api.js";

// ------------------------------------------------------------ global store
export const S = {
  ready: false, session: null, me: null,
  profiles: [], jobs: [], members: [], tasks: [], assignments: [], shifts: [],
  openLogs: [], notifications: [], settings: {}, toast: null, seenAlertsAt: "",
};
const listeners = new Set();
let version = 0;
export function setS(patch) { Object.assign(S, patch); version++; listeners.forEach((l) => l()); }
export function useStore() {
  const [, force] = useState(0);
  const seen = useRef(version);
  seen.current = version;
  useEffect(() => {
    const l = () => force((x) => x + 1);
    listeners.add(l);
    // catch any change that happened between render and subscribe
    if (seen.current !== version) l();
    return () => listeners.delete(l);
  }, []);
  return S;
}

export async function loadAll() {
  const uid = S.session?.user_id;
  if (!uid) return;
  const me = (await api.list("profiles", { eq: { id: uid } }))[0] || null;
  if (!me || me.status !== "active") { setS({ me, ready: true }); return; }
  const weekAgo = isoDate(addDays(new Date(), -14));
  const [profiles, jobs, members, tasks, assignments, shifts, openLogs, notifications, settingsRows] = await Promise.all([
    api.list("profiles", { order: ["full_name"] }),
    api.list("jobs", { order: ["start_date"] }),
    api.list("job_members"),
    api.list("tasks", { order: ["sort_order"] }),
    api.list("task_assignments"),
    api.list("shifts", { gte: { work_date: weekAgo }, order: ["work_date"] }),
    api.list("time_logs", { isNull: ["departed_at"] }),
    api.list("notifications", { order: ["created_at", false], limit: 60 }),
    api.list("settings"),
  ]);
  const settings = Object.fromEntries(settingsRows.map((r) => [r.key, r.value]));
  setS({ me, profiles, jobs, members, tasks, assignments, shifts, openLogs, notifications, settings, ready: true });
}

// Run a mutation, show errors nicely, then refresh data.
export async function act(fn, okMsg) {
  try {
    const r = await fn();
    await loadAll();
    if (okMsg) toast(okMsg);
    return r ?? true;
  } catch (e) {
    console.error(e);
    toast(friendlyError(e), "error");
    return false;
  }
}
export function friendlyError(e) {
  const m = e?.message || String(e);
  if (/row-level security|permission denied/i.test(m)) return "You don't have permission to do that.";
  if (/duplicate key|Already added/i.test(m)) return "That's already been added.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "No connection. Check your signal and try again.";
  return m;
}
let toastTimer;
export function toast(text, kind = "ok") {
  clearTimeout(toastTimer);
  setS({ toast: { text, kind } });
  toastTimer = setTimeout(() => setS({ toast: null }), 3200);
}

// ------------------------------------------------------------ selectors
export const isBoss = () => S.me?.role === "boss";
export const person = (id) => S.profiles.find((p) => p.id === id);
export const activePeople = () => S.profiles.filter((p) => p.status === "active");
export const jobById = (id) => S.jobs.find((j) => j.id === id);
export const crewOf = (jobId, status = "approved") => S.members.filter((m) => m.job_id === jobId && m.status === status).map((m) => m.user_id);
export const isMember = (jobId, uid = S.me?.id) => S.members.some((m) => m.job_id === jobId && m.user_id === uid && m.status === "approved");
export const tasksOf = (jobId) => S.tasks.filter((t) => t.job_id === jobId);
export const assigneesOf = (taskId) => S.assignments.filter((a) => a.task_id === taskId).map((a) => a.user_id);
export const openLogFor = (jobId, uid = S.me?.id) => S.openLogs.find((l) => l.job_id === jobId && l.user_id === uid);
export const onSiteAt = (jobId) => S.openLogs.filter((l) => l.job_id === jobId).map((l) => l.user_id);
export function progressOf(jobId) {
  const t = tasksOf(jobId);
  if (!t.length) return 0;
  return Math.round((t.filter((x) => x.status === "done").length / t.length) * 100);
}
export const unreadCount = () => S.notifications.filter((n) => n.created_at > (S.seenAlertsAt || "")).length;

// ------------------------------------------------------------ dates & text
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const isoDate = (d) => new Date(d).toLocaleDateString("en-CA");
export const today = () => isoDate(new Date());
export const parseDate = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export function fmtDate(s, opts = { month: "short", day: "numeric" }) {
  if (!s) return "";
  return (s.length === 10 ? parseDate(s) : new Date(s)).toLocaleDateString(undefined, opts);
}
export function fmtTime(t) {
  if (!t) return "";
  if (t.length <= 8 && t.includes(":") && !t.includes("T")) {
    const [h, m] = t.split(":").map(Number);
    return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
  }
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function fmtRange(a, b) {
  if (!a) return "No dates set";
  if (!b || a === b) return fmtDate(a);
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}
export function ago(ts) {
  const s = (Date.now() - new Date(ts)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(ts);
}
export function hours(a, b) {
  const ms = (b ? new Date(b) : new Date()) - new Date(a);
  const h = Math.max(0, ms / 3600000);
  return h < 1 ? `${Math.round(h * 60)}m` : `${Math.floor(h)}h ${String(Math.round((h % 1) * 60)).padStart(2, "0")}m`;
}
export const toLocalInput = (ts) => { const d = new Date(ts); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
export const fromLocalInput = (v) => new Date(v).toISOString();
export const firstName = (p) => (p?.full_name || "").split(" ")[0] || "Someone";

export const STATUS = {
  active: { label: "In progress", cls: "st-active" },
  planned: { label: "Upcoming", cls: "st-planned" },
  on_hold: { label: "On hold", cls: "st-hold" },
  done: { label: "Complete", cls: "st-done" },
};
export const PRIORITY = { 1: { label: "High", cls: "pr-high" }, 2: { label: "Normal", cls: "pr-normal" }, 3: { label: "Low", cls: "pr-low" } };
export const TASK_STATUS = { todo: "To do", in_progress: "Doing", done: "Done" };

// ------------------------------------------------------------ routing
export function useRoute() {
  const [r, setR] = useState(location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => { setR(location.hash.slice(1) || "/"); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return r.split("/").filter(Boolean);
}
export const go = (path) => { location.hash = path; };

// ------------------------------------------------------------ components
const hue = (s = "") => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
export const jobColor = (id) => `hsl(${hue(id + "j")} 62% 44%)`;
export function Avatar({ id, size = 32, ring }) {
  const p = person(id);
  const name = p?.full_name || "?";
  const ini = name.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  return html`<span class="avatar ${ring ? "ring" : ""}" title=${name}
    style=${`width:${size}px;height:${size}px;font-size:${size * 0.4}px;background:hsl(${hue(id)} 45% 42%)`}>${ini}</span>`;
}
export function AvatarStack({ ids, max = 4, size = 28 }) {
  if (!ids.length) return html`<span class="muted small">Nobody yet</span>`;
  return html`<span class="stack">${ids.slice(0, max).map((id) => html`<${Avatar} key=${id} id=${id} size=${size} ring />`)}
    ${ids.length > max && html`<span class="avatar more" style=${`width:${size}px;height:${size}px`}>+${ids.length - max}</span>`}</span>`;
}

export function Sheet({ title, onClose, children, footer }) {
  const ref = useRef();
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    addEventListener("keydown", k);
    document.body.classList.add("noscroll");
    return () => { removeEventListener("keydown", k); document.body.classList.remove("noscroll"); };
  }, []);
  return html`<div class="sheet-backdrop" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="sheet" ref=${ref} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="sheet-head"><h2>${title}</h2><button class="icon-btn" onClick=${onClose} aria-label="Close">${I.x}</button></div>
      <div class="sheet-body">${children}</div>
      ${footer && html`<div class="sheet-foot">${footer}</div>`}
    </div>
  </div>`;
}

export function Field({ label, children, hint }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="hint">${hint}</span>`}</label>`;
}

export function PeoplePicker({ value, onChange, people }) {
  const list = people || activePeople();
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return html`<div class="picker">${list.map((p) => html`
    <button type="button" key=${p.id} class="pick ${value.includes(p.id) ? "on" : ""}" onClick=${() => toggle(p.id)}>
      <${Avatar} id=${p.id} size=${28} /><span>${p.full_name}</span>
      ${p.role === "boss" && html`<span class="tag">Boss</span>`}
      <span class="check">${value.includes(p.id) ? I.check : ""}</span>
    </button>`)}</div>`;
}

export function Empty({ icon, title, text, children }) {
  return html`<div class="empty">${icon && html`<div class="empty-ic">${icon}</div>`}<strong>${title}</strong>${text && html`<p>${text}</p>`}${children}</div>`;
}

export function Confirm({ title, text, okLabel = "Delete", onOk, onClose }) {
  return html`<${Sheet} title=${title} onClose=${onClose}
    footer=${html`<button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn danger" onClick=${async () => { await onOk(); onClose(); }}>${okLabel}</button>`}>
    <p>${text}</p></${Sheet}>`;
}

// ------------------------------------------------------------ icons
const svg = (d) => html`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const p = (d) => html`<path d=${d} />`;
const ICONS = {
  jobs: () => svg(html`<circle cx="7" cy="7" r="4"/><circle cx="17" cy="7" r="4"/><circle cx="7" cy="17" r="4"/><circle cx="17" cy="17" r="4"/>`),
  calendar: () => svg(html`<rect x="3" y="4.5" width="18" height="17" rx="2"/>${p("M16 2.5v4M8 2.5v4M3 10h18")}`),
  board: () => svg(html`<rect x="3" y="3" width="5" height="18" rx="1.5"/><rect x="10" y="3" width="5" height="12" rx="1.5"/><rect x="17" y="3" width="4" height="15" rx="1.5"/>`),
  team: () => svg(html`<circle cx="9" cy="8" r="3.5"/>${p("M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5")}<circle cx="17.5" cy="9" r="2.5"/>${p("M17 14.6c2.3.2 3.9 1.8 4.5 4.4")}`),
  me: () => svg(html`<circle cx="12" cy="8" r="4"/>${p("M4 21c1-4.2 4.1-6.5 8-6.5s7 2.3 8 6.5")}`),
  bell: () => svg(html`${p("M6 8a6 6 0 1 1 12 0c0 7 3 8.5 3 8.5H3S6 15 6 8")}${p("M10 20.5a2.2 2.2 0 0 0 4 0")}`),
  plus: () => svg(p("M12 5v14M5 12h14")),
  x: () => svg(p("M6 6l12 12M18 6L6 18")),
  check: () => svg(p("M5 12.5l4.5 4.5L19 7")),
  back: () => svg(p("M15 5l-7 7 7 7")),
  pin: () => svg(html`${p("M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z")}<circle cx="12" cy="9.5" r="2.5"/>`),
  nav: () => svg(p("M3 11l18-8-8 18-2-8-8-2z")),
  camera: () => svg(html`${p("M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.5-2h6l1.5 2h2A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z")}<circle cx="12" cy="13" r="3.5"/>`),
  clock: () => svg(html`<circle cx="12" cy="12" r="9"/>${p("M12 7v5l3 2")}`),
  note: () => svg(html`${p("M5 3h10l4 4v14H5z")}${p("M14 3v5h5M8 13h8M8 17h5")}`),
  edit: () => svg(p("M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4")),
  trash: () => svg(p("M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3")),
  send: () => svg(p("M4 12l16-8-6 16-2.5-6.5z")),
  phone: () => svg(p("M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z")),
  flag: () => svg(p("M5 21V4h12l-2 4 2 4H5")),
  grip: () => svg(html`<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>`),
  chevL: () => svg(p("M15 6l-6 6 6 6")),
  chevR: () => svg(p("M9 6l6 6-6 6")),
  share: () => svg(html`${p("M12 3v12M7 8l5-5 5 5")}${p("M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6")}`),
  copy: () => svg(html`<rect x="8" y="8" width="12" height="12" rx="2"/>${p("M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3")}`),
  folder: () => svg(p("M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2.5h8.5A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z")),
  dots: () => svg(html`<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>`),
  hard: () => svg(html`${p("M3 18h18M5 18v-3a7 7 0 0 1 14 0v3")}${p("M10 8.5V6h4v2.5")}`),
};
// Fresh icon nodes every time (Preact must not reuse one node in two places).
export const I = {};
for (const [k, f] of Object.entries(ICONS)) Object.defineProperty(I, k, { get: f, enumerable: true });
