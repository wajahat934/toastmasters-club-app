-- 2026-10-03 — gamification: each member's joining date (for the newcomer
-- multiplier). Run once in Supabase → SQL Editor. Safe to run again.

alter table profiles add column if not exists joined date;

-- Members can edit their own profile row (name, birthday, pathways), so
-- without this a member could move their own joining date to look newer and
-- earn the 2x newcomer boost. Only officers may set it.
create or replace function guard_profile_joined() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is not null and not is_admin()
     and new.joined is distinct from old.joined then
    raise exception 'only officers can change the joining date';
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_joined on profiles;
create trigger profiles_guard_joined before update on profiles
for each row execute function guard_profile_joined();
