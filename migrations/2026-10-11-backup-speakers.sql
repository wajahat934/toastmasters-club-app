-- 2026-10-11 — anonymous backup speakers. Run once in Supabase → SQL Editor.
-- Safe to run again.
--
-- A member can stand by as a backup speaker for a meeting. It is kept in its
-- own table, NOT in assignments (which every member can read), so the list is
-- private by database rule: a member sees only their own row, officers see
-- all of them. First in = first in line (created_at).

create table if not exists speaker_backups (
  meeting_id uuid not null references meetings(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (meeting_id, profile_id)
);
alter table speaker_backups enable row level security;

drop policy if exists backups_read   on speaker_backups;
drop policy if exists backups_add    on speaker_backups;
drop policy if exists backups_remove on speaker_backups;

create policy backups_read on speaker_backups for select
  using (profile_id = my_profile_id() or is_admin());
create policy backups_add on speaker_backups for insert
  with check ((profile_id = my_profile_id() and is_approved()) or is_admin());
create policy backups_remove on speaker_backups for delete
  using (profile_id = my_profile_id() or is_admin());
