// Job detail page (Timeline, Tasks, Location, Photos, Crew & Time) and job/task forms.
import * as api from "./api.js";
import {
  html, useState, useEffect, useMemo, useRef,
  S, useStore, act, toast, isBoss, person, activePeople, jobById, crewOf, isMember, tasksOf, assigneesOf, progressOf,
  openLogFor, onSiteAt, go, today, fmtDate, fmtTime, fmtRange, ago, hours, toLocalInput, fromLocalInput, firstName,
  STATUS, PRIORITY, TASK_STATUS, I, Avatar, AvatarStack, Sheet, Field, PeoplePicker, Empty, Confirm,
} from "./lib.js";
import { ComposeSheet } from "./screens.js";

const TABS = [["timeline", "Timeline"], ["tasks", "Tasks"], ["location", "Location"], ["files", "Files"], ["crew", "Crew & Time"]];

export function JobPage({ id, tab }) {
  const s = useStore();
  const job = jobById(id);
  const boss = isBoss();
  const [detail, setDetail] = useState({ notes: [], photos: [], logs: [], loaded: false });
  const [urls, setUrls] = useState({});
  const [sheet, setSheet] = useState(null);

  async function reloadDetail() {
    try {
      const [notes, photos, logs] = await Promise.all([
        api.list("notes", { eq: { job_id: id }, order: ["created_at", false] }),
        api.list("photos", { eq: { job_id: id }, order: ["created_at", false] }),
        api.list("time_logs", { eq: { job_id: id }, order: ["arrived_at", false] }),
      ]);
      setDetail({ notes, photos, logs, loaded: true });
      if (photos.length) setUrls(await api.photoUrls(photos.map((p) => p.path)));
    } catch (e) { console.error(e); }
  }
  useEffect(() => { reloadDetail(); }, [id, s.openLogs, s.tasks]);

  if (!job) return html`<main class="page"><${Empty} icon=${I.jobs} title="Job not found" text="It may have been deleted."><a class="btn" href="#/">Back to jobs</a></${Empty}></main>`;

  const pct = progressOf(job.id);
  const nTasks = tasksOf(job.id).length;
  const ctx = { job, detail, urls, reloadDetail, setSheet };

  return html`<div>
    <section class="job-hero">
      <div class="row">
        <button class="icon-btn" onClick=${() => (history.length > 1 ? history.back() : go("/"))} aria-label="Back">${I.back}</button>
        <span class="grow"></span>
        ${boss && html`<button class="icon-btn" onClick=${() => setSheet("notify")} aria-label="Notify crew">${I.bell}</button>
          <button class="icon-btn" onClick=${() => setSheet("edit")} aria-label="Edit job">${I.edit}</button>`}
      </div>
      <div class="row wrap" style="margin-top:4px">
        <span class="pill ${STATUS[job.status].cls}">${STATUS[job.status].label}</span>
        ${job.priority === 1 && html`<span class="pill" style="color:#ffb38a">High priority</span>`}
      </div>
      <h1>${job.title}</h1>
      <div class="meta">
        ${job.client && html`<span>${I.me} ${job.client}</span>`}
        <span>${I.calendar} ${fmtRange(job.start_date, job.end_date)}</span>
        ${job.start_time && html`<span>${I.clock} Starts ${fmtTime(job.start_time)}</span>`}
      </div>
      ${nTasks > 0 && html`<div class="progress" aria-label=${pct + "% of tasks done"}><i style=${`width:${pct}%`}></i></div>
        <div class="small" style="margin-top:6px;opacity:.75">${tasksOf(job.id).filter((t) => t.status === "done").length} of ${nTasks} tasks done</div>`}
    </section>

    <${ClockBar} job=${job} />

    <nav class="tabs">${TABS.map(([k, label]) => html`<a key=${k} href=${`#/job/${id}/${k}`} class=${tab === k ? "on" : ""}>${label}</a>`)}</nav>

    <main class="page">
      ${tab === "timeline" && html`<${TimelineTab} ...${ctx} />`}
      ${tab === "tasks" && html`<${TasksTab} ...${ctx} />`}
      ${tab === "location" && html`<${LocationTab} ...${ctx} />`}
      ${(tab === "files" || tab === "photos") && html`<${FilesTab} ...${ctx} />`}
      ${tab === "crew" && html`<${CrewTab} ...${ctx} />`}
    </main>

    ${sheet === "edit" && html`<${JobForm} job=${job} onClose=${() => setSheet(null)} />`}
    ${sheet === "notify" && html`<${ComposeSheet} preset=${{ target: "job", job_id: job.id }} onClose=${() => setSheet(null)} />`}
  </div>`;
}

