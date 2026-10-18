// Data layer. Talks to Supabase when configured, otherwise runs a local
// demo database stored on this device so the app can be tried instantly.
import { CONFIG } from "./config.js";

export const DEMO = !CONFIG.SUPABASE_URL;
let sb = null;

const uuid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  }));

export async function initApi() {
  if (DEMO) { demoEnsureSeed(); return; }
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
}

// ------------------------------------------------------------------ auth
export const auth = {
  async session() {
    if (DEMO) return demoGet("session");
    const { data } = await sb.auth.getSession();
    return data.session ? { user_id: data.session.user.id, email: data.session.user.email } : null;
  },
  onChange(cb) {
    if (DEMO) return () => {};
    const { data } = sb.auth.onAuthStateChange((_e, s) => cb(s ? { user_id: s.user.id, email: s.user.email } : null));
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    if (DEMO) throw new Error("Demo mode: use the demo buttons below.");
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  },
  async signUp(full_name, email, password) {
    if (DEMO) throw new Error("Demo mode: use the demo buttons below.");
    const { data, error } = await sb.auth.signUp({
      email: email.trim(), password,
      options: { data: { full_name }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
    return { needsConfirm: !data.session };
  },
  async resetPassword(email) {
    if (DEMO) return;
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.origin + location.pathname });
    if (error) throw error;
  },
  async updatePassword(password) {
    if (DEMO) return;
    const { error } = await sb.auth.updateUser({ password });
    if (error) throw error;
  },
  async signOut() {
    if (DEMO) { demoSet("session", null); return; }
    await sb.auth.signOut();
  },
  demoSignIn(role) {
    const db = demoDb();
    const p = db.profiles.find((x) => x.role === role && x.status === "active");
    demoSet("session", { user_id: p.id, email: p.email });
  },
};

// ------------------------------------------------------------- generic CRUD
// filters: { eq:{col:val}, in:{col:[...]}, gte:{col:val}, lte:{col:val}, isNull:[col], order:[col, asc] }
export async function list(table, f = {}) {
  if (DEMO) return demoList(table, f);
  let q = sb.from(table).select("*");
  for (const [k, v] of Object.entries(f.eq || {})) q = q.eq(k, v);
  for (const [k, v] of Object.entries(f.in || {})) q = q.in(k, v);
  for (const [k, v] of Object.entries(f.gte || {})) q = q.gte(k, v);
  for (const [k, v] of Object.entries(f.lte || {})) q = q.lte(k, v);
  for (const k of f.isNull || []) q = q.is(k, null);
  if (f.order) q = q.order(f.order[0], { ascending: f.order[1] !== false });
  if (f.limit) q = q.limit(f.limit);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function insert(table, rows) {
  const arr = Array.isArray(rows) ? rows : [rows];
  if (DEMO) return demoInsert(table, arr);
  const { data, error } = await sb.from(table).insert(arr).select();
  if (error) throw error;
  return data;
}

export async function update(table, match, patch) {
  if (DEMO) return demoUpdate(table, match, patch);
  let q = sb.from(table).update(patch);
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { data, error } = await q.select();
  if (error) throw error;
  return data;
}

export async function remove(table, match) {
  if (DEMO) return demoRemove(table, match);
  let q = sb.from(table).delete();
  for (const [k, v] of Object.entries(match)) q = q.eq(k, v);
  const { error } = await q;
  if (error) throw error;
}

// ---------------------------------------------------------------- photos
async function shrinkImage(file, max = 1600, quality = 0.82) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bitmap.width * scale);
  c.height = Math.round(bitmap.height * scale);
  c.getContext("2d").drawImage(bitmap, 0, 0, c.width, c.height);
  return await new Promise((res) => c.toBlob((b) => res(b || file), "image/jpeg", quality));
}

// Uploads a photo or PDF into one of a job's folders (icr | design | photos).
export const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
export const isImage = (f) => (f.type || "").startsWith("image/") || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(f.name || "");
const MAX_PDF_MB = 25;

