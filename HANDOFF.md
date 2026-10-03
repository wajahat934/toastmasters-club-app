# Toastmasters club app — handoff

**Repo:** `C:\Users\mwaja\toastmasters-club-app` · **Live:** https://wajahat934.github.io/toastmasters-club-app/
**State:** live and in real club use. `main` is production — every push reaches members within ~1 minute.

---

## Do this before anything else

1. **Bump the cache-buster.** `index.html` carries `?v=NN` on four asset URLs — and
   `demo/index.html` carries three more (the hosted sandbox at `/demo/` shares the ROOT
   app.js/styles/assets, so it goes stale silently if its `?v` is forgotten). Bump ALL of them on
   every deploy or browsers serve the old `app.js`. Currently **v=112**.
2. **Verify against a demo copy, not the live app.** Copy the repo to a scratch folder and replace
   `config.js` with placeholder values (`https://YOUR-PROJECT.supabase.co`) — the app then runs in
   DEMO MODE with fake in-memory data. Serve it and drive it with the browser tools.
3. **There is now a service worker (`sw.js`), and it is network-first on purpose.**
   Read the comment at the top of it before touching it. A cache-first worker would fight the
   `?v=NN` ritual and pin members to an old `app.js` with no way to push them off — the worst
   failure this codebase could have. It was tested both ways: online a changed file is served
   fresh, offline the cached copy is served. It exists because a browser will not offer to install
   a site that has no service worker. If it ever misbehaves in the wild, replace the file's body
   with `self.registration.unregister()` and it clears itself from every device on the next visit.
4. **Watch for backslash halving.** Writing JS through Bash/python heredocs eats one level of
   backslash. `\b` in a patch became a literal backspace byte inside three regexes once, and the
   file still parsed. After any scripted edit: `node --check app.js` **and** grep for control
   characters.
5. **Never rewrite files through PowerShell text commands.** PS 5.1 `Get-Content` reads BOM-less
   UTF-8 as ANSI, so a `-replace` + `Set-Content` round-trip double-encodes every non-ASCII byte.
   The v=71 cache bump did exactly that to index.html and shipped "Â·" garbage to the whole club
   (fixed in v=72 by restoring from git). Bump `?v=NN` with a proper editor/Edit tool, and after
   any scripted rewrite: `grep -c 'Â' <file>` must be 0.

---

## Start here — state as of 2026-10-02

**Live at v112, repo clean, nothing half-built.** The owner is the club's VPE and one of three
admins. The club runs live voting in meetings, so `main` is production.

**How to work on this app (each rule exists because breaking it once hurt the club):**
- Test in a demo copy, never on live data. The scratchpad copy gets wiped between sessions —
  rebuild it by copying the repo there and replacing `config.js` with `demo/config.js`.
  `localStorage.demoLag=<ms>` fakes slow internet. Two windows on one computer share live
  events (admin in one, member in the other).
- Bump `?v=NN` in BOTH `index.html` and `demo/index.html`, plus the version line below.
  `.githooks/pre-push` runs `scripts/precheck.sh` and refuses the push if these disagree
  (enable once per clone: `git config core.hooksPath .githooks`).
- The owner reviews by screenshot and confirms on the real app. Ship, wait for Pages to serve
  the new `?v=`, then tell them what to click to check.
- Nothing may slow down a booking or voting tap. Notifications, saves and logging run in the
  background, never in the tap path. The owner cares about speed above everything.
- Keep explanations to the owner short and in plain English.

**Club rules the app enforces (all decided by the owner):**
- Members vote in the app. Guests vote on paper slips, for Best Table Topics only. Paper
  votes are entered with the Paper ＋ button.
- Fair-use gaps per role group, set in Settings (speeches 3 weeks, TTM 4 weeks at last
  look). Under "all other roles" each role only limits itself.
- One turn of a role family per meeting (no Evaluator 1 + Evaluator 2). Officers can override.
- Members can release a booking until 3 days before the meeting (Wednesday). After that the
  turn counts even if they miss the meeting. An officer unbooking them gives the turn back.
- A long-format speech holds back one SPEAKER slot only. Evaluator slots stay open.
- Officers can reserve (🚫) any empty slot for special meetings.
- Speaker count "−" removes an open slot first. Someone gives way only when every slot is full.
- Agenda defaults: a role can name a default person who shows on the agenda only while the
  slot is unbooked (planned for Camera Master → Noor ud Din). 📌 standing roles auto-book
  their last holder into every meeting (SAA, PO).

