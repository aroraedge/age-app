# ICR Crew App

Jobs, tasks, schedules, time on site, photos and push reminders for ICR crews.

- `app/` — the installable web app (no build step). Netlify publishes this folder.
- `supabase/schema.sql` — database tables, security rules, photo storage, reminder logic.
- `supabase/functions/` — `send-push` (boss alerts) and `send-reminders` (job-start reminders).
- `supabase/cron.sql` — runs reminders every 5 minutes.
- `SETUP.md` — first-time setup steps.

**Live data:** Supabase project `qovctplnmangzdsszgwv`. **Hosting:** Netlify, auto-deploys from `main`.

**Making changes:** edit files in `app/` and push to `main`. Database changes go in a new SQL file under `supabase/` and must be run in the Supabase SQL Editor.

**Demo mode:** set `SUPABASE_URL` to `""` in `app/config.js` to run with sample data only.
