-- ============================================================
-- Toastmasters Club App — Supabase schema + row-level security
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run
-- ============================================================

-- ---------- tables ----------

create table settings (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'
);

create table profiles (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique references auth.users(id) on delete set null,
  email text,
  name text not null,
  home_club text,                          -- non-null = external guest (no login)
  role text not null default 'member' check (role in ('admin','member')),
  approved boolean not null default false,
  active boolean not null default true,
  path text not null default '',
  base_level int not null default 0,
  projects_done int not null default 0,
  created_at timestamptz not null default now()
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  theme text not null default '',
  cancelled boolean not null default false,
  reviewed boolean not null default false
);

create table assignments (
  meeting_id uuid not null references meetings(id) on delete cascade,
  slot_key text not null,
  profile_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'booked' check (status in ('booked','done','absent','other')),
  actual_role text,
  primary key (meeting_id, slot_key)       -- one person per slot, enforced by the DB
);

create table awards (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  level text not null,
  path text not null default '',
  date date not null
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  text text not null,
  done boolean not null default false
);

create table dcp (
  year int primary key,
  data jsonb not null default '{}'
);

create table agendas (
  meeting_id uuid primary key references meetings(id) on delete cascade,
  data jsonb not null default '{}'
);

-- ---------- helper functions (security definer bypasses RLS inside) ----------

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles
                 where auth_id = auth.uid() and role = 'admin' and approved and active) $$;

create or replace function is_approved() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles
                 where auth_id = auth.uid() and approved and active) $$;

create or replace function my_profile_id() returns uuid
language sql stable security definer set search_path = public as
$$ select id from profiles
   where auth_id = auth.uid() and approved and active limit 1 $$;

-- Members may edit their own row, but never the privileged columns.
-- Applies only to signed-in non-admins; direct SQL in the dashboard
-- (no auth context, auth.uid() is null) is always allowed.
create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is not null and not is_admin() then
    if new.role      is distinct from old.role
    or new.approved  is distinct from old.approved
    or new.active    is distinct from old.active
    or new.home_club is distinct from old.home_club
    or new.base_level is distinct from old.base_level
    or new.auth_id   is distinct from old.auth_id then
      raise exception 'not allowed';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_guard before update on profiles
for each row execute function guard_profile_update();

-- ---------- row-level security ----------

alter table settings    enable row level security;
alter table profiles    enable row level security;
alter table meetings    enable row level security;
alter table assignments enable row level security;
alter table awards      enable row level security;
alter table goals       enable row level security;
alter table dcp         enable row level security;
alter table agendas     enable row level security;

-- settings: everyone approved can read (role list is needed to draw slots); admins write
create policy settings_read  on settings for select using (is_approved());
create policy settings_write on settings for all    using (is_admin()) with check (is_admin());

-- profiles
create policy profiles_read on profiles for select
  using (is_admin() or auth_id = auth.uid() or (is_approved() and approved and active));
create policy profiles_signup on profiles for insert
  with check ( (auth_id = auth.uid() and role = 'member' and approved = false) or is_admin() );
create policy profiles_update on profiles for update
  using (is_admin() or auth_id = auth.uid())
  with check (is_admin() or auth_id = auth.uid());
create policy profiles_delete on profiles for delete using (is_admin());

-- meetings: read for approved; write admin only
create policy meetings_read  on meetings for select using (is_approved());
create policy meetings_write on meetings for all    using (is_admin()) with check (is_admin());

-- assignments: read for approved; members book/release ONLY themselves on future meetings
create policy asg_read on assignments for select using (is_approved());
create policy asg_admin on assignments for all using (is_admin()) with check (is_admin());
create policy asg_book on assignments for insert
  with check (
    profile_id = my_profile_id() and status = 'booked' and actual_role is null
    and exists(select 1 from meetings m
               where m.id = meeting_id and not m.cancelled and m.date >= current_date)
  );
create policy asg_release on assignments for delete
  using (
    profile_id = my_profile_id()
    and exists(select 1 from meetings m
               where m.id = meeting_id and m.date >= current_date)
  );

-- awards: members see their own; admins manage all
create policy awards_read  on awards for select using (is_admin() or profile_id = my_profile_id());
create policy awards_write on awards for all    using (is_admin()) with check (is_admin());

-- goals: own goals fully editable; admins see/manage all
create policy goals_own   on goals for all
  using (profile_id = my_profile_id()) with check (profile_id = my_profile_id());
create policy goals_admin on goals for all using (is_admin()) with check (is_admin());

-- dcp + agendas: admin only
create policy dcp_admin     on dcp     for all using (is_admin()) with check (is_admin());
create policy agendas_admin on agendas for all using (is_admin()) with check (is_admin());

-- ---------- realtime (live booking updates) ----------
alter publication supabase_realtime add table assignments;
alter publication supabase_realtime add table meetings;

-- ============================================================
-- AFTER you sign up in the app for the first time, make yourself
-- the first admin by running (edit the email):
--
--   update profiles set role='admin', approved=true
--   where email = 'mwajahat934@gmail.com';
--
-- The other two admins then sign up normally and you promote them
-- from inside the app (Members tab -> Make admin).
-- ============================================================