export async function uploadFile(jobId, userId, file, { folder = "photos", caption = "", task_id = null } = {}) {
  const pdf = isPdf(file);
  if (!pdf && !isImage(file)) throw new Error(`“${file.name}” isn't a photo or PDF.`);
  if (pdf && file.size > MAX_PDF_MB * 1024 * 1024) throw new Error(`“${file.name}” is over ${MAX_PDF_MB} MB.`);
  const blob = pdf ? file : await shrinkImage(file, DEMO ? 900 : 1600, DEMO ? 0.7 : 0.82);
  const mime = pdf ? "application/pdf" : "image/jpeg";
  const file_name = (file.name || (pdf ? "document.pdf" : "photo.jpg")).slice(0, 120);
  const meta = { job_id: jobId, user_id: userId, caption, folder, file_name, mime, size: blob.size, task_id: task_id || null };
  if (DEMO) {
    if (pdf && blob.size > 3 * 1024 * 1024) throw new Error("Demo mode only keeps PDFs under 3 MB.");
    const dataUrl = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
    return demoInsert("photos", [{ ...meta, path: dataUrl }]);
  }
  const path = `${userId}/${jobId}/${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${pdf ? "pdf" : "jpg"}`;
  const { error } = await sb.storage.from("job-photos").upload(path, blob, { contentType: mime });
  if (error) throw error;
  return insert("photos", { ...meta, path });
}
export const uploadPhoto = (jobId, userId, file, caption) => uploadFile(jobId, userId, file, { folder: "photos", caption });

const urlCache = new Map();
export async function photoUrls(paths) {
  if (DEMO) return Object.fromEntries(paths.map((p) => [p, p]));
  const need = paths.filter((p) => !urlCache.has(p));
  if (need.length) {
    const { data } = await sb.storage.from("job-photos").createSignedUrls(need, 60 * 60 * 6);
    (data || []).forEach((d) => d.signedUrl && urlCache.set(d.path, d.signedUrl));
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)]));
}

export async function deletePhoto(photo) {
  if (!DEMO) await sb.storage.from("job-photos").remove([photo.path]);
  await remove("photos", { id: photo.id });
}

// ---------------------------------------------------------- notifications
export async function sendPush({ title, body, target, job_id, user_ids }, me, everyoneIds) {
  if (DEMO) {
    let recipients = everyoneIds;
    if (target === "users") recipients = user_ids;
    if (target === "job") {
      const db = demoDb();
      const job = db.jobs.find((j) => j.id === job_id);
      recipients = [...new Set([...db.job_members.filter((m) => m.job_id === job_id && m.status === "approved").map((m) => m.user_id), job?.created_by].filter(Boolean))];
    }
    demoInsert("notifications", [{ title, body, job_id: job_id || null, kind: "message", recipients, created_by: me }]);
    return { recipients: recipients.length, devices: 0 };
  }
  const { data, error } = await sb.functions.invoke("send-push", { body: { title, body, target, job_id, user_ids } });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (_) { /* keep */ }
    throw new Error(msg);
  }
  return data;
}

const b64ToBytes = (b64) => {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export function pushSupport() {
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, standalone, ios, needsInstall: ios && !standalone, permission: "Notification" in window ? Notification.permission : "unsupported" };
}

export async function pushStatus() {
  const s = pushSupport();
  if (!s.supported) return { ...s, subscribed: false };
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return { ...s, subscribed: !!sub };
}

export async function enablePush(userId) {
  const s = pushSupport();
  if (s.needsInstall) throw new Error("On iPhone, add the app to your Home Screen first, then open it from there.");
  if (!s.supported) throw new Error("This browser doesn't support notifications.");
  if (DEMO) throw new Error("Demo preview: notifications switch on once the app is live on your phones.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notifications were blocked. Turn them on in your phone's settings for this app.");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(CONFIG.VAPID_PUBLIC_KEY) });
  const j = sub.toJSON();
  if (DEMO) return true;
  const existing = await list("push_subscriptions", { eq: { endpoint: j.endpoint } });
  if (!existing.length) await insert("push_subscriptions", { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth });
  return true;
}

// ================================================================== DEMO
const DKEY = "age-demo-v3";
function demoDb() { try { return JSON.parse(localStorage.getItem(DKEY)) || {}; } catch (_) { return memoryDb; } }
let memoryDb = {};
function demoSave(db) { memoryDb = db; try { localStorage.setItem(DKEY, JSON.stringify(db)); } catch (_) { /* storage full or blocked */ } }
function demoGet(k) { return demoDb()["_" + k] ?? null; }
function demoSet(k, v) { const db = demoDb(); db["_" + k] = v; demoSave(db); }

