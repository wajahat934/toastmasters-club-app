-- 2026-11-24 — Officer level + officer change log. Run once in Supabase → SQL Editor.
-- Safe to run again.
--
-- Three levels now:
--   admin   = full admin (the VPE). Everything, as before.
--   officer = runs meetings: bookings, agenda, voting, announcements, members'
--             details. Can NOT change club settings, make/remove officers,
--             approve sign-ups, deactivate or delete members.
--   member  = as before.
--
-- is_admin() now means "admin OR officer", so every existing rule keeps
-- working for officers. The few full-admin-only rules use is_full_admin().
-- Every change an officer makes is written to activity_log by the database
-- itself (officers cannot write or read that table). Only full admins read it.

-- ---------- the new level ----------

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin','officer','member'));

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles
                 where auth_id = auth.uid() and role in ('admin','officer') and approved and active) $$;

create or replace function is_full_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from profiles
                 where auth_id = auth.uid() and role = 'admin' and approved and active) $$;

-- ---------- profiles: who may change what ----------
-- Members: their own row, never the privileged columns (as before).
-- Officers: any row, but never role / approved / active / login link.
-- Full admins and the SQL editor (no auth context): anything.

create or replace function guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  if auth.uid() is null or is_full_admin() then return new; end if;
  if tg_op = 'INSERT' then
    if is_admin() and new.role <> 'member' then
      raise exception 'only the full admin can create officers';
    end if;
    return new;
  end if;
  if new.role     is distinct from old.role
  or new.approved is distinct from old.approved
  or new.active   is distinct from old.active
  or new.auth_id  is distinct from old.auth_id then
    raise exception 'only the full admin can change this';
  end if;
  if not is_admin() then
    if new.home_club  is distinct from old.home_club
    or new.base_level is distinct from old.base_level then
      raise exception 'not allowed';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before insert or update on profiles
for each row execute function guard_profile_update();

drop policy if exists profiles_delete on profiles;
create policy profiles_delete on profiles for delete using (is_full_admin());

-- ---------- settings: officers may change only the meeting-work fields ----------

create or replace function guard_settings_update() returns trigger
language plpgsql security definer set search_path = public as
$$
declare bad text;
begin
  if auth.uid() is null or is_full_admin() then return new; end if;
  select k into bad from (
    select jsonb_object_keys(coalesce(new.data,'{}')) k
    union select jsonb_object_keys(coalesce(old.data,'{}'))
  ) ks
  where (new.data -> k) is distinct from (old.data -> k)
    and k not in ('cakeDone','gameWinners','agendaHeader','urduNames',
                  'agendaChecklist','agendaAssets','agendaTemplate')
  limit 1;
  if bad is not null then
    raise exception 'only the full admin can change club settings (%)', bad;
  end if;
  return new;
end $$;

drop trigger if exists settings_guard on settings;
create trigger settings_guard before update on settings
for each row execute function guard_settings_update();

-- ---------- officer change log ----------

create table if not exists activity_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid references profiles(id) on delete set null,
  actor_name text,
  tbl text not null,
  op text not null,
  ref text,
  info jsonb not null default '{}'
);
create index if not exists activity_log_at on activity_log (at desc);
create index if not exists activity_log_actor on activity_log (actor, tbl, at desc);

alter table activity_log enable row level security;
drop policy if exists log_read on activity_log;
drop policy if exists log_delete on activity_log;
-- no insert policy: only the trigger below (security definer) writes here
create policy log_read   on activity_log for select using (is_full_admin());
create policy log_delete on activity_log for delete using (is_full_admin());

create or replace function log_officer_change() returns trigger
language plpgsql security definer set search_path = public as
$$
declare
  who profiles%rowtype;
  r jsonb; o jsonb;
  v_info jsonb := '{}';
  changed text[];
  v_mid uuid;
  v_ref text;
