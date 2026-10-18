-- =====================================================================
--  UPDATE 03 — Job folders: ICR, Design, Photos (PDFs + photos)
--  Paste into Supabase → SQL Editor → New query → Run. Safe to re-run.
--  Existing photos move into each job's "Photos" folder automatically.
-- =====================================================================
alter table public.photos add column if not exists folder    text not null default 'photos';
alter table public.photos add column if not exists file_name text;
alter table public.photos add column if not exists mime      text not null default 'image/jpeg';
alter table public.photos add column if not exists size      integer;
alter table public.photos add column if not exists task_id   uuid references public.tasks(id) on delete set null;

alter table public.photos drop constraint if exists photos_folder_check;
alter table public.photos add constraint photos_folder_check check (folder in ('icr','design','photos'));

-- Who can add files: anyone active can add to Photos; only bosses to ICR and Design.
drop policy if exists photos_insert on public.photos;
create policy photos_insert on public.photos for insert to authenticated
  with check (public.is_active() and user_id = auth.uid() and (folder = 'photos' or public.is_boss()));

-- Moving between folders / tagging a task: uploader or a boss. Only bosses may move into ICR/Design.
drop policy if exists photos_update on public.photos;
create policy photos_update on public.photos for update to authenticated
  using (user_id = auth.uid() or public.is_boss())
  with check (folder = 'photos' or public.is_boss());

-- Allow PDFs up to 25 MB in the storage bucket.
update storage.buckets set file_size_limit = 26214400,
  allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','application/pdf']
where id = 'job-photos';
