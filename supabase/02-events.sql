-- =====================================================================
--  UPDATE 02 — Calendar events ("Call contractor", reminders, etc.)
--  Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
-- =====================================================================
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  notes       text,
  event_date  date not null,
  start_time  time,                 -- empty = all day
  end_time    time,
  color       text not null default 'orange',
  urgency     text not null default 'normal' check (urgency in ('low','normal','high','urgent')),
  job_id      uuid references public.jobs(id) on delete set null,
  private     boolean not null default false,   -- true = only the creator sees it
  assignees   uuid[] not null default '{}',
  done        boolean not null default false,
  created_by  uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists events_date_idx on public.events(event_date);

alter table public.events enable row level security;
drop policy if exists events_read   on public.events;
drop policy if exists events_insert on public.events;
drop policy if exists events_update on public.events;
drop policy if exists events_delete on public.events;

create policy events_read on public.events for select to authenticated
  using (public.is_active() and (not private or created_by = auth.uid()));
create policy events_insert on public.events for insert to authenticated
  with check (public.is_active() and created_by = auth.uid());
create policy events_update on public.events for update to authenticated
  using (created_by = auth.uid() or (public.is_boss() and not private));
create policy events_delete on public.events for delete to authenticated
  using (created_by = auth.uid() or (public.is_boss() and not private));
