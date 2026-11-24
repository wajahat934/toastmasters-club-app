-- 2026-11-24 — Vote Counter announces the winners. Run once in Supabase → SQL Editor.
-- Safe to run again.
--
-- Winners stay hidden from members until the Vote Counter presses
-- "📣 Announce winners", or 8:00 pm on the meeting day, whichever comes first.
-- Until this column exists the app shows every winner at once, as before.
-- Existing polls are marked announced so past winners stay visible.

alter table polls add column if not exists announced boolean not null default false;
update polls set announced = true where status = 'closed' and not announced;
