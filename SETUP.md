# AGE App — Go-Live Checklist (about 30 minutes)

You'll set up two free accounts: **Supabase** (database, logins, photos, notifications) and **Netlify** (the website your crew installs from). Claude can't create accounts or handle passwords for you, so these steps are yours. Everything else is done.

**What's in this folder**
- `app/` — the app itself. This is the only folder that goes on Netlify.
- `supabase/` — the database script and two notification functions.
- `SECRETS.txt` — private keys. Never upload or share this file.

Screens on these websites change from time to time. If a button name doesn't match exactly, look for the closest match, or send Claude a screenshot.

---

## Part 1 — Supabase (about 20 min)

**1. Create the project**
1. Go to **supabase.com** and sign up (signing in with Google or GitHub is fine).
2. Click **New project**. Name it `AGE`.
3. Create a **database password** and save it in your password manager. You won't need to give it to anyone.
4. Region: **East US**. Click **Create**, then wait 1–2 minutes.

**2. Build the database**
1. In the left menu, open **SQL Editor** and click **New query**.
2. Open `supabase/schema.sql`, copy all of it, and paste it in.
3. Click **Run**. You should see "Success. No rows returned."

**3. Login settings**
1. Go to **Authentication → Sign In / Providers → Email**. Leave Email turned on.
2. Optional, but recommended for a fast rollout: turn **off** "Confirm email". Your crew can then sign in right after signing up. Bosses still approve anyone who wasn't invited.

**4. Add the two notification functions**
1. Open **Edge Functions** and choose **Deploy a new function → Via Editor**.
2. Name it exactly `send-push`. Replace the sample code with everything in `supabase/functions/send-push/index.ts`, then click **Deploy**.
3. Repeat for a second function named exactly `send-reminders`, using `supabase/functions/send-reminders/index.ts`.
4. Open `send-reminders` → **Details/Settings** and turn **off** "Enforce JWT verification" (it may be labeled "Verify JWT"). It's protected by its own secret instead. Leave it **on** for `send-push`.

**5. Add the secrets**
1. Go to **Edge Functions → Secrets**.
2. Add the 4 name/value pairs from `SECRETS.txt`: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` and `CRON_SECRET`.
3. For `VAPID_SUBJECT`, type your own email after `mailto:`.

**6. Send Claude two values (both are safe to share)**
- Go to **Project Settings → API** (it may be called "Data API" or "API Keys", or use the **Connect** button at the top).
- Copy the **Project URL**. It looks like `https://abcdefghijkl.supabase.co`.
- Copy the **anon** / **publishable** key. It starts with `eyJ…` or `sb_publishable_…`.
- **Never** send the `service_role` or `secret` key to anyone.

Claude will put them into the app and send back an updated folder, plus a filled-in `cron.sql`.

**7. Turn on automatic reminders**
1. In **SQL Editor → New query**, paste the `supabase/cron.sql` that Claude sends back.
2. Click **Run**. Reminders now check every 5 minutes.

---

## Part 2 — Netlify (about 5 min)

**8. Put the app online**
1. Go to **app.netlify.com** and sign up.
2. Choose **Add new project/site → Deploy manually**.
3. Drag the **`app`** folder (only that folder) onto the page and wait for it to say **Published**.
4. Go to **Site/Project configuration → Change name** and pick something like `age-crew`. Your link becomes `https://age-crew.netlify.app`.

**9. Tell Supabase the app's address**
1. In Supabase, go to **Authentication → URL Configuration**.
2. Set **Site URL** to your Netlify link, then click **Save**.

---

## Part 3 — First login (about 5 min)

**10. Become the first Boss**
1. On your phone, open the Netlify link.
2. Tap **Create account**. **The very first account automatically becomes a Boss.**
3. iPhone: in Safari, tap **Share → Add to Home Screen**, then open the app from the Home Screen icon.
   Android: in Chrome, tap **⋮ → Install app**.
4. Go to **Me → Turn on notifications**, then tap **Send a test to this phone**.

**11. Add your crew**
1. Go to **Team → Add person** and enter their name, email and role. Then tap **Send link**.
2. When they sign up with that email, they're approved automatically.
3. Anyone who signs up without an invite shows up under **Team → Waiting for approval**.

---

## Updating the app later
When Claude sends an updated `app` folder, open Netlify → your project → **Deploys**, then drag the new `app` folder onto the page. Phones pick up the update the next time the app opens.

## Costs
Supabase and Netlify both start free. Supabase pauses free projects after about a week with no use. Once the crew uses the app daily it stays awake, and the Pro plan (about $25/month) removes the pause entirely.
