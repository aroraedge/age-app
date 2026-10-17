// App entry: sign-in, app shell, navigation and the Jobs dashboard.
import { CONFIG } from "./config.js";
import * as api from "./api.js";
import {
  html, render, useState, useEffect, useMemo,
  S, setS, useStore, loadAll, act, toast, friendlyError, isBoss, jobById, crewOf, isMember, tasksOf, progressOf,
  onSiteAt, openLogFor, unreadCount, useRoute, firstName, go, today, fmtDate, fmtTime, fmtRange, STATUS, I, Empty,
} from "./lib.js";
import { JobPage, JobForm } from "./job.js";
import { BoardPage, SchedulePage, TeamPage, AlertsPage, MePage, PushBanner } from "./screens.js";

// ---------------------------------------------------------------- boot
async function boot() {
  try { setS({ seenAlertsAt: localStorage.getItem("seenAlertsAt") || "" }); } catch (_) { /* private mode */ }
  await api.initApi();
  const session = await api.auth.session();
  setS({ session });
  if (session) await loadAll(); else setS({ ready: true });
  api.auth.onChange(async (s) => {
    const changed = s?.user_id !== S.session?.user_id;
    setS({ session: s });
    if (s && changed) { setS({ ready: false }); await loadAll(); }
    if (!s) setS({ me: null, ready: true });
  });
  // keep data fresh
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && S.me && loadAll());
  setInterval(() => document.visibilityState === "visible" && S.me?.status === "active" && loadAll(), 60000);
  // Demo previews skip the service worker; the live app needs it for install + push.
  if ("serviceWorker" in navigator && !api.DEMO) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

// ---------------------------------------------------------------- root
function Root() {
  const s = useStore();
  if (!s.ready) return html`<div class="loading"><div class="spinner"></div></div>`;
  if (!s.session) return html`<${Auth} />${s.toast && html`<div class="toast ${s.toast.kind}">${s.toast.text}</div>`}`;
  if (!s.me || s.me.status !== "active") return html`<${Pending} />`;
  return html`<${Shell} />`;
}

// ---------------------------------------------------------------- auth
function Auth() {
  const [mode, setMode] = useState("in"); // in | up | reset
  const [f, setF] = useState({ name: "", email: "", pw: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      if (mode === "in") await api.auth.signIn(f.email, f.pw);
      if (mode === "up") {
        if (f.pw.length < 8) throw new Error("Use at least 8 characters for your password.");
        const r = await api.auth.signUp(f.name.trim(), f.email, f.pw);
        if (r.needsConfirm) setMsg("Check your email and tap the link to finish signing up, then come back here and sign in.");
      }
      if (mode === "reset") { await api.auth.resetPassword(f.email); setMsg("If that email has an account, a reset link is on its way."); }
    } catch (err) { toast(friendlyError(err), "error"); }
    setBusy(false);
  }
  async function demo(role) {
    api.auth.demoSignIn(role);
    setS({ session: await api.auth.session(), ready: false });
    await loadAll();
  }

  return html`<div class="auth">
    <img class="auth-logo only-light" src="icons/logo-dark.png" alt=${CONFIG.COMPANY_NAME} />
    <img class="auth-logo only-dark" src="icons/logo-light.png" alt="" />
    <h1>${mode === "up" ? "Create your account" : mode === "reset" ? "Reset password" : "Welcome back"}</h1>
    <p class="sub">${mode === "up" ? "A boss approves new accounts before you can see jobs." : mode === "reset" ? "We'll email you a link to set a new password." : "Sign in to see your jobs, tasks and schedule."}</p>
    ${msg && html`<div class="banner"><div class="grow">${msg}</div></div>`}
    ${!api.DEMO && html`<form onSubmit=${submit}>
      ${mode === "up" && html`<label class="field"><span class="field-label">Full name</span><input type="text" required autocomplete="name" value=${f.name} onInput=${set("name")} /></label>`}
      <label class="field"><span class="field-label">Email</span><input type="email" required autocomplete="email" value=${f.email} onInput=${set("email")} /></label>
      ${mode !== "reset" && html`<label class="field"><span class="field-label">Password</span><input type="password" required autocomplete=${mode === "up" ? "new-password" : "current-password"} value=${f.pw} onInput=${set("pw")} /></label>`}
      <button class="btn block big" disabled=${busy}>${busy ? "One sec…" : mode === "in" ? "Sign in" : mode === "up" ? "Create account" : "Send reset link"}</button>
    </form>
    <div class="row spread" style="margin-top:16px">
      ${mode === "in" ? html`<a href="#" onClick=${(e) => { e.preventDefault(); setMode("up"); }}>New here? Create account</a>
        <a href="#" onClick=${(e) => { e.preventDefault(); setMode("reset"); }}>Forgot password?</a>`
      : html`<a href="#" onClick=${(e) => { e.preventDefault(); setMode("in"); setMsg(""); }}>← Back to sign in</a>`}
    </div>`}
    ${api.DEMO && html`<div class="demo-box">
      <strong>Demo mode</strong>
      <p class="muted small">This preview uses sample data saved only in this browser. Pick a role to look around:</p>
      <div class="stack-v">
        <button class="btn block big" onClick=${() => demo("boss")}>Try as a Boss</button>
        <button class="btn block big dark" onClick=${() => demo("employee")}>Try as an Employee</button>
      </div>
    </div>`}
  </div>`;
}

