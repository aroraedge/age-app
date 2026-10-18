// send-push — lets a Boss send a push notification from the app.
// Deploy in Supabase → Edge Functions → name it exactly: send-push
// Keep "Verify JWT" ON for this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_PRIVATE_KEY")!,
);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Who is calling?
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: auth } = await admin.auth.getUser(token);
    const user = auth?.user;
    if (!user) return json(401, { error: "Not signed in" });
    const { data: me } = await admin.from("profiles").select("role,status").eq("id", user.id).single();
    if (!me || me.role !== "boss" || me.status !== "active") return json(403, { error: "Bosses only" });

    const { title, body, target, job_id, user_ids } = await req.json();
    if (!title) return json(400, { error: "Title is required" });

    // Work out who receives it
    let recipients: string[] = [];
    if (target === "job" && job_id) {
      const { data: crew } = await admin.from("job_members").select("user_id").eq("job_id", job_id).eq("status", "approved");
      const { data: job } = await admin.from("jobs").select("created_by").eq("id", job_id).single();
      recipients = [...(crew ?? []).map((r) => r.user_id), job?.created_by].filter(Boolean);
    } else if (target === "users" && Array.isArray(user_ids)) {
      recipients = user_ids;
    } else {
      const { data: all } = await admin.from("profiles").select("id").eq("status", "active");
      recipients = (all ?? []).map((r) => r.id);
    }
    recipients = [...new Set(recipients)];

    await admin.from("notifications").insert({
      title, body, job_id: job_id ?? null, kind: "message", recipients, created_by: user.id,
    });

    const result = await deliver(admin, recipients, {
      title, body: body ?? "", url: job_id ? `./#/job/${job_id}` : "./#/alerts",
    });
    console.log("send-push result", JSON.stringify(result));
    return json(200, { recipients: recipients.length, devices: result.ok, failed: result.failed });
  } catch (e) {
    return json(500, { error: String(e?.message ?? e) });
  }
});

// deno-lint-ignore no-explicit-any
async function deliver(admin: any, userIds: string[], payload: Record<string, string>) {
  const failed: Array<Record<string, unknown>> = [];
  if (!userIds.length) return { ok: 0, failed };
  const { data: subs } = await admin.from("push_subscriptions").select("*").in("user_id", userIds);
  console.log(`send-push: ${userIds.length} people, ${(subs ?? []).length} devices`);
  let ok = 0;
  await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; p256dh: string; auth: string }) => {
    const host = (() => { try { return new URL(s.endpoint).host; } catch { return "?"; } })();
    try {
      const res = await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 60 * 60, urgency: "high" },
      );
      console.log(`send-push OK ${host} status ${res?.statusCode}`);
      ok++;
    } catch (err) {
      const info = { host, status: err?.statusCode ?? null, body: String(err?.body ?? err?.message ?? err).slice(0, 300) };
      console.error("send-push FAILED", JSON.stringify(info));
      failed.push(info);
      // Phone uninstalled the app or turned notifications off — clean up.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await admin.from("push_subscriptions").delete().eq("id", s.id);
      }
    }
  }));
  return { ok, failed };
}