// ------------------------------------------------------------ clock in/out & join
function ClockBar({ job }) {
  const s = useStore();
  const boss = isBoss();
  const member = isMember(job.id);
  const requested = s.members.some((m) => m.job_id === job.id && m.user_id === s.me.id && m.status === "requested");
  const open = openLogFor(job.id);
  const [, tick] = useState(0);
  useEffect(() => { if (!open) return; const t = setInterval(() => tick((x) => x + 1), 30000); return () => clearInterval(t); }, [open]);

  if (job.status === "done" && !open) return null;

  if (!member) {
    if (requested) return html`<div class="clock"><span class="grow"><strong>Request sent</strong><span class="small muted">A boss needs to approve you for this job.</span></span>
      <button class="btn sm ghost" onClick=${() => act(() => api.remove("job_members", { job_id: job.id, user_id: s.me.id }), "Request cancelled")}>Cancel</button></div>`;
    const needsOk = !boss && s.settings.join_requires_approval === "true";
    return html`<div class="clock"><span class="grow"><strong>${boss ? "You're not on this crew" : "Not on this job yet"}</strong>
      <span class="small muted">${needsOk ? "Ask to join and a boss will approve you." : "Join to clock in, get reminders and see it under My jobs."}</span></span>
      <button class="btn sm" onClick=${() => act(() => api.insert("job_members", { job_id: job.id, user_id: s.me.id, status: needsOk ? "requested" : "approved", added_by: s.me.id }), needsOk ? "Request sent" : "You joined this job")}>${needsOk ? "Ask to join" : "Join job"}</button></div>`;
  }

  if (open) {
    return html`<div class="clock"><span class="on-site-dot"></span>
      <span class="grow"><strong>On site since ${fmtTime(open.arrived_at)}</strong><span class="small muted">${hours(open.arrived_at)} so far</span></span>
      <button class="btn dark" onClick=${() => act(() => api.update("time_logs", { id: open.id }, { departed_at: new Date().toISOString() }), "Clocked out. Nice work!")}>${I.clock} I'm leaving</button></div>`;
  }
  return html`<div class="clock"><span class="grow"><strong>Not clocked in</strong><span class="small muted">Tap when you get to the site.</span></span>
    <button class="btn" onClick=${() => act(() => api.insert("time_logs", { job_id: job.id, user_id: s.me.id }), "You're clocked in")}>${I.pin} I'm here</button></div>`;
}

// ------------------------------------------------------------ timeline
function TimelineTab({ job, detail, urls, reloadDetail }) {
  const s = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  const boss = isBoss();

  async function addNote() {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await act(() => api.insert("notes", { job_id: job.id, user_id: s.me.id, body: text.trim() }));
    if (ok) { setText(""); reloadDetail(); }
    setBusy(false);
  }

  const events = useMemo(() => {
    const ev = [];
    const t = today();
    if (job.start_date) ev.push({ ts: job.start_date + "T00:00:01", day: job.start_date, kind: "mile", text: job.start_date > t ? "Job is scheduled to start" : "Job started", icon: I.flag });
    if (job.end_date) ev.push({ ts: job.end_date + "T23:59:59", day: job.end_date, kind: "mile", text: job.status === "done" ? "Job finished" : job.end_date >= t ? "Scheduled to finish" : "Was due to finish", icon: I.flag });
    detail.notes.forEach((n) => ev.push({ ts: n.created_at, kind: "note", who: n.user_id, text: n.body, icon: I.note, note: n }));
    detail.photos.forEach((p) => {
      const pdf = (p.mime || "").includes("pdf");
      const where = FOLDERS[p.folder || "photos"]?.label || "Photos";
      ev.push({ ts: p.created_at, kind: "photo", who: p.user_id, icon: pdf ? I.note : I.camera,
        text: pdf ? `Added “${p.file_name || "document"}” to ${where}` : p.caption || (p.folder && p.folder !== "photos" ? `Added a photo to ${where}` : "Added a photo"),
        img: pdf ? null : urls[p.path] });
    });
    detail.logs.forEach((l) => {
      ev.push({ ts: l.arrived_at, kind: "in", who: l.user_id, text: "Arrived on site", icon: I.pin });
      if (l.departed_at) ev.push({ ts: l.departed_at, kind: "out", who: l.user_id, text: `Left site · ${hours(l.arrived_at, l.departed_at)} on the job`, icon: I.clock });
    });
    tasksOf(job.id).filter((x) => x.completed_at).forEach((x) => ev.push({ ts: x.completed_at, kind: "task", who: assigneesOf(x.id)[0], text: `Finished “${x.title}”`, icon: I.check }));
    ev.forEach((e) => { e.day = e.day || new Date(e.ts).toLocaleDateString("en-CA"); });
    return ev.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }, [detail, urls, s.tasks, job]);

  let lastDay = "";
  return html`<div>
    <div class="composer">
      <textarea placeholder="Add a note for the crew…" value=${text} onInput=${(e) => setText(e.target.value)} rows="2"></textarea>
      <button class="btn" disabled=${busy || !text.trim()} onClick=${addNote} aria-label="Post note">${I.send}</button>
    </div>
    ${!detail.loaded ? html`<div class="loading" style="min-height:120px"><div class="spinner"></div></div>` : html`<div class="feed">
      ${events.map((e, i) => {
        const showDay = e.day !== lastDay; lastDay = e.day;
        const label = e.day === today() ? "Today" : fmtDate(e.day, { weekday: "short", month: "short", day: "numeric" });
        const canDel = e.note && (e.note.user_id === s.me.id || boss);
        return html`<div key=${i}>
          ${showDay && html`<div class="day-label">${label}</div>`}
          <div class="feed-item">
            <span class="feed-ic k-${e.kind}">${e.icon}</span>
            <div class="feed-body">
              ${e.kind === "mile" ? html`<strong>${e.text}</strong>` : html`<div><span class="who">${person(e.who)?.full_name || "Crew"}</span><span class="when">${fmtTime(e.ts)}</span>
                ${canDel && html`<button class="icon-btn" style="width:30px;height:30px;float:right" onClick=${() => setDel(e.note)} aria-label="Delete note">${I.trash}</button>`}</div>
                <div class="txt">${e.text}</div>${e.img && html`<img src=${e.img} alt="" loading="lazy" />`}`}
            </div>
          </div>
        </div>`;
      })}
      ${!events.length && html`<${Empty} title="Nothing yet" text="Notes, photos, arrivals and finished tasks show up here." />`}
    </div>`}
    ${del && html`<${Confirm} title="Delete note?" text="This can't be undone." onClose=${() => setDel(null)}
      onOk=${() => act(() => api.remove("notes", { id: del.id }), "Note deleted").then(reloadDetail)} />`}
  </div>`;
}

