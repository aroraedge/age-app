// send-reminders — runs every 5 minutes (scheduled by cron.sql) and sends
// "head to the job" reminders before each job's start time.
// Deploy in Supabase → Edge Functions → name it exactly: send-reminders
// Turn "Verify JWT" OFF for this function (it is protected by CRON_SECRET instead).
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

const fmtTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${ampm}`;
};

Deno.serve(async (req) => {
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  const { data: due, error } = await admin.rpc("due_reminders");
  if (error) return new Response(error.message, { status: 500 });
  if (!due?.length) return new Response(JSON.stringify({ sent: 0 }), { status: 200 });

  // Group recipients by job
  const byJob = new Map<string, { title: string; address: string; start: string; date: string; users: string[] }>();
  for (const r of due) {
    const g = byJob.get(r.job_id) ?? { title: r.title, address: r.address ?? "", start: r.start_time, date: r.local_date, users: [] };
    g.users.push(r.user_id);
    byJob.set(r.job_id, g);
  }

  let devices = 0;
  for (const [jobId, g] of byJob) {
    const title = `Head to ${g.title}`;
    const body = `Starts at ${fmtTime(g.start)}${g.address ? ` · ${g.address}` : ""}`;

    // Log first so a slow send never double-notifies
    await admin.from("reminder_log").upsert(
      g.users.map((u) => ({ job_id: jobId, user_id: u, local_date: g.date })),
      { onConflict: "job_id,user_id,local_date", ignoreDuplicates: true },
    );
    await admin.from("notifications").insert({ title, body, job_id: jobId, kind: "reminder", recipients: g.users });

    const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", g.users);
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url: `./#/job/${jobId}` }),
          { TTL: 30 * 60, urgency: "high" },
        );
        devices++;
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await admin.from("push_subscriptions").delete().eq("id", s.id);
        }
      }
    }));
  }
  return new Response(JSON.stringify({ jobs: byJob.size, devices }), { status: 200 });
});