function Pending() {
  const s = useStore();
  return html`<div class="auth">
    <div class="auth-ic">${I.clock}</div>
    <h1>${s.me?.status === "disabled" ? "Account turned off" : "Almost there"}</h1>
    <p class="sub">${s.me?.status === "disabled"
      ? "A boss has turned off this account. Talk to your boss if this is a mistake."
      : "Your account is waiting for a boss to approve it. Once they do, pull down or tap below to refresh."}</p>
    <button class="btn block big" onClick=${() => loadAll()}>Check again</button>
    <button class="btn block ghost" style="margin-top:10px" onClick=${() => api.auth.signOut().then(() => setS({ session: null, me: null }))}>Sign out</button>
  </div>`;
}

// ---------------------------------------------------------------- shell
function Shell() {
  const s = useStore();
  const route = useRoute();
  const [top] = route;
  const boss = isBoss();
  const unread = unreadCount();

  let page;
  if (top === "job" && route[1]) page = html`<${JobPage} id=${route[1]} tab=${route[2] || "timeline"} />`;
  else if (top === "board" && boss) page = html`<${BoardPage} />`;
  else if (top === "schedule") page = html`<${SchedulePage} />`;
  else if (top === "team") page = html`<${TeamPage} />`;
  else if (top === "alerts") page = html`<${AlertsPage} />`;
  else if (top === "me") page = html`<${MePage} />`;
  else page = html`<${Dashboard} />`;

  const tabs = [
    ["/", "Jobs", I.jobs, !top || top === "job"],
    ["/schedule", "Schedule", I.calendar, top === "schedule"],
    boss && ["/board", "Assign", I.board, top === "board"],
    ["/team", "Team", I.team, top === "team"],
    ["/me", "Me", I.me, top === "me"],
  ].filter(Boolean);

  return html`<div class="app">
    ${api.DEMO && html`<div class="demo-banner">Demo · viewing as ${firstName(s.me)} (${boss ? "Boss" : "Employee"})</div>`}
    ${top !== "job" && html`<header class="topbar">
      <a class="brand" href="#/" style="color:inherit;text-decoration:none">
        <img class="brand-logo" src="icons/logo-light.png" alt=${CONFIG.COMPANY_NAME} />
      </a>
      <a class="icon-btn" href="#/alerts" aria-label="Alerts">${I.bell}${unread > 0 && html`<span class="badge">${unread > 9 ? "9+" : unread}</span>`}</a>
    </header>`}
    ${page}
    <nav class="bottomnav"><div class="bottomnav-inner">
      ${tabs.map(([href, label, icon, on]) => html`<a key=${href} href=${"#" + href} class=${on ? "on" : ""}>${icon}<span>${label}</span></a>`)}
    </div></nav>
    ${s.toast && html`<div class="toast ${s.toast.kind}">${s.toast.text}</div>`}
  </div>`;
}

