-- ============================================================
-- Seed data imported from the club's role-booking Google Sheet (2026-07-29).
-- Run ONCE in the Supabase SQL Editor, AFTER schema.sql.
-- ============================================================

insert into settings (id, data) values (1, '{"clubName": "Rawalpindi Toastmasters Club", "meetingDay": 6, "cadence": "weekly", "roles": [{"id": "saa", "name": "Sergeant at Arms (SAA)", "count": 1}, {"id": "po", "name": "Presiding Officer", "count": 1}, {"id": "tmod", "name": "Toastmaster of the Day", "count": 1}, {"id": "ttm", "name": "Table Topics Master", "count": 1}, {"id": "spk", "name": "Speaker", "count": 3}, {"id": "ge", "name": "General Evaluator", "count": 1}, {"id": "tte", "name": "Table Topics Evaluator", "count": 1}, {"id": "eval", "name": "Evaluator", "count": 3}, {"id": "timer", "name": "Timer", "count": 1}, {"id": "vc", "name": "Vote Counter", "count": 1}, {"id": "gram", "name": "Grammarian", "count": 1}, {"id": "al", "name": "Active Listener", "count": 1}, {"id": "ah", "name": "Ah-Counter", "count": 1}, {"id": "jm", "name": "Joke Master", "count": 1}], "agendaAssets": {}}'::jsonb)
  on conflict (id) do update set data = excluded.data;

insert into profiles (id, name, role, approved, active) values
  ('8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'Syed Zameer', 'member', true, true),
  ('1f032831-8917-58d8-9301-4c73a429fde8', 'Amir Mehmood', 'member', true, true),
  ('26325e7e-4594-5f2a-8cb0-f13ecf0ad6d4', 'Umer Rasheed', 'member', true, true),
  ('c6a3d27d-4f9f-564c-9e27-31a5b044aa94', 'Osama Majeed', 'member', true, true),
  ('50570765-cb8d-58ad-abff-999fe010b4ee', 'Muhammad Bilal', 'member', true, true),
  ('d0d74a30-b6d0-5786-99fc-5671ec36eab4', 'Laiba Abaidullah', 'member', true, true),
  ('e1f74642-6704-5829-b169-298323d7c8d3', 'Muhammad Ahsan', 'member', true, true),
  ('9eefbc20-170c-521c-be1b-e894451381fa', 'Sundas Sarfraz', 'member', true, true),
  ('14657a66-3028-5f20-850e-8601774451fd', 'Madiha Imtiaz', 'member', true, true),
  ('f3545d42-e03f-5a31-a474-b6829ae29326', 'Muhammad Hammad', 'member', true, true),
  ('965f4eea-aa12-5eab-a2a5-9c5b0ea55002', 'Tamseela Bilal', 'member', true, true),
  ('0a0584ed-c45f-5f2c-a7e9-8d2f89bb99af', 'Shahnawaz Ali', 'member', true, true),
  ('a3dc2ea9-8f88-56d0-9c68-04b9a61121c8', 'Ejaz ul Haq', 'member', true, true),
  ('c333cf1e-a0bf-5d5c-a141-784634a842bb', 'Taifoor Ahmed', 'member', true, true),
  ('36504434-3956-5c48-afea-c960c8c712b6', 'Muhammad Wajahat', 'member', true, true),
  ('23232b70-71b5-5c2e-b1d8-b37f8ca7b2f4', 'Noor ud Din', 'member', true, true),
  ('2a747853-324e-5e0f-a6ad-c0b740fc5861', 'Fazal Akbar', 'member', true, true),
  ('d64fb7fd-dad1-562a-b413-86a5100ae046', 'Salman Hussain', 'member', true, true),
  ('187d986a-2c96-57c7-b82c-e9717ad1e023', 'Shaique Ahmed', 'member', true, true),
  ('e79c6414-b191-5d5e-ad55-ef299fe1bfef', 'Almas', 'member', true, true);

insert into meetings (id, date, theme) values
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', '2026-07-18', ''),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', '2026-07-25', 'Meeting No. 350 — Special'),
  ('e3058aba-93a5-5045-abb4-083c72b6f5ce', '2026-08-01', ''),
  ('171e4085-ee0c-50c2-bfd7-df1877058cd8', '2026-08-08', ''),
  ('f9e06951-1243-5b52-9ba5-fed247e26337', '2026-08-15', 'Urdu Meeting'),
  ('e7b4e9e1-0f4d-5724-8c32-d6fe3cd53e20', '2026-08-22', ''),
  ('157a2c4c-067e-5009-ac60-233e3f769bec', '2026-08-29', ''),
  ('2dd2803f-aa9b-58b1-a424-b02dcc4873dc', '2026-09-05', ''),
  ('da51ea20-3838-53d4-b84a-ed84a509c1c7', '2026-09-12', ''),
  ('66d7b0f4-5a03-5ca5-88ac-4d544fbff4d8', '2026-09-19', ''),
  ('8539a98a-f57a-55d0-ba39-2c8ca99aaf5b', '2026-09-26', '');