**Also delivered outside the app, in `Downloads\Toastmaster\`:** the app-voting Vote
Counter script PDF (`Scripts\Vote Counter (App Voting).pdf`), and the private setup sheet for
backups and alerts (`push-and-backup-setup.txt`). The setup sheet holds the VAPID private
key — never copy it into this repo.

## Outstanding — needs the user, not code

- **Run `migrations/2026-10-03-gamification.sql`** — adds `profiles.joined` + a trigger so only
  officers can change it. Until then the "Joined RTC" field is hidden and nobody gets the
  newcomer boost. Then officers fill in each member's joining month (Members → member card).
- **Run `migrations/2026-10-02-voting.sql`** (SQL Editor). Creates `agenda_assets` (images leave the
  settings row every phone downloads) and the one-poll-per-award unique index. If old duplicate
  polls exist the index is skipped and the notice lists them. App works either way.
- **Backups are built but not switched on.** Add repo secrets `SUPABASE_SERVICE_KEY` and
  `BACKUP_PASSPHRASE`, then run the `backup` workflow once from the Actions tab. Steps are in
  the private setup sheet. Until then, nothing is backed up.
- **Meeting alerts (push) are built but not switched on.** Run
  `migrations/2026-09-16-push-subscriptions.sql`, set the three VAPID secrets, then deploy the
  `notify` function. Steps are in the private setup sheet. Until then the My Profile alerts card
  shows but sends nothing.
- **Camera Master default.** The role was erased by the stale-roles bug (fixed in v100). The
  owner needs to re-add it, set its agenda default to Muhammad Noor ud din, and leave
  📌 standing unticked. Not confirmed done.
- **Supabase region.** Never checked (Project Settings → General). If it is not near Pakistan
  (`ap-south-1` Mumbai is best), moving it is the biggest raw-speed gain left.
- **Offered, not built:** make the install bar fall back to "use the ⋮ menu → Add to Home
  screen" when Chrome does not offer the install itself. Waiting on the owner's yes.
- ~~**Realtime for settings and agendas.**~~ **Done** (2026-09-13): the owner ran
  `alter publication supabase_realtime add table settings, agendas;`.
- ~~**Supabase → Auth → URL Configuration.**~~ **Done** (2026-08-23). Site URL and Redirect URLs
  both carry the Pages URL with its trailing slash, matching `APP_URL` in app.js. Password reset
  was tested end to end and reaches the set-a-new-password screen.
- ~~**Booking-time migration.**~~ **Done** (confirmed 2026-08-23: the column already exists).
  The move-forward fairness rule uses real booking times.
- **Urdu wording review.** The Urdu is machine-written. Least trustworthy: ناظمِ انتظامات (SAA),
  صدرِ اجلاس (Presiding Officer), مجموعی تجزیہ کار (General Evaluator). The sheet is click-to-edit,
  and `AG_UR_RETIRED` + `healRetiredWording()` migrate saved sheets when a wording changes —
  that is how Table Topics became فی البدیہہ تقاریر.

## Answered 2026-08-23 — all three now built

- **Evaluators follow their speaker.** True in both places: the junior-first reorder on the agenda
  (`speechOrder()` sorts speaker/evaluator pairs, not speakers alone) and every move-forward
  (`moveEvaluatorWith()`), which aims the evaluator at the matching slot on the speaker's new meeting.
- **The project credit is asked for at review.** `creditPending()` runs when a meeting is marked
  reviewed and asks about every completed speech with nothing credited against it. One active
  pathway gets a yes/no; several get a numbered prompt. Already-credited speeches are never asked
  about twice — that guard is what stops a project being double counted.
- **Move-forward direction confirmed: last to book gives way.** The rule itself was right; what was
  broken was the speaker-count path (see below).

---

## Where things live in `app.js` (single file, ~3900 lines)

| Area | Notes |
|---|---|
| `AG_UR` / `AG_EN` / `AG_UR_RETIRED` | Urdu agenda phrases. Every generated phrase carries a key; `agKeyOf()` recognises legacy text without keys. |
| `applyLanguage()` | Swaps keyed phrases, re-renders booked names, strips the ٹی ایم honorific, translates the masthead labels. |
| `agDefaultBlocks()` | The standard agenda. Rows carry `k` (translation key) and `fill` (which booking populates them). |
| `AgendaApp` closure | Everything on the sheet: blocks, rows, move/delete, print fitting, language, theme. |
| `meetingBookingCard()` | Booking grid, double-booking check, leftover-booking release. |
| `deferBooking()` / `pushInto()` | Move-forward cascade. Works on meeting **ids** and rebuilds after every write. |
| `authLog()` / `checkConnection()` | Session diary and the sign-in connection probe. |

## Traps that have already bitten

- **Settings is ONE whole-blob row; a save from a stale tab erases everyone else's settings
  changes.** That is how the club's Camera Master role vanished (2026-09-06): a long-open tab
  saved its old roles list over the new one — and the v83 delta-realtime change makes tabs
  stale for LONGER. Mitigations since v85: opening the Settings tab always re-fetches the row
  first (`refreshSettings`, guarded by `settingsDirty`), and settings+agendas are wired into the
  realtime channel (the publication SQL was run 2026-09-13). Since v90 every settings save merges
  only its own fields onto the server row, and since v100 role edits are applied by role id to
  the server's current list (`mutateRoles`).

- **`state` goes stale after writing to `S`.** `bookLocal`/`unbookLocal` mutate `S`; helpers that read
  the derived `state` are stale until `rebuild()`. Moving three speakers at once silently overwrote
  two while the toast reported success. Operate on ids, re-resolve each step.
- **`saveMeetingConfig()` calls `rebuild()` + `render()`**, which remounts the agenda from its last
  *saved* state — writing meeting config from the agenda toolbar undoes the tick that triggered it.
  Use the quiet path.
- **`agRender()` hangs `_minsEl` on block objects and `updateTimes()` looks it up again.** Return
  fresh copies from `orderedBlocks()` and the per-session minute totals silently stop updating.
- **Base table CSS hard-codes `text-align:left`**, which beats `dir=rtl`. Urdu cells need explicit
  right alignment.
- **`sync()` used to fire writes in parallel.** A cascade sends a DELETE and an UPSERT for the same
  row in one tick; unordered, the DELETE could land last and wipe the booking just written — a
  member who looked moved on screen was gone after a reload. `serialiseWrites()` now queues
  book/adminAssign/unbook/setAsg. Demo mode used to answer instantly and couldn't reproduce
  races; now `localStorage.demoLag = <ms>` adds that much fake latency to every demo api call —
  set it and rehearse the messy case (slow entry included: every call in the chain waits).
- **Test the messy case, not the tidy one.** Three fixes came back because the demo sheet had keys
  and the club's did not. The club's saved agendas predate most of these features.

## Added 2026-10-03 — DCP print + member progress table (v112)

DCP tab: "🖨 Print" (`printDcp`) adds `html.dcpprint` for the print only (removed on afterprint):
light colours forced via CSS vars, inputs shown as plain values, buttons hidden, cards/rows kept
whole, member progress starts on a new page; page margin comes from padding because the
agenda's `@page{margin:0}` is global. New `memberProgressHtml(yr)` card (on screen too): every
active member × pathway — level done (`pathLevel`), projects into the next level, levels earned
this club year. `.print-only` class for print-only lines (the "Printed <date>" line).

## Added 2026-10-02 — 🏆 Points / gamification (v110)

From the club's "RTC Gamification Rules" doc (VP-Membership owns it). New tab for everyone
(`viewPoints`): monthly leaderboard, "my points" breakdown, Wall of Fame, rules table.
Engine `gameScores()` runs client-side over **reviewed** past meetings from `gameRules().start`
(default 2026-10-01): highest role only per meeting (roles matched by NAME via `GAME_ROLES`
regexes — custom roles like Camera Master have random ids), TT speakers = candidates of that
meeting's Table Topics poll (club's choice), attendance-only = 1 (opt-out register, hence the
reviewed gate), +award per closed-poll win, one-time streak bonus at the Nth role meeting,
newcomer multiplier on ROLE points only `max(1, multMax − months/multMonths)` from
`profiles.joined` (no date = 1.0). Guests and unapproved signups excluded. All numbers editable
by officers (`settings.gameRules`, whole-object save). Toastmaster of the Month: officer confirms
the leader of a finished month (ties → pick) → `settings.gameWinners[ym]` (per-month merge) =
the Wall of Fame. Roles not on the rules sheet (SAA, PO, Camera Master, anything else) score 0 and are hidden from the table (owner, v111); holding only one of them still earns the attendance point (`take` ignores 0-point roles).
Members' lite load keeps 60 days of polls — enough for the current and previous month.
"Wordsmith of the Day" in the rules sheet = the Grammarian role (owner confirmed) — no separate award.

## Changed 2026-10-02 — one birthday cake a month (v108)

Club rule from Oct 2026: one cake at month end for all that month's birthdays. The per-meeting
cake alert is GONE; admins now see a "🍰 <Month> birthday cake" banner listing the month's
birthdays and the month's last meeting, which stays until an officer presses "✓ Cake done"
(`cakeDone(ym)` → `settings.cakeDone['YYYY-MM']`, field-merged per month). Unticked months keep
showing (looks back 2 months, never before `CAKE_RULE_FROM='2026-09'` — September included at the club's request, v109). The 7-day "Birthdays this
coming week" banner and the on-the-day banners are unchanged.

## Changed 2026-10-02 — booking day rolls over at 8 pm (v107)

`bookingDayStr()` (ROLLOVER_HOUR=20) replaces `todayStr()` in `upcomingMeetings`, `pastMeetings`
and `ensureMeetings` only: from 8 pm on a meeting day that meeting counts as past, the next week
opens for booking and officers can review it. Voting gates, birthdays, cake alert and the release
cutoff still use the calendar date. `dateRollCheck` redraws at 8 pm as well as midnight.
Egress context: last cycle 6.4 GB (limit 5) — Sep 5–6 vote storm (pre-v83) + banner in settings
from ~Sep 13; grace period ends 2026-10-26. Check the egress chart after the Oct 3 meeting.

## Added 2026-10-02 — members' phones kept light for voting (v106)

- **Lite load for members** (`loadCore(lite)` / `loadRest(lite,myId)`, lite = `!isAdmin`): no DCP,
  agendas or birthday-change log; own goals only; polls from the last 60 days only.
- **Vote catch-up** (`quickVoteRefresh` → `api.loadVoting`: last 3 days' polls + their votes).
  Runs when a member's realtime rejoins and when the app returns from >15 s in the background
  (the "vote now" moment: the whole room unlocks at once). The full reload on rejoin is delayed
  15–45 s at random for members; the 5-minute safety reload is jittered over a minute for members.
- **Ballot first**: an open poll is the first card on the member's Book tab; candidates are big
  full-width buttons (52 px, one column on phones).

## Fixed 2026-10-02 later — voting-night load, double polls, birthdays (v105)

- **Voting hang.** Every phone subscribed to `votes` realtime. Realtime checks RLS for EVERY
  subscriber on EVERY change, so 50 voters = 2,500 permission checks for events members may not
  even receive (secret ballot) — Supabase's documented postgres_changes bottleneck. Now
  `api.subscribe(onChange,onStatus,opts)` adds `votes` only when `wantVotesLive()` (admin or
  Vote Counter of a meeting in `vcMeetings()`), `agendas` only for admins; re-subscribes (old
  channel removed) when a member gets booked as VC. Members' own votes are unaffected (optimistic
  queue). NOT load-tested against the live server — watch the next meeting.
- **Agenda images out of settings.** `agenda_assets` table (migration above), loaded only by the
  Agenda tab (`loadAgAssets`), which moves any images still in settings into the table and strips
  `agendaAssets` from the row (settings wins: only old app versions write there). Falls back to the
  settings path while the table is missing. The settings row every phone downloads was megabytes.
- **Double polls.** (1) `startPoll` had no in-flight guard: a second tap on a slow connection
  created a real second poll (`pollsStarting`); (2) the realtime echo of an insert can land before
  the insert's reply, and the reply was then pushed again — same poll twice on the VC screen, and
  deleting the "duplicate" deleted the real poll and its votes. `addOnce()` now used for every
  insert-then-push (polls, meetings, announcements). Unique index catches two devices at once.
- **"＋ Mark member" (paper voter) picker removed** from the VC card and the practice mirror — new
  Vote Counters used it to add candidates. Already-marked voters still show, to unmark.
- **Evaluator labels** number by position (names still follow the row via `n`).
- **Birthday notice 7 days ahead** (`BDAY_NOTICE_DAYS`): cake alert gate 4→7 days, plus a
  "Birthdays this coming week" admin banner counted from each birthday, not from meetings.

## Fixed 2026-10-02 — agenda reverts; standard layout; evaluator arrows; checklist (v104)

- **Agenda edits kept reverting (3:30 → 4:30).** Two causes. (1) `agRender()` queues a save, and
  `loadMeeting()` calls it — so merely OPENING a sheet wrote it back 500 ms later; the meeting
  dropdown also saved the sheet being left, unasked. A device with an old copy on screen (a phone
  left on the agenda tab) re-saved it over newer edits. (2) agenda realtime events updated `S.agendas`
  but never redrew an open sheet, so that screen stayed stale indefinitely. Fixes: opening a SAVED
  sheet no longer saves; the dropdown only flushes a pending edit; every save is a three-way merge
  (`saveAgNow` / `mergeAg`) — `agBase` is the sheet as loaded, anything this screen did not change
  is taken from the server copy fetched at save time (`api.loadAgenda`), per toolbar input, per
  static text, blocks as one unit; an open sheet redraws on remote changes when idle
  (`AgendaApp.remoteChanged`, skipped while typing or saving). Tested with two windows, one stale.
- **Banner reverting.** `agendaAssets` was saved as a whole map, so any image save from a device
  holding an old map put the old banner back. `saveSettingsFields(keys, sub, done)` now merges only
  the touched entries (`{agendaAssets:['excom']}`) and reports success ("Image saved for all admins
  ✓"). Uploads over ~1 MB are redrawn ≤2400 px wide (`shrinkImage`; banner→JPEG, badge stays PNG).
  A settings realtime event missing `agendaAssets` (size cap) no longer blanks it. The first-run
  "no settings row → write defaults" path now re-checks the row first (it would have wiped roles,
  header and banner on an empty read). Root cause on the live data NOT confirmed — if it recurs,
  check whether the owner saw a "Sync failed" toast at upload time.
- **⭐ Standard layout** (`settings.agendaTemplate`): "Save as standard layout" stores timings, line
  order, start time and buffers; every NEW sheet starts from it (`useTemplate` in loadMeeting).
  Names blanked, speakers reset to standard, 🎓 block and Speakathon row left out. "Use standard
  layout" applies it to an existing sheet. Sheets already saved are untouched.
- **Speech evaluator ↑↓** (inside the Evaluation Session only). The first move stamps `row.n` on
  every evaluator row so label + booked name follow the row (applyBookings uses `r.n`); a speaker
  count change clears the stamps.
- **✅ Before-issuing checklist** beside the sheet (≥1440 px wide, sticky) or above it (narrower).
  List club-wide in `settings.agendaChecklist` (editable, resettable); ticks per meeting in the
  agenda's `checks` (merged like everything else). The TBD line shows a live count. no-print.

## Fixed 2026-09-25 — speaker "−" compacts open slots; Speakathon TMOD row (v103)

- **Speaker count "−" no longer bumps anyone when a slot is open.** `spkDelta` always cut the
  LAST slot and pushed its give-way speaker forward, even with an open slot higher up.
  `compactSpeakerSlot()` now runs first: it picks an open speaker slot (preferring one whose
  evaluator slot is also open), moves every speaker/evaluator PAIR below it up one (booked_at and
  a long speech's duration_min carried), reseats an evaluator who sat opposite the empty speaker
  slot in the freed evaluator seat (moving them forward only if no seat is left, with a confirm),
  and remaps position-keyed `config.blockedSlots`. The old give-way flow runs only when every
  speaker slot is full.
- **Speakathon agendas get "TMOD invites the General Evaluator"** (`r_tmodGe`, fill tmod, 1 min)
  at the head of the Evaluation Session via `placeSpeakathonTmodRow()` — added while Table Topics
  is off, removed when it is back on, never duplicated. Called alongside placeIntroRow/
  placeTTEvalRow and from applyBookings.
- **The meeting decides the format on saved sheets**: loadMeeting now sets the hidden agTT and
  agSwap ticks from the meeting (`ttOn`, `speechFirstOn`) after restoring a saved sheet — with
  those ticks off the toolbar, a sheet saved under the old format kept it forever.

## Fixed 2026-09-17 — blank screen on a half-updated cache (v96)

A member's phone fetched a new index.html, lost the connection before the matching `?v=` app.js
arrived, and the cache only held OLD versions under old URLs → silent blank page (incognito
worked, which is the tell). Three defences now: (1) index.html (both copies) carries an inline
BOOT WATCHDOG — 7 s with no screen visible shows a plain "could not load, try again" message
with a retry button, no dependence on app.js; (2) sw.js falls back to `caches.match(req,
{ignoreSearch:true})` — the same file from ANY cached version beats a blank screen, and the next
healthy load replaces it; (3) `pruneSwCache()` keeps the newest TWO versions in the runtime
cache (current + the fallback) and deletes older ones, 15 s after entry. Member-side cure for an
already-poisoned phone: Chrome → Settings → Site settings → the app's site → Delete data, then
reopen on good internet (they sign in again).

## Added 2026-09-16 — backups, alerts, retention list, pre-push check (v95)

- **Pre-push check**: `scripts/precheck.sh`, run automatically by `.githooks/pre-push`
  (enable once per clone: `git config core.hooksPath .githooks`). Verifies app.js parses, no
  mojibake/control bytes, both index files carry the SAME `?v=` and HANDOFF's version line
  matches. Every check is an accident that actually shipped once.
- **Weekly encrypted backup**: `.github/workflows/backup.yml` dumps all tables Mondays 02:00 UTC,
  encrypts (repo is public; data has emails/birthdays), stores as 90-day artifacts. Needs repo
  secrets `SUPABASE_SERVICE_KEY` + `BACKUP_PASSPHRASE` — restore command in the workflow header.
- **🌱 Not-seen-lately list** (`notSeenLatelyHtml`, `NOT_SEEN_WEEKS=6`): top of the admin
  Members→Roster view; members with no non-absent role on a past meeting for 6+ weeks (or ever),
  worst first. Admin-only by construction (the whole tab is admin-only).
- **Meeting alerts (web push)**: per-device opt-in card on My Profile (`pushCardHtml`,
  `pushEnable/pushDisable`, `VAPID_PUBLIC` constant); subscriptions in `push_subscriptions`
  (migration in `migrations/`); sw.js gained push+notificationclick handlers (fetch path
  untouched); sends happen in the `notify` Edge Function (`supabase/functions/notify/`),
  triggered FIRE-AND-FORGET from annAdd (announcement, admin-verified server-side) and
  startPoll (voting open). NEVER await a notify call in a tap path. Inactive until the user
  runs the migration + deploys the function + sets VAPID secrets (their setup sheet:
  Downloads\Toastmaster\push-and-backup-setup.txt — contains the PRIVATE key, never commit it).

## Fixed 2026-09-16 — agenda tab gated on agendasLoaded; edu speaker slot (v93)

- **SERIOUS v88 regression, fixed**: agendas are the LAST data to load and are never in the
  instant-open snapshot. Opening straight onto the Agenda tab during that window regenerated
  the sheet from defaults — the meeting number fell back to `nextNo()`'s floor (the club saw
  358 become 351) and one edit saved the empty sheet over the real one. Now: `agendasLoaded`
  flag; the agenda tab shows a loading note until the saved sheets have arrived once this
  session; `queueAgSave` refuses to save before that; the tab re-renders itself when they land.
  Also `applyDelta('agendas')` no longer stores an event whose `data` body is missing (a big
  sheet can exceed the realtime payload cap and arrive stripped) — it falls back to a reload.
- **Educational Session Speaker is a bookable slot**: a 🎓-flagged meeting's `slotListFor`
  carries a virtual `edu|0` slot (`EDU_ROLE`; `roleNameById` knows it; in `prefillCandidates`'
  CORE list so guests don't become Best Facilitator candidates; `roleMap().edu`). The agenda's
  edu talk row carries `fill:'edu'` and the Q&A line `fill:'eduQa'` (composite: booked speaker &amp; TMOD, rewritten only once a speaker is booked; older saved sheets healed on load), so the booked name
  fills like any role player and survives refills. Unflagging the meeting orphans any booking
  (the usual orphan release flow surfaces it).

## Fixed 2026-09-13 — settings saves are field-merges; the revert class is dead (v90)

Every settings edit now saves ONLY its own field(s), merged onto the server's row fetched at
save time (`saveSettingsFields(keys)` — queued, values captured at call time; replaces
`saveSettingsRemote` everywhere). A stale device can no longer revert fields it didn't touch —
that whole-blob overwrite is what kept winding back the agenda header (district/division/time),
the banner images and, before that, the Camera Master role. Also: the agenda tab now refreshes
settings on open like the Settings tab (skipped while a contenteditable is focused), and the
first-seconds save-from-snapshot hole (v88 snapshot strips agendaAssets) is closed by the same
merge — a save can no longer strip fields it doesn't carry. Cosmetic leftover: at instant-open
the banner shows the default image until the fresh load lands (agendaAssets stays out of the
snapshot for quota reasons).

## Fixed 2026-09-10 — one turn of a role family per meeting (v89)

The weekly gap rule excludes the meeting being booked (so a booking can be moved between its
slots), which left a hole: one member could take Evaluator 1 AND Evaluator 2 on the same night.
`sameMeetingConflict()` now blocks a member from self-booking a second slot of the same role
FAMILY in one meeting (eval family includes the TT Evaluator; tag roles match only themselves;
SAA/PO exempt) — always on, independent of the gap dials. The grid greys the slot with the
reason; officers get a confirm in `assign()` and can still double someone up on purpose.

## Added 2026-09-10 — perceived-speed batch (v88)

- **Instant open**: `saveSnapshot()` after every full load keeps the last data in localStorage
  (`tmSnap.v1` — per-member, 7-day cap, DEMO-gated because the sandbox shares this origin's
  storage; `localStorage.demoSnap='1'` enables it in demo for testing; agendaAssets and agendas
  excluded or the base64 images blow the quota). `paintSnapshot()` in enterApp paints it before
  the fresh load; if the fresh load then FAILS the app stays usable on the snapshot with an
  honest toast. Snapshot cleared on the sign-out button.
- **Split load**: `loadCore()` (settings/profiles/meetings/assignments/polls/votes/announcements)
  and `loadRest()` (awards/goals/dcp/agendas/birthday_changes/suggestions) fetch in PARALLEL but
  core is applied+painted the moment it lands. `loadAll` is gone from both apis.
- **In-place tally**: a votes delta calls `tallyPatch(pollId)` which patches the `data-app`/
  `data-total` cells on the VC card — no rebuild, no redraw, focus survives while a room votes.
  Falls back to the debounced redraw when the card isn't on screen.
- **Pressed booking buttons**: Book/Release flip to "Booking…"/"Releasing…" + disabled on tap
  (myBook/myUnbook take the button as 3rd arg); error paths re-render so the button comes back.

## Added 2026-09-06 late — release cutoff, absent counts, two-window sandbox (v86)

- **Release cutoff**: members can self-release a booking only until
  `settings.releaseCutoffDays` before the meeting (default 3 = Wednesday for a Saturday club;
  0 = any time; dial in the Fair-use Settings card). Inside the window the slot shows
  "🔒 yours now" and `myUnbook` refuses; officers can still unbook from the schedule.
- **A held booking counts toward the gap even when the outcome is absent** — the club's rule:
  the turn is spent once the slot is held past the cutoff, speech given or not. The absent-skip
  in `gapConflict` was REMOVED deliberately; an officer unbooking someone entirely is the
  hand-the-turn-back path.
- **Sandbox windows on one computer share their fake backend** over
  `BroadcastChannel('rtc-sandbox')`: DemoApi `emit()` broadcasts, a listener patches the local
  tables and feeds the app's realtime path. Demo profile ids are now deterministic (`dp0…`) so
  rows agree across windows — uid() ids would not. Only emitting tables sync (assignments,
  meetings, polls, votes, announcements, settings); profiles/awards/goals stay per-window.
  Different DEVICES still don't sync in demo — there is no server.
- `settingsDirty` now clears when the last outstanding settings save lands (was sticky until
  the Settings tab was reopened, which would have blocked incoming settings realtime on the
  device that last edited).
- **Officer-reserved slots** (special meetings): 🚫 toggle on any EMPTY slot of the admin
  meeting card reserves it — members see "reserved, officers will assign", `myBook` refuses,
  the open-roles message stops offering it, and `freeSlotFor`/`openSpkKey` skip it so
  move-forward cascades and long-speech rebooking never land on one. Officers assign into it
  from the same dropdown as always. Lives in `meetings.config.blockedSlots` (no migration);
  blocking only matters while the slot is empty.

## Fixed 2026-09-06 — voting resilience (v83)

The club voted manually one week because the app choked under lag. Two causes, both in the build
(Supabase also had a platform incident Aug 27–31, which amplified them):

- **Every realtime event ran a full `loadAll()` on every connected phone.** On voting night each
  cast vote made the whole room re-download the whole database — a self-made traffic storm. Now a
  recognised event applies just its own ~1 KB row (`applyDelta` + `DELTA_KEYS`, all six subscribed
  tables) and redraws on a 250 ms debounce; sized for 25+ simultaneous voters on weak internet.
  Full reloads still exist but only as: fallback for an unrecognised payload, catch-up when the
  realtime channel REJOINS after a drop (events were missed — `subscribe`'s status callback), and
  a 5-minute safety net for the unsubscribed tables (settings, agendas — an agenda edit by a
  second device shows within 5 min, it used to piggyback on other events). Reloads are debounced
  (400 ms), single-flight, and `reloadSeq` drops any response superseded while in flight.
  DemoApi now EMITS these events from its own writes, so the delta path runs in demo too.
- **`castMyVote` waited on the server before showing anything.** Under lag the tap looked dead,
  the member tapped again, and a stale reload made the vote appear and then vanish. Votes are now
  optimistic: `pendingVotes` queue + `flushVotes()` retries with backoff (and on `online`),
  `overlayPendingVotes()` re-asserts unconfirmed votes after every reload, a definitive server
  refusal (RLS / voting closed) drops the vote with an honest toast instead of retrying forever,
  and `beforeunload` warns if a vote is still unsent. RULE: a tap the member saw acknowledged
  must never silently reverse — anything new in this area keeps that property.

Also added (same day): **fair-use booking gaps** — at most one booking of a role per member per
N weeks, counted both ways from the meeting date, skipping cancelled meetings and 'absent'
outcomes. Every role maps to a gap GROUP (`GAP_GROUPS`/`gapGroupOf`): spk 3wk and ttm 6wk by
default; eval (speaker evaluators AND the TT Evaluator count as one evaluator turn), tmod, ge
each have their own dial defaulting to 0; every other role (Timer, Camera Master, whatever gets
added) shares the single 'tag' dial (default 0) — one number, but a tag role only limits itself
(Timer doesn't block Grammarian). SAA/PO exempt (standing auto-fill). Stored in
`settings.roleGaps` keyed by GROUP (jsonb — no migration). Members get a greyed slot + reason
and a hard stop in `myBook`; officers get a confirm in `assign()` and can override.
`consecutiveSpeech()` still exists and only matters if the speech gap is set to 0. The
open-roles WhatsApp message (`openRolesMessage`) now also lists who has booked what
("Already booked — your reminder").

## Fixed 2026-08-23

- **Reducing the speaker count deleted the evaluator.** `spkDelta` moved the dropped speaker forward
  but called `unbookSlots` on `eval|N` — while the confirm dialog promised both would be moved. The
  club silently lost an evaluator booking every time the speaker count came down. Now both move, and
  the whole thing rolls back (`applySnapshot`) if either has nowhere to go.
- **A meeting with no slots for a role broke the chain.** `pushInto` treated it as a dead end rather
  than skipping it, so one Urdu night with zero speeches stranded everyone behind it.
- **The session diary threw away its own detail.** `authLogText` printed only the event and the
  online flag, and `api.refresh()` discarded the error entirely — so a member could send in a log
  saying `refresh-failed` and nothing more. Both now carry the reason, and a token the server has
  retired is cleared instead of being retried on every load.
- **The agenda now says the changeover time is there** (`#agBufNote`, under the table, prints on the
  PDF, both languages). Without it the To of one row and the From of the next differed by a minute
  nobody could account for.

## Recently added, worth knowing

Urdu agenda (per-meeting toggle, RTL, name inventory under Members → اردو نام) · Independence Day
green theme + one-click layout · movable/removable sessions, rows and the break; rows cross session
boundaries · Joke Master one-minute line · speakers can go to 0 · practice tab · password reset ·
move-forward with undo · attendance register · speech→project credit · Practice tab now mirrors
the live Vote Counter (candidates prefill from a fake meeting's bookings through the real
`prefillCandidates`, a "what members see" ballot card the trainee can vote on as `P_ME`, custom
categories start empty, 5 am rule explained). PARITY RULE: any change to the real Vote Counter
tab must be mirrored in the practice functions (`p*`) — it has drifted before.

