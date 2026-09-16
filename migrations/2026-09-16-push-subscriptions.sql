-- Meeting alerts: one row per device that turned notifications on.
-- Run once in the Supabase SQL editor.
create table if not exists push_subscriptions (
  endpoint   text primary key,
  profile_id uuid not null references profiles(id) on delete cascade,
  keys       jsonb not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy push_sel on push_subscriptions for select to authenticated
  using (profile_id = my_profile_id());
create policy push_ins on push_subscriptions for insert to authenticated
  with check (profile_id = my_profile_id());
create policy push_upd on push_subscriptions for update to authenticated
  using (profile_id = my_profile_id()) with check (profile_id = my_profile_id());
create policy push_del on push_subscriptions for delete to authenticated
  using (profile_id = my_profile_id());
