-- =====================================================================
--  REMINDER SCHEDULE — run this AFTER both functions are deployed.
--  1) Project URL is filled in. Replace YOUR-CRON-SECRET with CRON_SECRET from SECRETS.txt
--     (only needed if you ever re-create the schedule).
--
--  2) Paste into Supabase → SQL Editor → Run.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.unschedule('job-reminders')
where exists (select 1 from cron.job where jobname = 'job-reminders');

select cron.schedule(
  'job-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://qovctplnmangzdsszgwv.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-cron-secret', 'YOUR-CRON-SECRET'),
    body    := '{}'::jsonb
  );
  $$
);