function matches(row, f) {
  for (const [k, v] of Object.entries(f.eq || {})) if (row[k] !== v) return false;
  for (const [k, v] of Object.entries(f.in || {})) if (!v.includes(row[k])) return false;
  for (const [k, v] of Object.entries(f.gte || {})) if (!(row[k] >= v)) return false;
  for (const [k, v] of Object.entries(f.lte || {})) if (!(row[k] <= v)) return false;
  for (const k of f.isNull || []) if (row[k] != null) return false;
  return true;
}
function demoList(table, f) {
  const db = demoDb();
  let rows = (db[table] || []).filter((r) => matches(r, f));
  if (table === "events") {
    const me = db._session?.user_id;
    rows = rows.filter((e) => !e.private || e.created_by === me);
  }
  if (table === "notifications") {
    const me = db._session?.user_id;
    const boss = db.profiles.find((p) => p.id === me)?.role === "boss";
    rows = rows.filter((n) => boss || n.recipients.includes(me));
  }
  if (f.order) {
    const [c, asc] = f.order;
    rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc === false ? -1 : 1));
  }
  return structuredClone(f.limit ? rows.slice(0, f.limit) : rows);
}
const PKS = { job_members: ["job_id", "user_id"], task_assignments: ["task_id", "user_id"], settings: ["key"] };
function demoInsert(table, rows) {
  const db = demoDb();
  db[table] = db[table] || [];
  const now = new Date().toISOString();
  const out = rows.map((r) => {
    const row = { ...(PKS[table] ? {} : { id: uuid() }), created_at: now, ...r };
    if (table === "tasks") row.status ??= "todo", row.priority ??= 2, row.sort_order ??= Date.now();
    if (table === "jobs") row.status ??= "planned", row.priority ??= 2, row.work_days ??= [1, 2, 3, 4, 5];
    if (table === "job_members") row.status ??= "approved";
    if (table === "time_logs") row.arrived_at ??= now;
    if (table === "photos") row.folder ??= "photos", row.mime ??= "image/jpeg";
    if (table === "events") row.urgency ??= "normal", row.color ??= "orange", row.private ??= false, row.assignees ??= [], row.done ??= false;
    const pk = PKS[table];
    if (pk && db[table].some((x) => pk.every((k) => x[k] === row[k]))) throw new Error("Already added");
    db[table].push(row);
    return row;
  });
  demoSave(db);
  return structuredClone(out);
}
function demoUpdate(table, match, patch) {
  const db = demoDb();
  const out = [];
  (db[table] || []).forEach((r) => {
    if (!matches(r, { eq: match })) return;
    Object.assign(r, patch);
    if (table === "tasks" && "status" in patch) r.completed_at = patch.status === "done" ? new Date().toISOString() : null;
    out.push(r);
  });
  demoSave(db);
  return structuredClone(out);
}
function demoRemove(table, match) {
  const db = demoDb();
  db[table] = (db[table] || []).filter((r) => !matches(r, { eq: match }));
  if (table === "jobs") {
    for (const t of ["tasks", "job_members", "shifts", "time_logs", "notes", "photos"]) db[t] = (db[t] || []).filter((r) => r.job_id !== match.id);
  }
  if (table === "tasks") db.task_assignments = db.task_assignments.filter((a) => a.task_id !== match.id);
  demoSave(db);
}

export function demoReset() { localStorage.removeItem(DKEY); memoryDb = {}; demoEnsureSeed(); }