insert into assignments (meeting_id, slot_key, profile_id, status) values
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'tmod|0', '8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|0', 'd0d74a30-b6d0-5786-99fc-5671ec36eab4', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|1', '9eefbc20-170c-521c-be1b-e894451381fa', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|2', '965f4eea-aa12-5eab-a2a5-9c5b0ea55002', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|3', 'a3dc2ea9-8f88-56d0-9c68-04b9a61121c8', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|4', 'c333cf1e-a0bf-5d5c-a141-784634a842bb', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|5', '36504434-3956-5c48-afea-c960c8c712b6', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'spk|6', '0a0584ed-c45f-5f2c-a7e9-8d2f89bb99af', 'booked'),
  ('400ded44-d94d-5342-8b9a-157c7983dd6c', 'ge|0', '23232b70-71b5-5c2e-b1d8-b37f8ca7b2f4', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'tmod|0', '1f032831-8917-58d8-9301-4c73a429fde8', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'ttm|0', '8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'spk|0', 'e1f74642-6704-5829-b169-298323d7c8d3', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'spk|1', '14657a66-3028-5f20-850e-8601774451fd', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'spk|2', '0a0584ed-c45f-5f2c-a7e9-8d2f89bb99af', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'ge|0', '2a747853-324e-5e0f-a6ad-c0b740fc5861', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'tte|0', 'd64fb7fd-dad1-562a-b413-86a5100ae046', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'eval|0', '23232b70-71b5-5c2e-b1d8-b37f8ca7b2f4', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'eval|1', '187d986a-2c96-57c7-b82c-e9717ad1e023', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'eval|2', '8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'ah|0', '965f4eea-aa12-5eab-a2a5-9c5b0ea55002', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'gram|0', 'd64fb7fd-dad1-562a-b413-86a5100ae046', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'al|0', '50570765-cb8d-58ad-abff-999fe010b4ee', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'jm|0', 'd0d74a30-b6d0-5786-99fc-5671ec36eab4', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'timer|0', 'e79c6414-b191-5d5e-ad55-ef299fe1bfef', 'booked'),
  ('044b6c4b-d84a-5dff-a4c7-e01bffd0a215', 'vc|0', 'c6a3d27d-4f9f-564c-9e27-31a5b044aa94', 'booked'),
  ('e3058aba-93a5-5045-abb4-083c72b6f5ce', 'ttm|0', '26325e7e-4594-5f2a-8cb0-f13ecf0ad6d4', 'booked'),
  ('e3058aba-93a5-5045-abb4-083c72b6f5ce', 'spk|0', '9eefbc20-170c-521c-be1b-e894451381fa', 'booked'),
  ('e3058aba-93a5-5045-abb4-083c72b6f5ce', 'spk|1', '8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'booked'),
  ('e3058aba-93a5-5045-abb4-083c72b6f5ce', 'gram|0', '36504434-3956-5c48-afea-c960c8c712b6', 'booked'),
  ('e3058aba-93a5-5045-abb4-083c72b6f5ce', 'al|0', 'd0d74a30-b6d0-5786-99fc-5671ec36eab4', 'booked'),
  ('171e4085-ee0c-50c2-bfd7-df1877058cd8', 'ttm|0', 'c6a3d27d-4f9f-564c-9e27-31a5b044aa94', 'booked'),
  ('171e4085-ee0c-50c2-bfd7-df1877058cd8', 'spk|0', '50570765-cb8d-58ad-abff-999fe010b4ee', 'booked'),
  ('171e4085-ee0c-50c2-bfd7-df1877058cd8', 'spk|1', 'f3545d42-e03f-5a31-a474-b6829ae29326', 'booked'),
  ('171e4085-ee0c-50c2-bfd7-df1877058cd8', 'spk|2', '14657a66-3028-5f20-850e-8601774451fd', 'booked'),
  ('171e4085-ee0c-50c2-bfd7-df1877058cd8', 'ge|0', '8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'booked'),
  ('f9e06951-1243-5b52-9ba5-fed247e26337', 'ttm|0', '50570765-cb8d-58ad-abff-999fe010b4ee', 'booked'),
  ('f9e06951-1243-5b52-9ba5-fed247e26337', 'spk|0', '8ed2a46c-59af-52ff-9ebe-a629175a99b2', 'booked'),
  ('f9e06951-1243-5b52-9ba5-fed247e26337', 'spk|1', 'e1f74642-6704-5829-b169-298323d7c8d3', 'booked'),
  ('f9e06951-1243-5b52-9ba5-fed247e26337', 'spk|2', 'c6a3d27d-4f9f-564c-9e27-31a5b044aa94', 'booked'),
  ('e7b4e9e1-0f4d-5724-8c32-d6fe3cd53e20', 'ttm|0', 'd0d74a30-b6d0-5786-99fc-5671ec36eab4', 'booked');

-- ============================================================
-- FIRST ADMIN (seeded version): after YOU sign up in the app,
-- link your login to your seeded roster row and make it admin.
-- (Your signup created a duplicate row; this removes it and
--  attaches your login to the 'Muhammad Wajahat' entry.)
--
--   delete from profiles
--   where auth_id = (select id from auth.users where email='mwajahat934@gmail.com');
--   update profiles
--   set auth_id  = (select id from auth.users where email='mwajahat934@gmail.com'),
--       email    = 'mwajahat934@gmail.com',
--       role     = 'admin', approved = true
--   where name = 'Muhammad Wajahat';
--
-- Other members: when they sign up, the Members tab shows an
-- "Approve & merge" button that links them to their roster entry.
-- ============================================================