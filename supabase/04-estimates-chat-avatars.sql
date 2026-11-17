-- =====================================================================
--  UPDATE 04 — Estimates, team chat, profile pictures
--  Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------- ESTIMATES
create table if not exists public.estimates (
  id             uuid primary key default gen_random_uuid(),
  number         text,                       -- estimate # (e.g. from QuickBooks later)
  title          text not null,
  client         text,
  client_phone   text,
  client_email   text,
  address        text,
  description    text,
  amount         numeric(12,2),
  proposed_start date,
  proposed_end   date,
  status         text not null default 'pending'
                 check (status in ('pending','on_hold','approved','declined')),
  file_path      text,                       -- uploaded PDF (job-photos bucket)
  file_name      text,
  job_id         uuid references public.jobs(id) on delete set null,
  source         text not null default 'manual',   -- 'manual' now, 'quickbooks' later
  external_id    text,                              -- QuickBooks estimate id later
  decided_by     uuid references public.profiles(id) on delete set null,
  decided_at     timestamptz,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists estimates_status_idx on public.estimates(status);

alter table public.estimates enable row level security;
drop policy if exists estimates_boss on public.estimates;
create policy estimates_boss on public.estimates for all to authenticated
  using (public.is_boss()) with check (public.is_boss());

-- Approve an estimate: marks it approved and creates the job (once).
-- The estimate's PDF is filed into the new job's ICR folder.
create or replace function public.approve_estimate(estimate_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e estimates%rowtype;
  new_job uuid;
  desc_text text;
begin
  if not public.is_boss() then
    raise exception 'Only bosses can approve estimates';
  end if;

  select * into e from estimates where id = estimate_id for update;
  if not found then raise exception 'Estimate not found'; end if;

  -- Already has a job (approved before): just make sure it is marked approved.
  if e.job_id is not null and exists (select 1 from jobs where id = e.job_id) then
    update estimates set status = 'approved', decided_by = auth.uid(), decided_at = now() where id = e.id;
    return e.job_id;
  end if;

  desc_text := concat_ws(E'\n',
    nullif(e.description, ''),
    case when e.number is not null and e.number <> '' then 'Estimate #' || e.number end,
    case when e.client_phone is not null and e.client_phone <> '' then 'Client phone: ' || e.client_phone end,
    case when e.client_email is not null and e.client_email <> '' then 'Client email: ' || e.client_email end);

  insert into jobs (title, client, address, description, start_date, end_date, start_time, status, priority, created_by)
  values (e.title, e.client, e.address, nullif(desc_text, ''), coalesce(e.proposed_start, current_date),
          e.proposed_end, '08:00', 'planned', 2, auth.uid())
  returning id into new_job;

  -- The approving boss is on the crew so they get reminders.
  insert into job_members (job_id, user_id, status, added_by)
  values (new_job, auth.uid(), 'approved', auth.uid()) on conflict do nothing;

  if e.file_path is not null then
    insert into photos (job_id, user_id, path, folder, file_name, mime, caption)
    values (new_job, auth.uid(), e.file_path, 'icr', coalesce(e.file_name, 'Estimate.pdf'),
            case when e.file_path ilike '%.pdf' then 'application/pdf' else 'image/jpeg' end,
            'Approved estimate');
  end if;

  update estimates set status = 'approved', job_id = new_job, decided_by = auth.uid(), decided_at = now()
  where id = e.id;
  return new_job;
end;
$$;
revoke all on function public.approve_estimate(uuid) from public, anon;
grant execute on function public.approve_estimate(uuid) to authenticated;

-- ------------------------------------------------------------- CHAT
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists messages_created_idx on public.messages(created_at desc);

alter table public.messages enable row level security;
drop policy if exists messages_read   on public.messages;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_delete on public.messages;
create policy messages_read on public.messages for select to authenticated using (public.is_active());
create policy messages_insert on public.messages for insert to authenticated
  with check (public.is_active() and user_id = auth.uid());
create policy messages_delete on public.messages for delete to authenticated
  using (user_id = auth.uid() or public.is_boss());

-- Live updates for the chat screen.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    execute 'alter publication supabase_realtime add table public.messages';
  end if;
end $$;

-- --------------------------------------------------- PROFILE PICTURES
alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars upload" on storage.objects;
drop policy if exists "avatars update" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;
create policy "avatars upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