function demoEnsureSeed() {
  const existing = demoDb();
  if (existing.profiles?.length) return;
  const d = (offset) => { const x = new Date(); x.setDate(x.getDate() + offset); return x.toLocaleDateString("en-CA"); };
  const ts = (dayOffset, h, m = 0) => { const x = new Date(); x.setDate(x.getDate() + dayOffset); x.setHours(h, m, 0, 0); return x.toISOString(); };
  const P = {
    boss: uuid(), boss2: uuid(), mike: uuid(), luis: uuid(), tasha: uuid(), dre: uuid(), new1: uuid(),
  };
  const profiles = [
    { id: P.boss, full_name: "Jordan Mills", email: "jordan@demo.co", phone: "352-555-0101", role: "boss", status: "active" },
    { id: P.boss2, full_name: "Renee Carter", email: "renee@demo.co", phone: "352-555-0102", role: "boss", status: "active" },
    { id: P.mike, full_name: "Mike Alvarez", email: "mike@demo.co", phone: "352-555-0111", role: "employee", status: "active" },
    { id: P.luis, full_name: "Luis Ortega", email: "luis@demo.co", phone: "352-555-0112", role: "employee", status: "active" },
    { id: P.tasha, full_name: "Tasha Greene", email: "tasha@demo.co", phone: "352-555-0113", role: "employee", status: "active" },
    { id: P.dre, full_name: "Andre Wilson", email: "dre@demo.co", phone: "352-555-0114", role: "employee", status: "active" },
    { id: P.new1, full_name: "Casey Brooks", email: "casey@demo.co", phone: "", role: "employee", status: "pending" },
  ].map((p) => ({ ...p, created_at: ts(-30, 9) }));

  const J = { kitchen: uuid(), deck: uuid(), office: uuid(), roof: uuid(), bath: uuid() };
  const jobs = [
    { id: J.kitchen, title: "Smith Kitchen Remodel", client: "Dana Smith", address: "1428 NW 16th Ave, Gainesville, FL 32605", description: "Full gut and remodel. New cabinets, quartz counters, tile backsplash, LVP flooring. Client works from home — keep side door closed (dog).", start_date: d(-6), end_date: d(18), start_time: "08:00", status: "active", priority: 1 },
    { id: J.deck, title: "Lakeview Deck Build", client: "R. Patel", address: "6201 SW 35th Way, Gainesville, FL 32608", description: "16x20 composite deck with stairs and rail. Permit posted on garage window.", start_date: d(-2), end_date: d(9), start_time: "07:30", status: "active", priority: 2 },
    { id: J.office, title: "Main St Office Buildout", client: "Harbor Dental", address: "220 N Main St, Gainesville, FL 32601", description: "Tenant improvement: 4 operatories, framing, drywall, drop ceiling. Coordinate with electrician on Thursdays.", start_date: d(5), end_date: d(40), start_time: "08:00", status: "planned", priority: 2 },
    { id: J.roof, title: "Oak Hollow Roof Repair", client: "M. Johnson", address: "4417 NW 34th St, Gainesville, FL 32605", description: "Storm damage — replace ~6 squares of shingles and two vents. Waiting on insurance adjuster.", start_date: d(2), end_date: d(4), start_time: "07:00", status: "on_hold", priority: 1 },
    { id: J.bath, title: "Hughes Bathroom", client: "T. Hughes", address: "915 SE 4th St, Gainesville, FL 32601", description: "Walk-in shower conversion.", start_date: d(-30), end_date: d(-10), start_time: "08:30", status: "done", priority: 3 },
  ].map((j) => ({ ...j, work_days: [1, 2, 3, 4, 5], created_by: P.boss, created_at: ts(-20, 9) }));

  const job_members = [
    [J.kitchen, P.mike], [J.kitchen, P.luis], [J.kitchen, P.boss], [J.deck, P.tasha], [J.deck, P.dre], [J.office, P.mike], [J.roof, P.luis], [J.bath, P.tasha],
  ].map(([job_id, user_id]) => ({ job_id, user_id, status: "approved", added_by: P.boss, created_at: ts(-7, 9) }));
  job_members.push({ job_id: J.deck, user_id: P.mike, status: "requested", added_by: P.mike, created_at: ts(-1, 17) });

  const T = (job_id, title, priority, status, extra = {}) => ({ id: uuid(), job_id, title, priority, status, description: "", due_date: null, sort_order: Math.random(), completed_at: status === "done" ? ts(-2, 15) : null, created_by: P.boss, created_at: ts(-6, 9), ...extra });
  const tasks = [
    T(J.kitchen, "Demo old cabinets & counters", 1, "done"),
    T(J.kitchen, "Haul debris to dump", 2, "done"),
    T(J.kitchen, "Run new plumbing for sink island", 1, "in_progress", { due_date: d(1) }),
    T(J.kitchen, "Install base cabinets", 1, "todo", { due_date: d(4) }),
    T(J.kitchen, "Install upper cabinets", 2, "todo", { due_date: d(6) }),
    T(J.kitchen, "Template for quartz counters", 2, "todo"),
    T(J.kitchen, "Tile backsplash", 3, "todo"),
    T(J.deck, "Set footings & posts", 1, "done"),
    T(J.deck, "Frame joists & beams", 1, "in_progress", { due_date: d(1) }),
    T(J.deck, "Lay composite decking", 2, "todo"),
    T(J.deck, "Build stairs", 2, "todo"),
    T(J.deck, "Install railing", 3, "todo"),
    T(J.office, "Layout & chalk walls", 1, "todo"),
    T(J.office, "Frame operatories", 1, "todo"),
    T(J.roof, "Tear off damaged shingles", 1, "todo"),
    T(J.bath, "Waterproof shower pan", 1, "done"),
    T(J.bath, "Tile shower walls", 1, "done"),
  ];
  const find = (t) => tasks.find((x) => x.title.startsWith(t)).id;
  const task_assignments = [
    [find("Demo old"), P.mike], [find("Demo old"), P.luis], [find("Haul"), P.luis], [find("Run new"), P.mike],
    [find("Install base"), P.mike], [find("Install base"), P.luis], [find("Set footings"), P.dre], [find("Frame joists"), P.tasha],
    [find("Frame joists"), P.dre], [find("Lay composite"), P.tasha], [find("Waterproof"), P.tasha], [find("Tile shower"), P.tasha],
  ].map(([task_id, user_id]) => ({ task_id, user_id, created_at: ts(-6, 9) }));

  const shifts = [];
  for (let i = -1; i < 6; i++) {
    const dt = new Date(); dt.setDate(dt.getDate() + i);
    if ([0, 6].includes(dt.getDay())) continue;
    shifts.push({ id: uuid(), job_id: J.kitchen, user_id: P.mike, work_date: d(i), start_time: "08:00", end_time: "16:30" });
    shifts.push({ id: uuid(), job_id: J.kitchen, user_id: P.luis, work_date: d(i), start_time: "08:00", end_time: "16:30" });
    shifts.push({ id: uuid(), job_id: J.deck, user_id: P.tasha, work_date: d(i), start_time: "07:30", end_time: "15:30" });
    shifts.push({ id: uuid(), job_id: J.deck, user_id: P.dre, work_date: d(i), start_time: "07:30", end_time: "15:30" });
  }

  const time_logs = [
    { id: uuid(), job_id: J.kitchen, user_id: P.mike, arrived_at: ts(-1, 7, 52), departed_at: ts(-1, 16, 35) },
    { id: uuid(), job_id: J.kitchen, user_id: P.luis, arrived_at: ts(-1, 8, 4), departed_at: ts(-1, 16, 30) },
    { id: uuid(), job_id: J.deck, user_id: P.tasha, arrived_at: ts(-1, 7, 25), departed_at: ts(-1, 15, 40) },
    { id: uuid(), job_id: J.kitchen, user_id: P.mike, arrived_at: ts(0, 7, 55), departed_at: null },
    { id: uuid(), job_id: J.deck, user_id: P.dre, arrived_at: ts(0, 7, 28), departed_at: null },
  ].map((t) => ({ ...t, created_at: t.arrived_at }));

  const notes = [
    { id: uuid(), job_id: J.kitchen, user_id: P.mike, body: "Found old galvanized supply line behind the sink wall — recommend replacing while the wall is open.", created_at: ts(-1, 10, 15) },
    { id: uuid(), job_id: J.kitchen, user_id: P.boss, body: "Approved by client. Add 2 hrs to plumbing task.", created_at: ts(-1, 13, 2) },
    { id: uuid(), job_id: J.deck, user_id: P.tasha, body: "Lumber delivery short 4 joists. Supplier bringing them tomorrow AM.", created_at: ts(-1, 11, 40) },
  ];

  const notifications = [
    { id: uuid(), title: "Head to Smith Kitchen Remodel", body: "Starts at 8:00 AM · 1428 NW 16th Ave, Gainesville, FL 32605", job_id: J.kitchen, kind: "reminder", recipients: [P.mike, P.luis, P.boss], created_at: ts(0, 7, 30) },
    { id: uuid(), title: "Rain tomorrow", body: "Deck crew: bring tarps for the lumber pile.", job_id: J.deck, kind: "message", recipients: [P.tasha, P.dre, P.boss], created_by: P.boss, created_at: ts(-1, 16, 0) },
  ];

  demoSave({
    profiles, invites: [], settings: [
      { key: "reminder_minutes", value: "30" }, { key: "timezone", value: "America/New_York" }, { key: "join_requires_approval", value: "false" },
    ],
    jobs, job_members, tasks, task_assignments, shifts, time_logs, notes, photos: [], push_subscriptions: [], notifications,
    events: [
      { id: uuid(), title: "Call electrical contractor", notes: "Confirm rough-in date for Harbor Dental. Ask about panel upgrade quote.", event_date: d(0), start_time: "10:00", end_time: null, color: "blue", urgency: "high", job_id: J.office, private: false, assignees: [], done: false, created_by: P.boss, created_at: ts(-1, 9) },
      { id: uuid(), title: "Insurance adjuster on site", notes: "Meet at Oak Hollow. Bring photos of storm damage.", event_date: d(1), start_time: "13:30", end_time: "14:30", color: "orange", urgency: "urgent", job_id: J.roof, private: false, assignees: [P.luis], done: false, created_by: P.boss, created_at: ts(-1, 9) },
      { id: uuid(), title: "Order quartz samples", notes: "", event_date: d(0), start_time: null, end_time: null, color: "purple", urgency: "normal", job_id: J.kitchen, private: true, assignees: [], done: false, created_by: P.boss, created_at: ts(-1, 9) },
    ],
    _session: null,
  });
}