// ---------------------------------------------------------------- dashboard
function Dashboard() {
  const s = useStore();
  const boss = isBoss();
  const [filter, setFilter] = useState(() => { try { return localStorage.getItem("jobFilter") || "open"; } catch (_) { return "open"; } });
  const [showNew, setShowNew] = useState(false);
  useEffect(() => { try { localStorage.setItem("jobFilter", filter); } catch (_) { /* ignore */ } }, [filter]);

  const mine = (j) => isMember(j.id);
  const sets = {
    open: (j) => j.status !== "done",
    mine: (j) => mine(j) && j.status !== "done",
    active: (j) => j.status === "active",
    planned: (j) => j.status === "planned",
    on_hold: (j) => j.status === "on_hold",
    done: (j) => j.status === "done",
  };
  const chips = [
    ["open", "All open"], !boss && ["mine", "My jobs"], ["active", "In progress"], ["planned", "Upcoming"], ["on_hold", "On hold"], ["done", "Complete"],
  ].filter(Boolean);
  const jobs = useMemo(() => s.jobs.filter(sets[filter] || sets.open).sort((a, b) =>
    (a.status === "active" ? 0 : 1) - (b.status === "active" ? 0 : 1) || a.priority - b.priority || (a.start_date || "").localeCompare(b.start_date || "")), [s.jobs, s.members, filter]);

  return html`<main class="page">
    <${PushBanner} />
    <${TodayCard} />
    ${boss && html`<div class="stats">
      <div class="stat"><b>${s.jobs.filter((j) => j.status === "active").length}</b><span>Active jobs</span></div>
      <div class="stat"><b>${new Set(s.openLogs.map((l) => l.user_id)).size}</b><span>On site now</span></div>
      <div class="stat"><b>${s.tasks.filter((t) => t.status !== "done" && jobById(t.job_id)?.status !== "done").length}</b><span>Open tasks</span></div>
    </div>`}
    <div class="page-head"><h1>Jobs</h1></div>
    <div class="chips">${chips.map(([k, label]) => html`<button key=${k} class="chip ${filter === k ? "on" : ""}" onClick=${() => setFilter(k)}>${label}<span class="n">${s.jobs.filter(sets[k]).length}</span></button>`)}</div>
    ${jobs.length ? html`<div class="circles">${jobs.map((j) => html`<${JobCircle} key=${j.id} job=${j} />`)}</div>`
      : html`<${Empty} icon=${I.jobs} title="No jobs here" text=${boss ? "Tap “New job” to add your first one." : filter === "mine" ? "You're not on any open jobs yet. Check “All open” to join one." : "Nothing in this list right now."} />`}
    ${boss && html`<button class="fab" onClick=${() => setShowNew(true)}>${I.plus} New job</button>`}
    ${showNew && html`<${JobForm} onClose=${() => setShowNew(false)} onSaved=${(id) => go("/job/" + id)} />`}
  </main>`;
}

function JobCircle({ job }) {
  const pct = progressOf(job.id);
  const onsite = onSiteAt(job.id).length;
  const crew = crewOf(job.id).length;
  const n = tasksOf(job.id).length;
  return html`<a class="circle-item" href=${"#/job/" + job.id}>
    <div class="circle c-${job.status}" style=${`--p:${pct}`}>
      ${job.priority === 1 && job.status !== "done" && html`<span class="hi" title="High priority">!</span>`}
      <div class="circle-inner">
        <strong>${job.title}</strong>
        <span class="pct">${n ? `${pct}% done` : STATUS[job.status].label}</span>
      </div>
      ${onsite > 0 && html`<span class="live">${onsite} on site</span>`}
    </div>
    <div class="circle-meta">${fmtRange(job.start_date, job.end_date)}<br />${crew} crew${job.start_time ? ` · ${fmtTime(job.start_time)}` : ""}</div>
  </a>`;
}

// What's happening today for me
function TodayCard() {
  const s = useStore();
  const t = today();
  const dow = ((new Date().getDay() + 6) % 7) + 1;
  const items = [];
  const seen = new Set();
  for (const sh of s.shifts.filter((x) => x.work_date === t && x.user_id === s.me.id)) {
    const job = jobById(sh.job_id);
    if (!job) continue;
    seen.add(job.id);
    items.push({ job, time: sh.start_time || job.start_time });
  }
  for (const job of s.jobs) {
    if (seen.has(job.id) || !isMember(job.id) || !["active", "planned"].includes(job.status)) continue;
    if (job.start_date && job.start_date <= t && (job.end_date || job.start_date) >= t && (job.work_days || []).includes(dow)) {
      items.push({ job, time: job.start_time });
    }
  }
  if (!items.length) return null;
  items.sort((a, b) => (a.time || "99").localeCompare(b.time || "99"));
  return html`<section class="today-card">
    <h3>Today · ${fmtDate(t, { weekday: "long", month: "short", day: "numeric" })}</h3>
    ${items.map(({ job, time }) => {
      const open = openLogFor(job.id);
      return html`<div class="today-row" key=${job.id}>
        <span class="t">${time ? fmtTime(time).replace(" ", "") : "—"}</span>
        <a class="grow" href=${"#/job/" + job.id} style="color:inherit;text-decoration:none"><strong>${job.title}</strong><div class="small" style="opacity:.75">${job.address || ""}</div></a>
        ${open
          ? html`<button class="btn sm ghost" onClick=${() => act(() => api.update("time_logs", { id: open.id }, { departed_at: new Date().toISOString() }), "Clocked out. Nice work!")}>Leave</button>`
          : html`<button class="btn sm" onClick=${() => act(() => api.insert("time_logs", { job_id: job.id, user_id: s.me.id }), "You're clocked in")}>I'm here</button>`}
      </div>`;
    })}
  </section>`;
}

boot();
render(html`<${Root} />`, document.getElementById("root"));