// ------------------------------------------------------------ tasks
export function nextStatus(st) { return st === "done" ? "todo" : "done"; }
export function canWorkTask(task) { return isBoss() || assigneesOf(task.id).includes(S.me.id); }

function TasksTab({ job }) {
  const s = useStore();
  const boss = isBoss();
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(null);
  const [onlyMine, setOnlyMine] = useState(!boss);

  let tasks = tasksOf(job.id);
  if (onlyMine && !boss) tasks = tasks.filter((t) => assigneesOf(t.id).includes(s.me.id));
  const sorter = (a, b) => a.priority - b.priority || a.sort_order - b.sort_order;
  const groups = [["in_progress", "Doing now"], ["todo", "To do"], ["done", "Done"]];

  async function add(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const ok = await act(() => api.insert("tasks", { job_id: job.id, title: title.trim(), priority: 2, sort_order: Date.now(), created_by: s.me.id }));
    if (ok) setTitle("");
  }

  return html`<div>
    ${boss && html`<form class="addline" onSubmit=${add}>
      <input type="text" placeholder="Add a task (e.g. Frame north wall)" value=${title} onInput=${(e) => setTitle(e.target.value)} />
      <button class="btn" aria-label="Add task">${I.plus}</button>
    </form>`}
    ${!boss && html`<div class="seg" style="margin-bottom:14px">
      <button class=${onlyMine ? "on" : ""} onClick=${() => setOnlyMine(true)}>My tasks</button>
      <button class=${!onlyMine ? "on" : ""} onClick=${() => setOnlyMine(false)}>All tasks</button>
    </div>`}
    ${groups.map(([st, label]) => {
      const list = tasks.filter((t) => t.status === st).sort(sorter);
      if (!list.length) return null;
      return html`<div key=${st}><div class="section-title"><h3>${label} · ${list.length}</h3></div>
        ${list.map((t) => html`<${TaskRow} key=${t.id} task=${t} onOpen=${() => setOpen(t)} />`)}</div>`;
    })}
    ${!tasks.length && html`<${Empty} icon=${I.check} title=${onlyMine && !boss ? "No tasks assigned to you" : "No tasks yet"} text=${boss ? "Add the first task above." : "Your boss will add tasks here."} />`}
    ${open && html`<${TaskSheet} task=${open} onClose=${() => setOpen(null)} />`}
  </div>`;
}

export function TaskRow({ task, onOpen, showJob }) {
  const who = assigneesOf(task.id);
  const can = canWorkTask(task);
  const job = showJob && jobById(task.job_id);
  return html`<div class="task ${task.status}">
    <button class="tick ${task.status === "done" ? "on" : task.status === "in_progress" ? "doing" : ""}" disabled=${!can}
      aria-label=${task.status === "done" ? "Mark not done" : "Mark done"}
      onClick=${() => act(() => api.update("tasks", { id: task.id }, { status: nextStatus(task.status) }), task.status === "done" ? null : "Task done ✓")}>
      ${task.status === "done" ? I.check : ""}</button>
    <button class="task-main" onClick=${onOpen}>
      <span class="task-title">${task.title}</span>
      <span class="task-sub">
        ${job && html`<span>${job.title}</span>`}
        ${task.priority === 1 && html`<span class="flag pr-high">${I.flag} High</span>`}
        ${task.due_date && html`<span>Due ${fmtDate(task.due_date)}</span>`}
        ${!who.length && html`<span>Unassigned</span>`}
      </span>
    </button>
    ${who.length > 0 && html`<${AvatarStack} ids=${who} max=${3} size=${26} />`}
  </div>`;
}

