-- =====================================================================
--  UPDATE 05 — Estimate versions (V1, V2, V3…) and notes. Bosses only.
--  Run AFTER update 04. Paste into Supabase → SQL Editor → Run. Safe to re-run.
-- =====================================================================

alter table public.estimates add column if not exists approved_version integer;

-- ------------------------------------------------------------ VERSIONS
create table if not exists public.estimate_versions (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  version     integer not null,
  file_path   text,
  file_name   text,
  amount      numeric(12,2),
  note        text,                 -- what changed in this version
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (estimate_id, version)
);
create index if not exists estimate_versions_est_idx on public.estimate_versions(estimate_id);

alter table public.estimate_versions enable row level security;
drop policy if exists est_versions_boss on public.estimate_versions;
create policy est_versions_boss on public.estimate_versions for all to authenticated
  using (public.is_boss()) with check (public.is_boss());

-- Existing estimates with a PDF become V1.
insert into public.estimate_versions (estimate_id, version, file_path, file_name, amount, note, created_by, created_at)
select e.id, 1, e.file_path, e.file_name, e.amount, 'Original', e.created_by, e.created_at
from public.estimates e
where e.file_path is not null
  and not exists (select 1 from public.estimate_versions v where v.estimate_id = e.id);

-- Add the next version (numbered automatically) and make it the current one.
-- If the estimate already created a job, the new PDF is also filed in that job's ICR folder.
create or replace function public.add_estimate_version(
  estimate_id uuid, p_file_path text, p_file_name text, p_amount numeric default null, p_note text default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  e estimates%rowtype;
  next_v integer;
begin
  if not public.is_boss() then raise exception 'Only bosses can add estimate versions'; end if;
  select * into e from estimates where id = add_estimate_version.estimate_id for update;
  if not found then raise exception 'Estimate not found'; end if;

  select coalesce(max(version), 0) + 1 into next_v from estimate_versions v where v.estimate_id = e.id;

  insert into estimate_versions (estimate_id, version, file_path, file_name, amount, note, created_by)
  values (e.id, next_v, p_file_path, p_file_name, coalesce(p_amount, e.amount), nullif(trim(p_note), ''), auth.uid());

  update estimates set
    file_path = coalesce(p_file_path, file_path),
    file_name = coalesce(p_file_name, file_name),
    amount    = coalesce(p_amount, amount)
  where id = e.id;

  if e.job_id is not null and p_file_path is not null and exists (select 1 from jobs where id = e.job_id) then
    insert into photos (job_id, user_id, path, folder, file_name, mime, caption)
    values (e.job_id, auth.uid(), p_file_path, 'icr', coalesce(p_file_name, 'Estimate.pdf'),
            case when p_file_path ilike '%.pdf' then 'application/pdf' else 'image/jpeg' end,
            'Estimate V' || next_v);
  end if;
  return next_v;
end;
$$;
revoke all on function public.add_estimate_version(uuid, text, text, numeric, text) from public, anon;
grant execute on function public.add_estimate_version(uuid, text, text, numeric, text) to authenticated;

-- Approval now records which version was approved.
create or replace function public.approve_estimate(estimate_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e estimates%rowtype;
  new_job uuid;
  desc_text text;
  cur_v integer;
begin
  if not public.is_boss() then
    raise exception 'Only bosses can approve estimates';
  end if;

  select * into e from estimates where id = estimate_id for update;
  if not found then raise exception 'Estimate not found'; end if;
  select max(version) into cur_v from estimate_versions v where v.estimate_id = e.id;

  if e.job_id is not null and exists (select 1 from jobs where id = e.job_id) then
    update estimates set status = 'approved', decided_by = auth.uid(), decided_at = now(), approved_version = cur_v where id = e.id;
    return e.job_id;
  end if;

  desc_text := concat_ws(E'\n',
    nullif(e.description, ''),
    case when e.number is not null and e.number <> '' then 'Estimate #' || e.number || coalesce(' V' || cur_v, '') end,
    case when e.client_phone is not null and e.client_phone <> '' then 'Client phone: ' || e.client_phone end,
    case when e.client_email is not null and e.client_email <> '' then 'Client email: ' || e.client_email end);

  insert into jobs (title, client, address, description, start_date, end_date, start_time, status, priority, created_by)
  values (e.title, e.client, e.address, nullif(desc_text, ''), coalesce(e.proposed_start, current_date),
          e.proposed_end, '08:00', 'planned', 2, auth.uid())
  returning id into new_job;

  insert into job_members (job_id, user_id, status, added_by)
  values (new_job, auth.uid(), 'approved', auth.uid()) on conflict do nothing;

  if e.file_path is not null then
    insert into photos (job_id, user_id, path, folder, file_name, mime, caption)
    values (new_job, auth.uid(), e.file_path, 'icr', coalesce(e.file_name, 'Estimate.pdf'),
            case when e.file_path ilike '%.pdf' then 'application/pdf' else 'image/jpeg' end,
            'Approved estimate' || coalesce(' (V' || cur_v || ')', ''));
  end if;

  update estimates set status = 'approved', job_id = new_job, decided_by = auth.uid(), decided_at = now(), approved_version = cur_v
  where id = e.id;
  return new_job;
end;
$$;
revoke all on function public.approve_estimate(uuid) from public, anon;
grant execute on function public.approve_estimate(uuid) to authenticated;

-- --------------------------------------------------------------- NOTES
create table if not exists public.estimate_notes (
  id          uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  body        text not null check (length(body) between 1 and 4000),
  created_at  timestamptz not null default now()
);
create index if not exists estimate_notes_est_idx on public.estimate_notes(estimate_id);

alter table public.estimate_notes enable row level security;
drop policy if exists est_notes_read   on public.estimate_notes;
drop policy if exists est_notes_insert on public.estimate_notes;
drop policy if exists est_notes_delete on public.estimate_notes;
create policy est_notes_read on public.estimate_notes for select to authenticated using (public.is_boss());
create policy est_notes_insert on public.estimate_notes for insert to authenticated
  with check (public.is_boss() and user_id = auth.uid());
create policy est_notes_delete on public.estimate_notes for delete to authenticated
  using (public.is_boss() and user_id = auth.uid());
