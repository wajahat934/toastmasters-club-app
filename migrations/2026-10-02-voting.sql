-- 2026-10-02 — voting-night load + duplicate polls.
-- Run once in Supabase → SQL Editor. Safe to run again.

-- 1) Agenda images get their own table.
--    They used to sit inside the settings row, which every phone downloads on
--    every open and reload: megabytes per member on meeting-day wifi, for
--    pictures only admins see. The app moves them across by itself the first
--    time an admin opens the Agenda tab after this has run.
create table if not exists agenda_assets (
  key        text primary key,          -- 'excom', 'badge'
  data       text not null,             -- data: URL
  updated_at timestamptz not null default now()
);
alter table agenda_assets enable row level security;
drop policy if exists agenda_assets_admin on agenda_assets;
create policy agenda_assets_admin on agenda_assets
  for all using (is_admin()) with check (is_admin());

-- 2) One poll per award per meeting, enforced by the database.
--    Two "Best Speaker" polls on one night split the vote. The app now guards
--    against it too, but only the database can stop two phones doing it at
--    the same moment. If old duplicates still exist the index is NOT created
--    and the notice lists them: delete the extra poll in the app (the one
--    with fewer votes), then run this file again.
do $$
declare dups text;
begin
  select string_agg(format('%s / %s (%s polls)', m.date, p.cat, p.n), E'\n')
    into dups
    from (select meeting_id, lower(btrim(category)) cat, count(*) n
            from polls group by 1, 2 having count(*) > 1) p
    join meetings m on m.id = p.meeting_id;
  if dups is null then
    execute 'create unique index if not exists polls_one_per_award
             on polls (meeting_id, lower(btrim(category)))';
    raise notice 'OK — one poll per award is now enforced.';
  else
    raise notice E'NOT enforced yet — these meetings have duplicate polls:\n%', dups;
  end if;
end $$;
