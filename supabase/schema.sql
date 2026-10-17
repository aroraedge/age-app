-- =====================================================================
--  CREW APP — DATABASE SETUP
--  Paste this whole file into Supabase → SQL Editor → New query → Run.
--  Safe to run more than once.
-- =====================================================================

-- ---------- PEOPLE ----------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  phone       text,
  role        text not null default 'employee' check (role in ('boss','employee')),
  status      text not null default 'pending'  check (status in ('active','pending','disabled')),
  created_at  timestamptz not null default now()
);

-- Bosses pre-approve people by email. When that person signs up they
-- are activated automatically with the role chosen here.
create table if not exists public.invites (
  email       text primary key,
  full_name   text,
  role        text not null default 'employee' check (role in ('boss','employee')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- ---------- COMPANY SETTINGS -----------------------------------------
create table if not exists public.settings (
  key   text primary key,
  value text not null
);
insert into public.settings(key, value) values
  ('reminder_minutes', '30'),
  ('timezone', 'America/New_York'),
  ('join_requires_approval', 'false')
on conflict (key) do nothing;

-- ---------- JOBS -------------------------------------------------------
create table if not exists public.jobs (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  client      text,
  description text,
  address     text,
  start_date  date,
  end_date    date,
  start_time  time,                         -- daily start time on site
  work_days   smallint[] not null default '{1,2,3,4,5}',  -- 1=Mon … 7=Sun
  status      text not null default 'planned' check (status in ('planned','active','on_hold','done')),
  priority    smallint not null default 2 check (priority between 1 and 3), -- 1 high, 3 low
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.job_members (
  job_id     uuid references public.jobs(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  status     text not null default 'approved' check (status in ('approved','requested')),
  added_by   uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);

-- ---------- TASKS ------------------------------------------------------
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.jobs(id) on delete cascade,
  title        text not null,
  description  text,
  priority     smallint not null default 2 check (priority between 1 and 3),
  status       text not null default 'todo' check (status in ('todo','in_progress','done')),
  due_date     date,
  sort_order   double precision not null default 0,
  completed_at timestamptz,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.task_assignments (
  task_id    uuid references public.tasks(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);

-- ---------- SCHEDULE ---------------------------------------------------
create table if not exists public.shifts (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  work_date  date not null,
  start_time time,
  end_time   time,
  notes      text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- ON-SITE RECORDS -------------------------------------------
create table if not exists public.time_logs (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid not null references public.jobs(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  arrived_at  timestamptz not null default now(),
  departed_at timestamptz,
  created_at  timestamptz not null default now()
);

create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.photos (
  id         uuid primary key default gen_random_uuid(),
  job_id     uuid not null references public.jobs(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  path       text not null,
  caption    text,
  created_at timestamptz not null default now()
);

-- ---------- NOTIFICATIONS ---------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  body       text,
  job_id     uuid references public.jobs(id) on delete set null,
  kind       text not null default 'message' check (kind in ('message','reminder')),
  recipients uuid[] not null default '{}',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.reminder_log (
  job_id     uuid references public.jobs(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete cascade,
  local_date date not null,
  sent_at    timestamptz not null default now(),
  primary key (job_id, user_id, local_date)
);

create index if not exists tasks_job_idx       on public.tasks(job_id);
create index if not exists shifts_date_idx     on public.shifts(work_date);
create index if not exists time_logs_job_idx   on public.time_logs(job_id);
create index if not exists notes_job_idx       on public.notes(job_id);
create index if not exists photos_job_idx      on public.photos(job_id);
create index if not exists notifications_rcpt  on public.notifications using gin(recipients);

-- =====================================================================
--  HELPER FUNCTIONS
-- =====================================================================
create or replace function public.is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active');
$$;

create or replace function public.is_boss() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and status = 'active' and role = 'boss');
$$;

create or replace function public.join_requires_approval() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true' from settings where key = 'join_requires_approval'), false);
$$;

-- New sign-ups: first person ever becomes the boss; invited emails are
-- activated with their invited role; everyone else waits for approval.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv invites%rowtype;
  first_user boolean;
begin
  select not exists (select 1 from profiles) into first_user;
  select * into inv from invites where lower(email) = lower(new.email);

  insert into profiles (id, full_name, email, role, status)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), inv.full_name, split_part(new.email, '@', 1)),
    new.email,
    case when first_user then 'boss' when inv.email is not null then inv.role else 'employee' end,
    case when first_user or inv.email is not null then 'active' else 'pending' end
  )
  on conflict (id) do nothing;

  if inv.email is not null then
    delete from invites where email = inv.email;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Employees may edit their own name/phone but never their role or status.
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_boss() then
    new.role   := old.role;
    new.status := old.status;
    new.email  := old.email;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- Employees may only change the status of tasks assigned to them.
create or replace function public.guard_task() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_boss() then
    new.title       := old.title;
    new.description := old.description;
    new.priority    := old.priority;
    new.due_date    := old.due_date;
    new.sort_order  := old.sort_order;
    new.job_id      := old.job_id;
  end if;
  if new.status = 'done' and old.status <> 'done' then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_task on public.tasks;
create trigger guard_task before update on public.tasks
  for each row execute function public.guard_task();

-- =====================================================================
--  SECURITY (row-level security)
-- =====================================================================
alter table public.profiles           enable row level security;
alter table public.invites            enable row level security;
alter table public.settings           enable row level security;
alter table public.jobs               enable row level security;
alter table public.job_members        enable row level security;
alter table public.tasks              enable row level security;
alter table public.task_assignments   enable row level security;
alter table public.shifts             enable row level security;
alter table public.time_logs          enable row level security;
alter table public.notes              enable row level security;
alter table public.photos             enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notifications      enable row level security;
alter table public.reminder_log       enable row level security;

do $$
declare r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- profiles
create policy profiles_read   on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_active());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_boss());
create policy profiles_delete on public.profiles for delete to authenticated
  using (public.is_boss() and id <> auth.uid());

-- invites (bosses only)
create policy invites_boss on public.invites for all to authenticated
  using (public.is_boss()) with check (public.is_boss());

-- settings
create policy settings_read  on public.settings for select to authenticated using (public.is_active());
create policy settings_write on public.settings for update to authenticated using (public.is_boss());

-- jobs
create policy jobs_read  on public.jobs for select to authenticated using (public.is_active());
create policy jobs_boss  on public.jobs for all    to authenticated using (public.is_boss()) with check (public.is_boss());

-- job members
create policy members_read on public.job_members for select to authenticated using (public.is_active());
create policy members_boss on public.job_members for all to authenticated using (public.is_boss()) with check (public.is_boss());
create policy members_self_join on public.job_members for insert to authenticated
  with check (
    user_id = auth.uid() and public.is_active()
    and (status = 'requested' or not public.join_requires_approval())
  );
create policy members_self_leave on public.job_members for delete to authenticated
  using (user_id = auth.uid());

-- tasks
create policy tasks_read on public.tasks for select to authenticated using (public.is_active());
create policy tasks_boss on public.tasks for all to authenticated using (public.is_boss()) with check (public.is_boss());
create policy tasks_assignee_update on public.tasks for update to authenticated
  using (public.is_active() and exists (
    select 1 from public.task_assignments a where a.task_id = tasks.id and a.user_id = auth.uid()));

-- task assignments
create policy assign_read on public.task_assignments for select to authenticated using (public.is_active());
create policy assign_boss on public.task_assignments for all to authenticated using (public.is_boss()) with check (public.is_boss());

-- shifts
create policy shifts_read on public.shifts for select to authenticated using (public.is_active());
create policy shifts_boss on public.shifts for all to authenticated using (public.is_boss()) with check (public.is_boss());

-- time logs
create policy time_read   on public.time_logs for select to authenticated using (public.is_active());
create policy time_insert on public.time_logs for insert to authenticated
  with check (public.is_active() and (user_id = auth.uid() or public.is_boss()));
create policy time_update on public.time_logs for update to authenticated
  using (user_id = auth.uid() or public.is_boss());
create policy time_delete on public.time_logs for delete to authenticated using (public.is_boss());

-- notes
create policy notes_read   on public.notes for select to authenticated using (public.is_active());
create policy notes_insert on public.notes for insert to authenticated
  with check (public.is_active() and user_id = auth.uid());
create policy notes_change on public.notes for update to authenticated
  using (user_id = auth.uid() or public.is_boss());
create policy notes_delete on public.notes for delete to authenticated
  using (user_id = auth.uid() or public.is_boss());

-- photos
create policy photos_read   on public.photos for select to authenticated using (public.is_active());
create policy photos_insert on public.photos for insert to authenticated
  with check (public.is_active() and user_id = auth.uid());
create policy photos_delete on public.photos for delete to authenticated
  using (user_id = auth.uid() or public.is_boss());

-- push subscriptions (each person manages their own devices)
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notifications inbox
create policy notif_read on public.notifications for select to authenticated
  using (auth.uid() = any(recipients) or public.is_boss());

-- reminder_log: no client access (server only)

-- =====================================================================
--  PHOTO STORAGE
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

drop policy if exists "job photos read"   on storage.objects;
drop policy if exists "job photos upload" on storage.objects;
drop policy if exists "job photos delete" on storage.objects;

create policy "job photos read" on storage.objects for select to authenticated
  using (bucket_id = 'job-photos' and public.is_active());
create policy "job photos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-photos' and public.is_active()
              and (storage.foldername(name))[1] = auth.uid()::text);
create policy "job photos delete" on storage.objects for delete to authenticated
  using (bucket_id = 'job-photos'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_boss()));

-- =====================================================================
--  START-OF-DAY REMINDERS
--  Returns everyone who should get a "head to the job" reminder right now.
--  Called every 5 minutes by the send-reminders function (server only).
-- =====================================================================
create or replace function public.due_reminders()
returns table (job_id uuid, user_id uuid, title text, address text, start_time time, local_date date)
language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((select value from settings where key = 'timezone'), 'America/New_York') as tz,
           coalesce((select value::int from settings where key = 'reminder_minutes'), 30) as lead
  ),
  clock as (
    select (now() at time zone cfg.tz) as ts, cfg.lead from cfg
  ),
  recipients as (
    -- crew on the job
    select m.job_id, m.user_id from job_members m where m.status = 'approved'
    union
    -- the boss who created the job
    select j.id, j.created_by from jobs j where j.created_by is not null
    union
    -- anyone with a shift on the job today
    select s.job_id, s.user_id from shifts s, clock c where s.work_date = c.ts::date
  )
  select j.id, r.user_id, j.title, j.address,
         coalesce(sh.start_time, j.start_time) as start_time,
         c.ts::date as local_date
  from recipients r
  join jobs j      on j.id = r.job_id
  join profiles p  on p.id = r.user_id and p.status = 'active'
  cross join clock c
  left join lateral (
    select s.start_time from shifts s
    where s.job_id = j.id and s.user_id = r.user_id and s.work_date = c.ts::date
    order by s.start_time nulls last limit 1
  ) sh on true
  where j.status in ('planned', 'active')
    and coalesce(sh.start_time, j.start_time) is not null
    and (
      sh.start_time is not null
      or (c.ts::date between j.start_date and coalesce(j.end_date, j.start_date)
          and extract(isodow from c.ts)::int = any (j.work_days))
    )
    and c.ts >= (c.ts::date + coalesce(sh.start_time, j.start_time)) - make_interval(mins => c.lead)
    and c.ts <  (c.ts::date + coalesce(sh.start_time, j.start_time)) - make_interval(mins => c.lead) + interval '15 minutes'
    and not exists (
      select 1 from reminder_log l
      where l.job_id = j.id and l.user_id = r.user_id and l.local_date = c.ts::date
    );
$$;

revoke all on function public.due_reminders() from public, anon, authenticated;
grant execute on function public.due_reminders() to service_role;
