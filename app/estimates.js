// Estimates (bosses only): upload, track status, approve → creates the job.
import * as api from "./api.js";
import {
  html, useState, useEffect, useRef,
  useStore, act, toast, isBoss, person, jobById, go, fmtDate, fmtTime, ago, firstName,
  I, Avatar, Sheet, Field, Empty, Confirm,
} from "./lib.js";

export const EST_STATUS = {
  pending: { label: "Waiting on approval", short: "Waiting", cls: "es-pending" },
  on_hold: { label: "On hold", short: "On hold", cls: "es-hold" },
  approved: { label: "Approved", short: "Approved", cls: "es-approved" },
  declined: { label: "Declined", short: "Declined", cls: "es-declined" },
};
const money = (n) => (n == null || n === "" ? "" : Number(n).toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: Number(n) % 1 ? 2 : 0 }));

export function EstimatesPage() {
  const s = useStore();
  const [rows, setRows] = useState(null);
  const [versions, setVersions] = useState([]);
  const [notes, setNotes] = useState([]);
  const [filter, setFilter] = useState(() => { try { return localStorage.getItem("estFilter") || "pending"; } catch (_) { return "pending"; } });
  const [sheet, setSheet] = useState(null);
  useEffect(() => { try { localStorage.setItem("estFilter", filter); } catch (_) { /* ignore */ } }, [filter]);

  async function reload() {
    try { setRows(await api.list("estimates", { order: ["created_at", false] })); } catch (e) { console.error(e); setRows([]); }
    try { setVersions(await api.list("estimate_versions", { order: ["version"] })); } catch (_) { setVersions([]); }
    try { setNotes(await api.list("estimate_notes", { order: ["created_at"] })); } catch (_) { setNotes([]); }
  }
  useEffect(() => { reload(); }, [s.jobs]);

  if (!isBoss()) return html`<main class="page"><${Empty} icon=${I.estimate} title="Bosses only" text="Estimates are only visible to bosses." /></main>`;

  const list = rows || [];
  const count = (k) => list.filter((e) => e.status === k).length;
  const shown = filter === "all" ? list : list.filter((e) => e.status === filter);
  const waitingTotal = list.filter((e) => e.status === "pending").reduce((a, e) => a + Number(e.amount || 0), 0);
  const approvedTotal = list.filter((e) => e.status === "approved").reduce((a, e) => a + Number(e.amount || 0), 0);

  return html`<main class="page">
    <div class="page-head"><h1>Estimates</h1><button class="btn sm" onClick=${() => setSheet({})}>${I.plus} Estimate</button></div>
    <div class="stats" style="grid-template-columns:1fr 1fr">
      <div class="stat"><b>${money(waitingTotal) || "$0"}</b><span>${count("pending")} waiting on approval</span></div>
      <div class="stat"><b>${money(approvedTotal) || "$0"}</b><span>${count("approved")} approved</span></div>
    </div>
    <div class="chips">
      ${[["pending", "Waiting"], ["on_hold", "On hold"], ["approved", "Approved"], ["declined", "Declined"], ["all", "All"]].map(([k, l]) => html`
        <button key=${k} class="chip ${filter === k ? "on" : ""}" onClick=${() => setFilter(k)}>${l}<span class="n">${k === "all" ? list.length : count(k)}</span></button>`)}
    </div>
    ${rows === null ? html`<div class="loading" style="min-height:160px"><div class="spinner"></div></div>`
      : shown.length ? html`<div class="est-list">${shown.map((e) => html`<${EstimateCard} key=${e.id} est=${e} vers=${versions.filter((v) => v.estimate_id === e.id)} noteCount=${notes.filter((n) => n.estimate_id === e.id).length} onOpen=${() => setSheet({ est: e })} />`)}</div>`
      : html`<${Empty} icon=${I.estimate} title=${filter === "all" ? "No estimates yet" : `Nothing ${EST_STATUS[filter]?.short.toLowerCase() || ""}`}
          text=${filter === "pending" || filter === "all" ? "Tap “+ Estimate” to upload one. When a boss approves it, the job is created automatically." : ""} />`}
    ${sheet && html`<${EstimateSheet} est=${sheet.est && (list.find((x) => x.id === sheet.est.id) || sheet.est)}
      versions=${sheet.est ? versions.filter((v) => v.estimate_id === sheet.est.id) : []} notes=${sheet.est ? notes.filter((n) => n.estimate_id === sheet.est.id) : []}
      onClose=${() => setSheet(null)} onSaved=${reload} />`}
  </main>`;
}