begin
  if auth.uid() is null then return null; end if;
  select * into who from profiles where auth_id = auth.uid() and role = 'officer' limit 1;
  if not found then return null; end if;        -- only officers are logged

  r := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  o := case when tg_op = 'INSERT' then null else to_jsonb(old) end;

  if tg_op = 'UPDATE' then
    select coalesce(array_agg(e.key order by e.key), '{}') into changed
    from jsonb_each(r) e where e.value is distinct from (o -> e.key);
    if cardinality(changed) = 0 then return null; end if;
    v_info := jsonb_build_object('changed', to_jsonb(changed));
  end if;

  if tg_table_name in ('assignments','agendas','polls') then
    v_mid := coalesce(r->>'meeting_id', o->>'meeting_id')::uuid;
    v_info := v_info || jsonb_build_object('date', (select date from meetings where id = v_mid));
  end if;
  v_ref := v_mid::text;

  if tg_table_name = 'assignments' then
    v_info := v_info || jsonb_build_object(
      'slot',      coalesce(r->>'slot_key', o->>'slot_key'),
      'who',       (select name from profiles where id = (r->>'profile_id')::uuid),
      'was',       (select name from profiles where id = (o->>'profile_id')::uuid),
      'status',    r->>'status',
      'oldStatus', o->>'status');
  elsif tg_table_name = 'meetings' then
    v_info := v_info || jsonb_build_object('date', coalesce(r->>'date', o->>'date'),
                                       'cancelled', r->'cancelled');
    v_ref := coalesce(r->>'id', o->>'id');
  elsif tg_table_name = 'polls' then
    v_info := v_info || jsonb_build_object('category', coalesce(r->>'category', o->>'category'),
                                       'status', r->>'status');
    v_ref := coalesce(r->>'id', o->>'id');
  elsif tg_table_name = 'votes' then
    v_info := v_info || jsonb_build_object('category',
      (select category from polls where id = (o->>'poll_id')::uuid));
  elsif tg_table_name = 'profiles' then
    v_info := v_info || jsonb_build_object('name', coalesce(r->>'name', o->>'name'));
    v_ref := coalesce(r->>'id', o->>'id');
  elsif tg_table_name = 'announcements' then
    v_info := v_info || jsonb_build_object('text', left(coalesce(r->>'text', o->>'text'), 140));
  elsif tg_table_name = 'awards' then
    v_info := v_info || jsonb_build_object(
      'name',  (select name from profiles where id = coalesce(r->>'profile_id', o->>'profile_id')::uuid),
      'level', coalesce(r->>'level', o->>'level'),
      'path',  coalesce(r->>'path', o->>'path'));
  elsif tg_table_name = 'dcp' then
    v_info := v_info || jsonb_build_object('year', coalesce(r->>'year', o->>'year'));
  elsif tg_table_name = 'settings' then
    select coalesce(array_agg(k order by k), '{}') into changed from (
      select jsonb_object_keys(coalesce(r->'data','{}')) k
      union select jsonb_object_keys(coalesce(o->'data','{}'))
    ) ks where (r->'data'->k) is distinct from (o->'data'->k);
    if cardinality(changed) = 0 then return null; end if;
    v_info := jsonb_build_object('keys', to_jsonb(changed));
    v_ref := array_to_string(changed, ',');
  end if;

  -- typing on an agenda or tapping paper votes saves many times: one line
  -- per 10 minutes for the same thing is enough
  if tg_op = 'UPDATE' and tg_table_name in ('agendas','polls','settings','profiles','dcp') then
    if exists(select 1 from activity_log l
              where l.actor = who.id and l.tbl = tg_table_name and l.op = 'UPDATE'
                and l.ref is not distinct from v_ref
                and l.at > now() - interval '10 minutes') then
      return null;
    end if;
  end if;

  insert into activity_log(actor, actor_name, tbl, op, ref, info)
  values (who.id, who.name, tg_table_name, tg_op, v_ref, jsonb_strip_nulls(v_info));

  if random() < 0.01 then
    delete from activity_log where at < now() - interval '180 days';
  end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['assignments','meetings','polls','votes','profiles',
                           'announcements','awards','dcp','agendas','settings'] loop
    execute format('drop trigger if exists %I on %I', t || '_officer_log', t);
    if t = 'votes' then
      execute format('create trigger %I after delete on %I for each row execute function log_officer_change()',
                     t || '_officer_log', t);
    else
      execute format('create trigger %I after insert or update or delete on %I for each row execute function log_officer_change()',
                     t || '_officer_log', t);
    end if;
  end loop;
end $$;

-- ---------- after running: make someone an officer ----------
-- Easiest: in the app, Members → open the person → "Make officer".
-- Or here:  update profiles set role = 'officer' where name = '...';
