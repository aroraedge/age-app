-- =====================================================================
--  UPDATE 06 — Profile photo fix. Safe to re-run.
--  Paste into Supabase → SQL Editor → New query → Run.
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars read"   on storage.objects;
drop policy if exists "avatars upload" on storage.objects;
drop policy if exists "avatars update" on storage.objects;
drop policy if exists "avatars delete" on storage.objects;

-- Anyone signed in can see profile photos.
create policy "avatars read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
-- People can only add, replace or remove photos in their own folder.
create policy "avatars upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- Make sure the profile column exists and people can save their own photo link.
alter table public.profiles add column if not exists avatar_url text;