function EstimateCard({ est, vers, noteCount, onOpen }) {
  const st = EST_STATUS[est.status] || EST_STATUS.pending;
  const curV = vers.length ? Math.max(...vers.map((v) => v.version)) : null;
  return html`<button class="est-card ${st.cls}" onClick=${onOpen}>
    <span class="grow" style="min-width:0">
      <span class="est-top">${est.number ? html`<span class="est-no">#${est.number}</span>` : ""}${curV && html`<span class="ver-badge">V${curV}</span>`}<span class="est-pill ${st.cls}">${st.short}${est.status === "approved" && est.approved_version ? ` · V${est.approved_version}` : ""}</span></span>
      <strong class="est-title">${est.title}</strong>
      <span class="small muted">${[est.client, est.address].filter(Boolean).join(" · ") || "No client details"}</span>
      <span class="small muted">${est.status === "pending" || est.status === "on_hold" ? `Added ${ago(est.created_at)}` : est.decided_at ? `${st.short} ${fmtDate(est.decided_at)}${est.decided_by ? " by " + firstName(person(est.decided_by)) : ""}` : ""}
        ${est.file_path ? " · PDF attached" : ""}${noteCount ? ` · ${noteCount} ${noteCount === 1 ? "note" : "notes"}` : ""}</span>
    </span>
    <span class="est-amt">${money(est.amount)}</span>
  </button>`;
}

function EstimateSheet({ est, versions = [], notes = [], onClose, onSaved }) {
  const s = useStore();
  const isNew = !est;
  const input = useRef();
  const [f, setF] = useState(() => ({
    title: est?.title || "", number: est?.number || "", client: est?.client || "", client_phone: est?.client_phone || "", client_email: est?.client_email || "",
    address: est?.address || "", amount: est?.amount ?? "", proposed_start: est?.proposed_start || "", proposed_end: est?.proposed_end || "",
    description: est?.description || "", file_path: est?.file_path || null, file_name: est?.file_name || null,
  }));
  const [busy, setBusy] = useState(false);
  const [fileUrl, setFileUrl] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const set = (k, v) => setF({ ...f, [k]: v });
  const job = est?.job_id && jobById(est.job_id);
  // A new version can change the amount; keep the form in step so saving never undoes it.
  useEffect(() => { if (est) setF((cur) => ({ ...cur, amount: est.amount ?? "" })); }, [est?.amount]);

  useEffect(() => { if (f.file_path) api.photoUrls([f.file_path]).then((m) => setFileUrl(m[f.file_path])).catch(() => {}); else setFileUrl(null); }, [f.file_path]);

  async function pickFile(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const up = await api.uploadEstimateFile(s.me.id, file);
      const name = file.name.replace(/\.[^.]+$/, "");
      setF((cur) => ({ ...cur, ...up, title: cur.title || name }));
      toast("File attached");
    } catch (err) { toast(err.message || "Upload failed", "error"); }
    setBusy(false);
  }

  function row() {
    const amt = String(f.amount).replace(/[$,\s]/g, "");
    if (amt && isNaN(Number(amt))) throw new Error("Amount should be a number, like 18450 or 18,450.00");
    return {
      title: f.title.trim(), number: f.number.trim() || null, client: f.client.trim() || null, client_phone: f.client_phone.trim() || null,
      client_email: f.client_email.trim() || null, address: f.address.trim() || null, amount: amt ? Number(amt) : null,
      proposed_start: f.proposed_start || null, proposed_end: f.proposed_end || null, description: f.description.trim() || null,
      ...(isNew ? { file_path: f.file_path, file_name: f.file_name } : {}),
    };
  }
  async function save(extra = {}) {
    if (!f.title.trim()) { toast("Give the estimate a name", "error"); return false; }
    if (f.proposed_end && f.proposed_start && f.proposed_end < f.proposed_start) { toast("End date is before the start date", "error"); return false; }
    let r; try { r = row(); } catch (e) { toast(e.message, "error"); return false; }
    let id = est?.id;
    const ok = await act(async () => {
      if (isNew) {
        id = (await api.insert("estimates", { ...r, ...extra, status: extra.status || "pending", created_by: s.me.id }))[0].id;
        if (r.file_path) await api.addEstimateVersion(id, s.me.id, { file_path: r.file_path, file_name: r.file_name, amount: r.amount, note: "Original" });
      }
      else await api.update("estimates", { id }, { ...r, ...extra });
    });
    return ok ? id : false;
  }
  async function setStatus(status) {
    const id = await save({ status, decided_by: status === "pending" ? null : s.me.id, decided_at: status === "pending" ? null : new Date().toISOString() });
    if (id) { toast(`Marked ${EST_STATUS[status].short.toLowerCase()}`); onSaved(); onClose(); }
  }
  async function approve() {
    const id = await save();
    if (!id) return;
    const jobId = await act(() => api.approveEstimate(id, s.me.id));
    if (jobId) { toast("Approved. Job created"); onSaved(); onClose(); go("/job/" + jobId); }
  }

  const status = est?.status || "pending";
  return html`<${Sheet} title=${isNew ? "New estimate" : `Estimate${est.number ? " #" + est.number : ""}`} onClose=${onClose}
    footer=${html`${!isNew && html`<button class="icon-btn" onClick=${() => setConfirm("delete")} aria-label="Delete estimate">${I.trash}</button>`}
      <button class="btn ghost" onClick=${onClose}>Cancel</button>
      <button class="btn" disabled=${busy} onClick=${async () => { if (await save()) { toast(isNew ? "Estimate added" : "Saved"); onSaved(); onClose(); } }}>${isNew ? "Add estimate" : "Save"}</button>`}>

    ${!isNew && html`<div class="est-status-box ${EST_STATUS[status].cls}">
      <div class="row spread"><span class="est-pill ${EST_STATUS[status].cls}">${EST_STATUS[status].label}</span>
        ${est.decided_at && html`<span class="small muted">${fmtDate(est.decided_at)}${est.decided_by ? " · " + firstName(person(est.decided_by)) : ""}</span>`}</div>
      ${job && html`<button class="btn block dark" style="margin-top:10px" onClick=${() => { onClose(); go("/job/" + job.id); }}>Open job: ${job.title}</button>`}
      <div class="est-actions">
        ${status !== "approved" && html`<button class="btn" onClick=${() => setConfirm("approve")}>${I.check} Approve</button>`}
        ${status !== "on_hold" && status !== "approved" && html`<button class="btn ghost" onClick=${() => setStatus("on_hold")}>On hold</button>`}
        ${status !== "declined" && status !== "approved" && html`<button class="btn ghost" onClick=${() => setStatus("declined")}>Decline</button>`}
        ${status !== "pending" && status !== "approved" && html`<button class="btn ghost" onClick=${() => setStatus("pending")}>Back to waiting</button>`}
      </div>
    </div>`}

    ${isNew ? html`<${Field} label="Estimate PDF">
      <input ref=${input} type="file" accept="application/pdf,image/*" class="hidden" onChange=${pickFile} />
      ${f.file_path ? html`<div class="li" style="border:1px solid var(--line);border-radius:12px">
          <span class="pdf-ic">PDF</span>
          <a class="grow" href=${fileUrl || "#"} target="_blank" rel="noopener" style="color:inherit;text-decoration:none;min-width:0"><strong style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${f.file_name || "Estimate.pdf"}</strong><span class="small">Tap to open</span></a>
          <button class="btn sm ghost" disabled=${busy} onClick=${() => input.current.click()}>Replace</button></div>`
        : html`<button class="btn block soft" disabled=${busy} onClick=${() => input.current.click()}>${busy ? "Uploading…" : html`${I.plus} Upload PDF`}</button>`}
    </${Field}>` : html`<${VersionsPanel} est=${est} versions=${versions} onChanged=${onSaved} />`}
    <${Field} label="Job name"><input type="text" value=${f.title} onInput=${(e) => set("title", e.target.value)} placeholder="e.g. Johnson Deck Build" /></${Field}>
    <div class="two">
      <${Field} label="Estimate #"><input type="text" value=${f.number} onInput=${(e) => set("number", e.target.value)} /></${Field}>
      <${Field} label=${isNew ? "Amount" : "Amount (current)"}><input type="text" inputmode="decimal" value=${f.amount} onInput=${(e) => set("amount", e.target.value)} placeholder="$0.00" /></${Field}>
    </div>
    <${Field} label="Client"><input type="text" value=${f.client} onInput=${(e) => set("client", e.target.value)} /></${Field}>
    <div class="two">
      <${Field} label="Client phone"><input type="tel" value=${f.client_phone} onInput=${(e) => set("client_phone", e.target.value)} /></${Field}>
      <${Field} label="Client email"><input type="email" value=${f.client_email} onInput=${(e) => set("client_email", e.target.value)} /></${Field}>
    </div>
    <${Field} label="Job address"><input type="text" value=${f.address} autocomplete="street-address" onInput=${(e) => set("address", e.target.value)} /></${Field}>
    <div class="two">
      <${Field} label="Proposed start"><input type="date" value=${f.proposed_start} onInput=${(e) => set("proposed_start", e.target.value)} /></${Field}>
      <${Field} label="Proposed end"><input type="date" value=${f.proposed_end} onInput=${(e) => set("proposed_end", e.target.value)} /></${Field}>
    </div>
    <${Field} label="Scope of work"><textarea rows="4" value=${f.description} onInput=${(e) => set("description", e.target.value)} placeholder="What the estimate covers"></textarea></${Field}>
    ${!isNew && html`<${NotesPanel} est=${est} notes=${notes} onChanged=${onSaved} />`}
    ${isNew && html`<p class="small muted">New estimates start as “Waiting on approval.” Approving one creates the job with these details and files the PDF in the job's ICR folder.</p>`}

    ${confirm === "approve" && html`<${Confirm} title="Approve this estimate?" okLabel="Approve & create job" okClass=""
      text=${job ? "It's already linked to a job, so no new job will be created." : `This creates the job “${f.title || "Untitled"}” with this estimate's details and files the PDF in its ICR folder.`}
      onClose=${() => setConfirm(null)} onOk=${approve} />`}
    ${confirm === "delete" && html`<${Confirm} title="Delete this estimate?" text=${job ? "The job it created stays. Only the estimate record is removed." : "This can't be undone."}
      onClose=${() => setConfirm(null)} onOk=${async () => { if (await act(() => api.remove("estimates", { id: est.id }), "Estimate deleted")) { onSaved(); onClose(); } }} />`}
  </${Sheet}>`;
}

// ------------------------------------------------------------ versions
function VersionsPanel({ est, versions, onChanged }) {
  const s = useStore();
  const input = useRef();
  const [urls, setUrls] = useState({});
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ file_path: null, file_name: null, amount: "", note: "" });
  const [busy, setBusy] = useState(false);
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const cur = sorted[0]?.version || 0;
  const next = cur + 1;

  useEffect(() => {
    const paths = versions.map((v) => v.file_path).filter(Boolean).filter((p) => !p.startsWith("data:"));
    const data = Object.fromEntries(versions.filter((v) => v.file_path?.startsWith("data:")).map((v) => [v.file_path, v.file_path]));
    if (paths.length) api.photoUrls(paths).then((m) => setUrls({ ...m, ...data })).catch(() => setUrls(data)); else setUrls(data);
  }, [versions.length]);

  async function pick(e) {
    const file = e.target.files[0]; e.target.value = "";
    if (!file) return;
    setBusy(true);
    try { const up = await api.uploadEstimateFile(s.me.id, file); setDraft((d) => ({ ...d, ...up })); }
    catch (err) { toast(err.message || "Upload failed", "error"); }
    setBusy(false);
  }
  async function saveVersion() {
    const amt = String(draft.amount).replace(/[$,\s]/g, "");
    if (amt && isNaN(Number(amt))) return toast("Amount should be a number", "error");
    if (!draft.file_path && !amt && !draft.note.trim()) return toast("Add a PDF, a new amount or a note about what changed", "error");
    setBusy(true);
    const v = await act(() => api.addEstimateVersion(est.id, s.me.id, { file_path: draft.file_path, file_name: draft.file_name, amount: amt ? Number(amt) : null, note: draft.note.trim() || null }));
    setBusy(false);
    if (v) { toast(`Saved as V${v}${est.job_id && draft.file_path ? " · also filed in the job's ICR folder" : ""}`); setAdding(false); setDraft({ file_path: null, file_name: null, amount: "", note: "" }); onChanged(); }
  }

  return html`<div class="field">
    <div class="row spread" style="margin-bottom:6px"><span class="field-label" style="margin:0">Versions</span>
      ${!adding && html`<button class="btn sm soft" onClick=${() => setAdding(true)}>${I.plus} New version (V${next})</button>`}</div>

    ${adding && html`<div class="ver-new">
      <strong>New version · V${next}</strong>
      <input ref=${input} type="file" accept="application/pdf,image/*" class="hidden" onChange=${pick} />
      ${draft.file_path ? html`<div class="row"><span class="pdf-ic">PDF</span><span class="grow" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${draft.file_name}</span>
          <button class="btn sm ghost" onClick=${() => input.current.click()}>Change</button></div>`
        : html`<button class="btn block ghost" disabled=${busy} onClick=${() => input.current.click()}>${busy ? "Uploading…" : html`${I.plus} Upload revised PDF`}</button>`}
      <div class="two">
        <label class="field" style="margin:0"><span class="field-label">New amount</span><input type="text" inputmode="decimal" placeholder=${money(est.amount) || "$0.00"} value=${draft.amount} onInput=${(e) => setDraft({ ...draft, amount: e.target.value })} /></label>
        <span></span>
      </div>
      <label class="field" style="margin:0"><span class="field-label">What changed</span><input type="text" maxlength="200" placeholder="e.g. Added gate, switched to cedar" value=${draft.note} onInput=${(e) => setDraft({ ...draft, note: e.target.value })} /></label>
      <div class="row" style="gap:8px"><button class="btn ghost grow" onClick=${() => setAdding(false)}>Cancel</button><button class="btn grow" disabled=${busy} onClick=${saveVersion}>Save V${next}</button></div>
    </div>`}

    ${sorted.length ? html`<div class="list">${sorted.map((v) => html`<div class="li ver-row" key=${v.id}>
        <span class="ver-badge ${v.version === cur ? "cur" : ""}">V${v.version}</span>
        <span class="grow" style="min-width:0">
          <strong>${v.version === cur ? "Current" : fmtDate(v.created_at)}${est.approved_version === v.version ? html` <span class="est-pill es-approved">Approved</span>` : ""}</strong>
          <span class="small">${[v.note, money(v.amount), `${firstName(person(v.created_by))} · ${fmtDate(v.created_at)}`].filter(Boolean).join(" · ")}</span>
        </span>
        ${v.file_path && urls[v.file_path] ? html`<a class="btn sm ghost" href=${urls[v.file_path]} target="_blank" rel="noopener">Open</a>` : v.file_path ? "" : html`<span class="small muted">No PDF</span>`}
      </div>`)}</div>`
      : html`<p class="small muted" style="margin:0">No versions yet. Upload the estimate PDF as V1.</p>`}
  </div>`;
}