export function TaskSheet({ task, jobId, onClose }) {
  const s = useStore();
  const boss = isBoss();
  const isNew = !task;
  const [f, setF] = useState(() => ({
    title: task?.title || "", description: task?.description || "", priority: task?.priority || 2, status: task?.status || "todo",
    due_date: task?.due_date || "", job_id: task?.job_id || jobId || s.jobs.find((j) => j.status !== "done")?.id || "",
    who: task ? assigneesOf(task.id) : [],
  }));
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });
  const can = task ? canWorkTask(task) : boss;
  const job = jobById(f.job_id);

  async function save() {
    if (!f.title.trim()) return toast("Give the task a name", "error");
    const ok = await act(async () => {
      if (!boss) {
        if (task.status !== f.status) await api.update("tasks", { id: task.id }, { status: f.status });
        return;
      }
      const row = { title: f.title.trim(), description: f.description, priority: Number(f.priority), status: f.status, due_date: f.due_date || null, job_id: f.job_id };
      let id = task?.id;
      if (isNew) id = (await api.insert("tasks", { ...row, sort_order: Date.now(), created_by: s.me.id }))[0].id;
      else await api.update("tasks", { id }, row);
      const before = isNew ? [] : assigneesOf(id);
      const add = f.who.filter((u) => !before.includes(u));
      const rem = before.filter((u) => !f.who.includes(u));
      if (add.length) await api.insert("task_assignments", add.map((user_id) => ({ task_id: id, user_id })));
      for (const u of rem) await api.remove("task_assignments", { task_id: id, user_id: u });
      // anyone assigned should also be on the job's crew
      const crew = crewOf(f.job_id);
      const missing = add.filter((u) => !crew.includes(u) && !s.members.some((m) => m.job_id === f.job_id && m.user_id === u));
      if (missing.length) await api.insert("job_members", missing.map((user_id) => ({ job_id: f.job_id, user_id, status: "approved", added_by: s.me.id })));
    }, isNew ? "Task added" : "Saved");
    if (ok) onClose();
  }

  // Put this job's crew first in the picker
  const people = useMemo(() => {
    const crew = new Set(crewOf(f.job_id));
    return [...activePeople()].sort((a, b) => (crew.has(b.id) - crew.has(a.id)) || a.full_name.localeCompare(b.full_name));
  }, [f.job_id, s.profiles, s.members]);

  if (!boss) {
    return html`<${Sheet} title="Task" onClose=${onClose}
      footer=${can ? html`<button class="btn ghost" onClick=${onClose}>Close</button><button class="btn" onClick=${save}>Save</button>` : html`<button class="btn ghost" onClick=${onClose}>Close</button>`}>
      <h2 style="margin-bottom:8px">${task.title}</h2>
      ${job && html`<p class="muted">${job.title}</p>`}
      ${task.description && html`<p style="white-space:pre-wrap">${task.description}</p>`}
      <dl class="kv" style="margin:14px 0">
        <dt>Priority</dt><dd class=${PRIORITY[task.priority].cls}>${PRIORITY[task.priority].label}</dd>
        ${task.due_date && html`<dt>Due</dt><dd>${fmtDate(task.due_date, { weekday: "short", month: "short", day: "numeric" })}</dd>`}
        <dt>Assigned</dt><dd>${assigneesOf(task.id).map((u) => person(u)?.full_name).join(", ") || "Nobody yet"}</dd>
      </dl>
      ${can ? html`<${Field} label="Status"><div class="seg">${Object.entries(TASK_STATUS).map(([k, l]) => html`<button type="button" class=${f.status === k ? "on" : ""} onClick=${() => set("status", k)}>${l}</button>`)}</div></${Field}>`
        : html`<p class="small muted">Only the people assigned can update this task.</p>`}
    </${Sheet}>`;
  }

  return html`<${Sheet} title=${isNew ? "New task" : "Edit task"} onClose=${onClose}
    footer=${html`${!isNew && html`<button class="icon-btn" onClick=${() => setConfirmDel(true)} aria-label="Delete task">${I.trash}</button>`}
      <button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" onClick=${save}>${isNew ? "Add task" : "Save"}</button>`}>
    <${Field} label="Task"><input type="text" value=${f.title} onInput=${(e) => set("title", e.target.value)} placeholder="What needs doing?" /></${Field}>
    ${(isNew || !jobId) && html`<${Field} label="Job"><select value=${f.job_id} onChange=${(e) => set("job_id", e.target.value)}>
      ${s.jobs.filter((j) => j.status !== "done" || j.id === f.job_id).map((j) => html`<option key=${j.id} value=${j.id}>${j.title}</option>`)}</select></${Field}>`}
    <${Field} label="Priority"><div class="seg">${[1, 2, 3].map((p) => html`<button type="button" class=${f.priority === p ? "on" : ""} onClick=${() => set("priority", p)}>${PRIORITY[p].label}</button>`)}</div></${Field}>
    <${Field} label="Status"><div class="seg">${Object.entries(TASK_STATUS).map(([k, l]) => html`<button type="button" class=${f.status === k ? "on" : ""} onClick=${() => set("status", k)}>${l}</button>`)}</div></${Field}>
    <${Field} label="Due date (optional)"><input type="date" value=${f.due_date} onInput=${(e) => set("due_date", e.target.value)} /></${Field}>
    <${Field} label="Details (optional)"><textarea rows="3" value=${f.description} onInput=${(e) => set("description", e.target.value)} placeholder="Materials, measurements, notes…"></textarea></${Field}>
    <${Field} label="Assign to"><${PeoplePicker} value=${f.who} onChange=${(v) => set("who", v)} people=${people} /></${Field}>
    ${confirmDel && html`<${Confirm} title="Delete this task?" text=${`“${task.title}” will be removed for everyone.`} onClose=${() => setConfirmDel(false)}
      onOk=${async () => { if (await act(() => api.remove("tasks", { id: task.id }), "Task deleted")) onClose(); }} />`}
  </${Sheet}>`;
}

// ------------------------------------------------------------ location
function LocationTab({ job, setSheet }) {
  const boss = isBoss();
  if (!job.address) return html`<${Empty} icon=${I.pin} title="No address yet" text=${boss ? "Add the job address so the crew can navigate there." : "Your boss hasn't added an address yet."}>
    ${boss && html`<button class="btn" onClick=${() => setSheet("edit")}>Add address</button>`}</${Empty}>`;
  const q = encodeURIComponent(job.address);
  return html`<div>
    ${api.DEMO ? html`<div class="map" style="display:grid;place-items:center;color:var(--muted);text-align:center;padding:20px">${I.pin}<br />The live map shows here in the real app.</div>`
      : html`<iframe class="map" title="Map of job site" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src=${`https://maps.google.com/maps?q=${q}&z=15&output=embed`}></iframe>`}
    <div class="addr">${job.address}</div>
    <div class="stack-v">
      <a class="btn block big" href=${`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noopener">${I.nav} Directions (Google Maps)</a>
      <a class="btn block ghost" href=${`https://maps.apple.com/?daddr=${q}`} target="_blank" rel="noopener">Open in Apple Maps</a>
      <button class="btn block ghost" onClick=${() => navigator.clipboard?.writeText(job.address).then(() => toast("Address copied"))}>${I.copy} Copy address</button>
    </div>
    ${job.description && html`<div class="card" style="margin-top:18px"><h3 style="margin-bottom:8px">Job notes</h3><p style="white-space:pre-wrap;margin:0">${job.description}</p></div>`}
  </div>`;
}

// ------------------------------------------------------------ files (ICR / Design / Photos)
export const FOLDERS = {
  icr: { label: "ICR", desc: "High-importance project documents", bossOnly: true },
  design: { label: "Design", desc: "Plans, drawings and design documents", bossOnly: true },
  photos: { label: "Photos", desc: "Photos from the job and specific tasks", bossOnly: false },
};
const fmtSize = (b) => (!b ? "" : b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`);
const isPdfRow = (f) => (f.mime || "").includes("pdf");

function FilesTab({ job, detail, urls, reloadDetail }) {
  const s = useStore();
  const boss = isBoss();
  const input = useRef();
  const [folder, setFolder] = useState(() => { try { return localStorage.getItem("jobFolder") || "photos"; } catch (_) { return "photos"; } });
  const [taskFilter, setTaskFilter] = useState("");
  const [uploadTask, setUploadTask] = useState("");
  const [busy, setBusy] = useState(0);
  const [view, setView] = useState(null);
  const [menu, setMenu] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  useEffect(() => { try { localStorage.setItem("jobFolder", folder); } catch (_) { /* ignore */ } }, [folder]);

  const all = detail.photos.map((f) => ({ ...f, folder: f.folder || "photos" }));
  const inFolder = all.filter((f) => f.folder === folder);
  const shown = folder === "photos" && taskFilter ? inFolder.filter((f) => f.task_id === taskFilter) : inFolder;
  const pdfs = shown.filter(isPdfRow);
  const pics = shown.filter((f) => !isPdfRow(f));
  const canUpload = boss || !FOLDERS[folder].bossOnly;
  const jobTasks = tasksOf(job.id);
  const taggedTasks = jobTasks.filter((t) => inFolder.some((f) => f.task_id === t.id));
  const canChange = (f) => f.user_id === s.me.id || boss;

  async function upload(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (!files.length) return;
    setBusy(files.length);
    let ok = 0;
    for (const f of files) {
      try { await api.uploadFile(job.id, s.me.id, f, { folder, task_id: folder === "photos" ? uploadTask : null }); ok++; }
      catch (err) { toast(friendlyErr(err), "error"); }
      setBusy((b) => b - 1);
    }
    if (ok) toast(`${ok === 1 ? "1 file" : ok + " files"} added to ${FOLDERS[folder].label}`);
    reloadDetail();
  }
  const friendlyErr = (err) => (/row-level security|permission/i.test(err?.message || "") ? "Only bosses can add files to this folder." : err?.message || "Upload failed");
  const move = (f, to) => act(() => api.update("photos", { id: f.id }, { folder: to }), `Moved to ${FOLDERS[to].label}`).then(() => { setMenu(null); setView(null); reloadDetail(); });

  return html`<div>
    <div class="folders">${Object.entries(FOLDERS).map(([k, v]) => html`<button key=${k} class="folder ${folder === k ? "on" : ""}" onClick=${() => { setFolder(k); setTaskFilter(""); }}>
      <span class="folder-ic">${I.folder}</span><strong>${v.label}</strong><span class="small muted">${((n) => `${n} ${n === 1 ? "file" : "files"}`)(all.filter((f) => f.folder === k).length)}</span></button>`)}</div>

    <div class="row spread" style="margin:4px 0 12px"><div class="grow"><h2>${FOLDERS[folder].label}</h2><div class="small muted">${FOLDERS[folder].desc}</div></div></div>

    ${canUpload ? html`<div class="uploadbar">
        ${folder === "photos" && jobTasks.length > 0 && html`<select value=${uploadTask} onChange=${(e) => setUploadTask(e.target.value)} aria-label="Tag photos with a task">
          <option value="">No task (general job photo)</option>
          ${jobTasks.map((t) => html`<option key=${t.id} value=${t.id}>Task: ${t.title}</option>`)}</select>`}
        <button class="btn block" disabled=${busy > 0} onClick=${() => input.current.click()}>${busy ? `Uploading ${busy}…` : html`${I.plus} Add ${folder === "photos" ? "photos" : "PDFs or photos"}`}</button>
        <input ref=${input} type="file" accept=${folder === "photos" ? "image/*,application/pdf" : "application/pdf,image/*"} multiple class="hidden" onChange=${upload} />
      </div>`
      : html`<p class="small muted" style="margin:0 0 12px">Only bosses can add files to ${FOLDERS[folder].label}. Everyone on the team can view them.</p>`}

    ${folder === "photos" && taggedTasks.length > 0 && html`<div class="chips" style="margin-bottom:12px">
      <button class="chip ${!taskFilter ? "on" : ""}" onClick=${() => setTaskFilter("")}>All photos</button>
      ${taggedTasks.map((t) => html`<button key=${t.id} class="chip ${taskFilter === t.id ? "on" : ""}" onClick=${() => setTaskFilter(t.id)}>${t.title}</button>`)}</div>`}

    ${pdfs.length > 0 && html`<div class="list" style="margin-bottom:14px">${pdfs.map((f) => html`<div class="li" key=${f.id}>
      <span class="pdf-ic">PDF</span>
      <a class="grow" href=${urls[f.path]} target="_blank" rel="noopener" style="color:inherit;text-decoration:none;min-width:0">
        <strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.file_name || "Document.pdf"}</strong>
        <span class="small">${firstName(person(f.user_id))} · ${fmtDate(f.created_at)}${f.size ? " · " + fmtSize(f.size) : ""}</span></a>
      ${canChange(f) && html`<button class="icon-btn" aria-label="File options" onClick=${() => setMenu(f)}>${I.dots}</button>`}
    </div>`)}</div>`}

    ${pics.length > 0 && html`<div class="photo-grid">${pics.map((f) => html`<button key=${f.id} onClick=${() => setView(f)}><img src=${urls[f.path]} alt=${f.caption || "Job photo"} loading="lazy" /></button>`)}</div>`}

    ${!shown.length && detail.loaded && html`<${Empty} icon=${I.folder} title=${`${FOLDERS[folder].label} is empty`}
      text=${folder === "photos" ? "Take progress photos so the office can see the work without driving out." : canUpload ? "Add PDFs or photos with the button above." : "Nothing has been added yet."} />`}

    ${view && html`<div class="viewer" role="dialog" aria-label="Photo">
      <div class="bar"><button class="icon-btn" onClick=${() => setView(null)} aria-label="Close">${I.x}</button><span class="grow"></span>
        ${canChange(view) && html`<button class="icon-btn" onClick=${() => setMenu(view)} aria-label="Photo options">${I.dots}</button>`}</div>
      <img src=${urls[view.path]} alt="" />
      <div class="cap"><strong>${person(view.user_id)?.full_name || "Crew"}</strong> · ${fmtDate(view.created_at)} ${fmtTime(view.created_at)}
        ${view.task_id && jobTasks.find((t) => t.id === view.task_id) && html`<div>Task: ${jobTasks.find((t) => t.id === view.task_id).title}</div>`}
        ${view.caption && html`<div>${view.caption}</div>`}</div>
    </div>`}

    ${menu && html`<${Sheet} title=${menu.file_name || "File"} onClose=${() => setMenu(null)}>
      ${isPdfRow(menu) && html`<a class="btn block ghost" style="margin-bottom:10px" href=${urls[menu.path]} target="_blank" rel="noopener">Open</a>`}
      ${boss && html`<${Field} label="Move to folder"><div class="seg">${Object.entries(FOLDERS).map(([k, v]) => html`<button type="button" key=${k} class=${menu.folder === k ? "on" : ""} onClick=${() => menu.folder !== k && move(menu, k)}>${v.label}</button>`)}</div></${Field}>`}
      ${(menu.folder || "photos") === "photos" && jobTasks.length > 0 && html`<${Field} label="Task"><select value=${menu.task_id || ""} onChange=${(e) => act(() => api.update("photos", { id: menu.id }, { task_id: e.target.value || null }), "Saved").then(() => { setMenu(null); reloadDetail(); })}>
        <option value="">No task</option>${jobTasks.map((t) => html`<option key=${t.id} value=${t.id}>${t.title}</option>`)}</select></${Field}>`}
      <button class="btn block danger" onClick=${() => setConfirmDel(menu)}>${I.trash} Delete</button>
    </${Sheet}>`}

    ${confirmDel && html`<${Confirm} title="Delete this file?" text="This removes it for everyone." onClose=${() => setConfirmDel(null)}
      onOk=${async () => { if (await act(() => api.deletePhoto(confirmDel), "Deleted")) { setMenu(null); setView(null); reloadDetail(); } }} />`}
  </div>`;
}

// ------------------------------------------------------------ crew & time
function CrewTab({ job, detail, reloadDetail }) {
  const s = useStore();
  const boss = isBoss();
  const crew = crewOf(job.id);
  const requests = crewOf(job.id, "requested");
  const onsite = onSiteAt(job.id);
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState([]);
  const [editLog, setEditLog] = useState(null);

  const logs = boss ? detail.logs : detail.logs.filter((l) => l.user_id === s.me.id);
  const totals = {};
  detail.logs.forEach((l) => { if (l.departed_at) totals[l.user_id] = (totals[l.user_id] || 0) + (new Date(l.departed_at) - new Date(l.arrived_at)); });

  return html`<div>
    ${boss && requests.length > 0 && html`<div class="section-title"><h3>Wants to join · ${requests.length}</h3></div>
      <div class="list" style="margin-bottom:18px">${requests.map((u) => html`<div class="li" key=${u}><${Avatar} id=${u} size=${38} />
        <span class="grow"><strong>${person(u)?.full_name}</strong></span>
        <button class="btn sm ghost" onClick=${() => act(() => api.remove("job_members", { job_id: job.id, user_id: u }), "Declined")}>Decline</button>
        <button class="btn sm" onClick=${() => act(() => api.update("job_members", { job_id: job.id, user_id: u }, { status: "approved" }), "Added to crew")}>Approve</button></div>`)}</div>`}

    <div class="section-title"><h3>Crew · ${crew.length}</h3>
      ${boss && html`<button class="btn sm soft" onClick=${() => { setPick(crew); setAdding(true); }}>${I.plus} Edit crew</button>`}</div>
    ${crew.length ? html`<div class="list">${crew.map((u) => {
      const p = person(u);
      return html`<div class="li" key=${u}><${Avatar} id=${u} size=${40} />
        <span class="grow"><strong>${p?.full_name || "Former member"}</strong>
          <span class="small">${onsite.includes(u) ? html`<span style="color:var(--done);font-weight:700">● On site now</span>` : p?.role === "boss" ? "Boss" : "Crew"}
          ${totals[u] ? ` · ${(totals[u] / 3600000).toFixed(1)} hrs logged` : ""}</span></span>
        ${p?.phone && html`<a class="icon-btn" href=${"tel:" + p.phone} aria-label=${"Call " + p.full_name}>${I.phone}</a>`}
      </div>`;
    })}</div>` : html`<${Empty} title="No crew yet" text=${boss ? "Add people so they get reminders for this job." : "Join this job from the bar above."} />`}

    <div class="section-title" style="margin-top:26px"><h3>${boss ? "Time on site" : "My time on site"}</h3>
      <button class="btn sm soft" onClick=${() => setEditLog({ job_id: job.id, user_id: s.me.id, arrived_at: new Date(new Date().setHours(8, 0, 0, 0)).toISOString(), departed_at: new Date(new Date().setHours(16, 30, 0, 0)).toISOString(), isNew: true })}>${I.plus} Add time</button></div>
    ${logs.length ? html`<div class="list">${logs.map((l) => html`<button class="li" key=${l.id} onClick=${() => (l.user_id === s.me.id || boss) && setEditLog(l)}>
      ${boss && html`<${Avatar} id=${l.user_id} size=${34} />`}
      <span class="grow"><strong>${boss ? firstName(person(l.user_id)) + " · " : ""}${fmtDate(l.arrived_at, { weekday: "short", month: "short", day: "numeric" })}</strong>
        <span class="small">${fmtTime(l.arrived_at)} – ${l.departed_at ? fmtTime(l.departed_at) : "still on site"}</span></span>
      <strong>${hours(l.arrived_at, l.departed_at)}</strong></button>`)}</div>`
      : html`<p class="muted">No time logged yet. Use “I'm here” when you arrive, or add it by hand.</p>`}

    ${adding && html`<${Sheet} title="Who's on this job?" onClose=${() => setAdding(false)}
      footer=${html`<button class="btn ghost" onClick=${() => setAdding(false)}>Cancel</button><button class="btn" onClick=${async () => {
        const add = pick.filter((u) => !crew.includes(u));
        const rem = crew.filter((u) => !pick.includes(u));
        const ok = await act(async () => {
          for (const u of add) {
            if (requests.includes(u)) await api.update("job_members", { job_id: job.id, user_id: u }, { status: "approved" });
            else await api.insert("job_members", { job_id: job.id, user_id: u, status: "approved", added_by: s.me.id });
          }
          for (const u of rem) await api.remove("job_members", { job_id: job.id, user_id: u });
        }, "Crew updated");
        if (ok) setAdding(false);
      }}>Save crew</button>`}>
      <${PeoplePicker} value=${pick} onChange=${setPick} />
    </${Sheet}>`}
    ${editLog && html`<${LogSheet} log=${editLog} onClose=${() => setEditLog(null)} onSaved=${reloadDetail} />`}
  </div>`;
}

function LogSheet({ log, onClose, onSaved }) {
  const s = useStore();
  const boss = isBoss();
  const [f, setF] = useState({ user_id: log.user_id, arrived: toLocalInput(log.arrived_at), departed: log.departed_at ? toLocalInput(log.departed_at) : "" });
  const [confirmDel, setConfirmDel] = useState(false);
  async function save() {
    const arrived_at = fromLocalInput(f.arrived);
    const departed_at = f.departed ? fromLocalInput(f.departed) : null;
    if (departed_at && departed_at <= arrived_at) return toast("Leave time must be after arrive time", "error");
    const ok = await act(() => log.isNew
      ? api.insert("time_logs", { job_id: log.job_id, user_id: f.user_id, arrived_at, departed_at })
      : api.update("time_logs", { id: log.id }, { arrived_at, departed_at }), "Time saved");
    if (ok) { onSaved(); onClose(); }
  }
  return html`<${Sheet} title=${log.isNew ? "Add time" : "Edit time"} onClose=${onClose}
    footer=${html`${!log.isNew && boss && html`<button class="icon-btn" onClick=${() => setConfirmDel(true)} aria-label="Delete entry">${I.trash}</button>`}
      <button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" onClick=${save}>Save</button>`}>
    ${log.isNew && boss && html`<${Field} label="Who"><select value=${f.user_id} onChange=${(e) => setF({ ...f, user_id: e.target.value })}>
      ${activePeople().map((p) => html`<option key=${p.id} value=${p.id}>${p.full_name}</option>`)}</select></${Field}>`}
    <${Field} label="Arrived"><input type="datetime-local" value=${f.arrived} onInput=${(e) => setF({ ...f, arrived: e.target.value })} /></${Field}>
    <${Field} label="Left" hint="Leave empty if still on site."><input type="datetime-local" value=${f.departed} onInput=${(e) => setF({ ...f, departed: e.target.value })} /></${Field}>
    ${confirmDel && html`<${Confirm} title="Delete this time entry?" text="This can't be undone." onClose=${() => setConfirmDel(false)}
      onOk=${async () => { if (await act(() => api.remove("time_logs", { id: log.id }), "Deleted")) { onSaved(); onClose(); } }} />`}
  </${Sheet}>`;
}

// ------------------------------------------------------------ job form
const DAYS = [[1, "M"], [2, "T"], [3, "W"], [4, "T"], [5, "F"], [6, "S"], [7, "S"]];

export function JobForm({ job, onClose, onSaved }) {
  const s = useStore();
  const isNew = !job;
  const [f, setF] = useState(() => ({
    title: job?.title || "", client: job?.client || "", address: job?.address || "", description: job?.description || "",
    start_date: job?.start_date || today(), end_date: job?.end_date || "", start_time: (job?.start_time || "08:00").slice(0, 5),
    work_days: job?.work_days || [1, 2, 3, 4, 5], status: job?.status || "planned", priority: job?.priority || 2,
    crew: job ? crewOf(job.id) : [],
  }));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k, v) => setF({ ...f, [k]: v });

  async function save() {
    if (!f.title.trim()) return toast("Give the job a name", "error");
    if (f.end_date && f.start_date && f.end_date < f.start_date) return toast("End date is before the start date", "error");
    setBusy(true);
    const row = {
      title: f.title.trim(), client: f.client.trim() || null, address: f.address.trim() || null, description: f.description.trim() || null,
      start_date: f.start_date || null, end_date: f.end_date || null, start_time: f.start_time || null,
      work_days: [...f.work_days].sort(), status: f.status, priority: Number(f.priority),
    };
    let id = job?.id;
    const ok = await act(async () => {
      if (isNew) {
        id = (await api.insert("jobs", { ...row, created_by: s.me.id }))[0].id;
        if (f.crew.length) await api.insert("job_members", f.crew.map((user_id) => ({ job_id: id, user_id, status: "approved", added_by: s.me.id })));
      } else {
        await api.update("jobs", { id }, row);
      }
    }, isNew ? "Job created" : "Job saved");
    setBusy(false);
    if (ok) { onClose(); onSaved?.(id); }
  }

  return html`<${Sheet} title=${isNew ? "New job" : "Edit job"} onClose=${onClose}
    footer=${html`${!isNew && html`<button class="icon-btn" onClick=${() => setConfirmDel(true)} aria-label="Delete job">${I.trash}</button>`}
      <button class="btn ghost" onClick=${onClose}>Cancel</button><button class="btn" disabled=${busy} onClick=${save}>${isNew ? "Create job" : "Save"}</button>`}>
    <${Field} label="Job name"><input type="text" value=${f.title} onInput=${(e) => set("title", e.target.value)} placeholder="e.g. Smith Kitchen Remodel" /></${Field}>
    <${Field} label="Address" hint="Crew get this in their reminder and can tap to navigate."><input type="text" value=${f.address} autocomplete="street-address" onInput=${(e) => set("address", e.target.value)} placeholder="Street, city, state" /></${Field}>
    <${Field} label="Client (optional)"><input type="text" value=${f.client} onInput=${(e) => set("client", e.target.value)} /></${Field}>
    <div class="two">
      <${Field} label="Start date"><input type="date" value=${f.start_date} onInput=${(e) => set("start_date", e.target.value)} /></${Field}>
      <${Field} label="End date"><input type="date" value=${f.end_date} onInput=${(e) => set("end_date", e.target.value)} /></${Field}>
    </div>
    <${Field} label="Daily start time" hint=${`Everyone on the crew gets a reminder ${s.settings.reminder_minutes || 30} min before.`}>
      <input type="time" value=${f.start_time} onInput=${(e) => set("start_time", e.target.value)} /></${Field}>
    <${Field} label="Work days"><div class="weekdays">${DAYS.map(([d, l]) => html`<button type="button" key=${d} class=${f.work_days.includes(d) ? "on" : ""}
      onClick=${() => set("work_days", f.work_days.includes(d) ? f.work_days.filter((x) => x !== d) : [...f.work_days, d])}>${l}</button>`)}</div></${Field}>
    <${Field} label="Status"><div class="seg">${Object.entries(STATUS).map(([k, v]) => html`<button type="button" key=${k} class=${f.status === k ? "on" : ""} onClick=${() => set("status", k)}>${v.label}</button>`)}</div></${Field}>
    <${Field} label="Priority"><div class="seg">${[1, 2, 3].map((p) => html`<button type="button" key=${p} class=${f.priority === p ? "on" : ""} onClick=${() => set("priority", p)}>${PRIORITY[p].label}</button>`)}</div></${Field}>
    <${Field} label="Job description"><textarea rows="4" value=${f.description} onInput=${(e) => set("description", e.target.value)} placeholder="Scope of work, gate codes, client notes…"></textarea></${Field}>
    ${isNew && html`<${Field} label="Crew"><${PeoplePicker} value=${f.crew} onChange=${(v) => set("crew", v)} /></${Field}>`}
    ${confirmDel && html`<${Confirm} title="Delete this job?" text=${`“${job.title}” and all its tasks, notes, photos and time logs will be deleted. Tip: mark it Complete instead to keep the records.`}
      onClose=${() => setConfirmDel(false)} onOk=${async () => { if (await act(() => api.remove("jobs", { id: job.id }), "Job deleted")) { onClose(); go("/"); } }} />`}
  </${Sheet}>`;
}
