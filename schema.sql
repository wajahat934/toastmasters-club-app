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
  path text not null default '',           -- legacy single path (superseded by `paths`)
  birthday text,                           -- optional 'MM-DD' (no year), for club wishes
  base_level int not null default 0,       -- legacy
  projects_done int not null default 0,    -- legacy
  paths jsonb not null default '[]',       -- [{name, baseLevel, projectsDone, done}] — members may hold several
  created_at timestamptz not null default now()
);

create table meetings (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  theme text not null default '',
  cancelled boolean not null default false,
  reviewed boolean not null default false,
  config jsonb not null default '{}',   -- per-meeting overrides: {"speakers": N, "tt": false}
  wod jsonb not null default '{}'       -- word of the day: {"word": "...", "def": "..."}
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

-- does the current user hold a given slot in a given meeting?
create or replace function holds_slot(m_id uuid, slot text) returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from assignments a
                 where a.meeting_id = m_id and a.slot_key = slot
                   and a.profile_id = my_profile_id()) $$;

-- meetings: read for approved; write admin only, EXCEPT the meeting's
-- TMOD may set the theme and its Grammarian may set the word of the day
create policy meetings_read  on meetings for select using (is_approved());
create policy meetings_write on meetings for all    using (is_admin()) with check (is_admin());
create policy meetings_role_update on meetings for update
  using (is_approved() and (holds_slot(id,'tmod|0') or holds_slot(id,'gram|0')))
  with check (is_approved());

create or replace function guard_meeting_update() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is not null and not is_admin() then
    if new.date is distinct from old.date
    or new.cancelled is distinct from old.cancelled
    or new.reviewed  is distinct from old.reviewed
    or new.config::text is distinct from old.config::text then
      raise exception 'not allowed';
    end if;
    if new.theme is distinct from old.theme and not holds_slot(old.id,'tmod|0') then
      raise exception 'only the TMOD can set the theme';
    end if;
    if new.wod::text is distinct from old.wod::text and not holds_slot(old.id,'gram|0') then
      raise exception 'only the Grammarian can set the word of the day';
    end if;
  end if;
  return new;
end $$;

create trigger meetings_guard before update on meetings
for each row execute function guard_meeting_update();

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

-- ---------- birthday change log (admins are notified of member edits) ----------

create table birthday_changes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  old_value text,
  new_value text,
  by_admin boolean not null default false,
  changed_at timestamptz not null default now(),
  seen boolean not null default false
);
alter table birthday_changes enable row level security;
create policy bc_admin on birthday_changes for all using (is_admin()) with check (is_admin());

-- logged by the DB itself, so a member cannot change their birthday unnoticed
create or replace function log_birthday_change() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if new.birthday is distinct from old.birthday then
    insert into birthday_changes(profile_id, old_value, new_value, by_admin)
    values (old.id, old.birthday, new.birthday, (auth.uid() is null) or is_admin());
  end if;
  return new;
end $$;

create trigger profiles_birthday_log after update on profiles
for each row execute function log_birthday_change();

-- ---------- announcements (admin messages shown to everyone) ----------

create table announcements (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  created_at timestamptz not null default now()
);
alter table announcements enable row level security;
create policy ann_read  on announcements for select using (is_approved());
create policy ann_admin on announcements for all using (is_admin()) with check (is_admin());

-- ---------- voting (Vote Counter tool) ----------

create table polls (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references meetings(id) on delete cascade,
  category text not null,                    -- 'Best Speaker', 'Best Evaluator', ...
  status text not null default 'open' check (status in ('open','closed')),
  candidates jsonb not null default '[]',    -- [{key, name, profileId}]
  adjust jsonb not null default '{}',        -- manual paper votes per candidate key
  paper_voters jsonb not null default '[]',  -- profile ids who voted on paper (blocked from app voting)
  winner_key text,
  created_at timestamptz not null default now()
);
create table votes (
  poll_id uuid not null references polls(id) on delete cascade,
  voter uuid not null references profiles(id) on delete cascade,
  candidate_key text not null,
  primary key (poll_id, voter)               -- one vote per member per poll
);

alter table polls enable row level security;
alter table votes enable row level security;

-- everyone approved sees polls (they need candidates + winners); only the
-- meeting's Vote Counter or an admin manages them
create policy polls_read  on polls for select using (is_approved());
create policy polls_admin on polls for all using (is_admin()) with check (is_admin());
-- The Vote Counter can create/manage polls ONLY on the meeting day itself.
-- current_date is UTC; for Pakistan (UTC+5) that window is exactly
-- 5:00 AM on meeting day -> 5:00 AM the next day. Admins are unrestricted.
create policy polls_vc    on polls for all
  using (is_approved() and holds_slot(meeting_id,'vc|0'))
  with check (is_approved() and holds_slot(meeting_id,'vc|0')
              and exists(select 1 from meetings m
                         where m.id = meeting_id and m.date = current_date));

-- secret ballot: members see/change only their OWN vote (while the poll is
-- open); the Vote Counter and admins can read all votes to tally them
create policy votes_self on votes for all
  using (voter = my_profile_id())
  with check (voter = my_profile_id()
              and exists(select 1 from polls p where p.id = poll_id and p.status = 'open'
                         and not (p.paper_voters ? (my_profile_id())::text)));
create policy votes_read_vc on votes for select
  using (is_admin() or exists(select 1 from polls p
                              where p.id = poll_id and holds_slot(p.meeting_id,'vc|0')));
create policy votes_del_vc on votes for delete
  using (is_admin() or exists(select 1 from polls p
                              where p.id = poll_id and holds_slot(p.meeting_id,'vc|0')));

-- ---------- realtime (live booking updates) ----------
alter publication supabase_realtime add table assignments;
alter publication supabase_realtime add table meetings;
alter publication supabase_realtime add table polls;
alter publication supabase_realtime add table votes;
alter publication supabase_realtime add table announcements;
alter publication supabase_realtime add table birthday_changes;

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