// ------------------------------------------------------------ notes
function NotesPanel({ est, notes, onChanged }) {
  const s = useStore();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(null);
  async function add() {
    if (!text.trim()) return;
    setBusy(true);
    const ok = await act(() => api.insert("estimate_notes", { estimate_id: est.id, user_id: s.me.id, body: text.trim() }));
    setBusy(false);
    if (ok) { setText(""); onChanged(); }
  }
  const sorted = [...notes].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return html`<div class="field">
    <span class="field-label">Notes · ${notes.length}</span>
    <div class="composer" style="margin-bottom:10px">
      <textarea rows="2" placeholder="Add a note (only bosses see these)" value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
      <button class="btn" disabled=${busy || !text.trim()} onClick=${add} aria-label="Add note">${I.send}</button>
    </div>
    ${sorted.map((n) => html`<div class="est-note" key=${n.id}>
      <${Avatar} id=${n.user_id} size=${28} />
      <div class="grow" style="min-width:0">
        <div class="small"><strong>${person(n.user_id)?.full_name || "Former member"}</strong> <span class="muted">${fmtDate(n.created_at)} ${fmtTime(n.created_at)}</span>
          ${n.user_id === s.me.id && html`<button class="linkish" style="float:right;padding:0;color:var(--muted)" onClick=${() => setDel(n)}>Delete</button>`}</div>
        <div style="white-space:pre-wrap;margin-top:2px">${n.body}</div>
      </div>
    </div>`)}
    ${del && html`<${Confirm} title="Delete this note?" text="This can't be undone." onClose=${() => setDel(null)}
      onOk=${async () => { if (await act(() => api.remove("estimate_notes", { id: del.id }), "Note deleted")) onChanged(); }} />`}
  </div>`;
}
