# Toastmasters club app — handoff

**Repo:** `C:\Users\mwaja\toastmasters-club-app` · **Live:** https://wajahat934.github.io/toastmasters-club-app/
**State:** live and in real club use. `main` is production — every push reaches members within ~1 minute.

---

## Do this before anything else

1. **Bump the cache-buster.** `index.html` carries `?v=NN` on four asset URLs — and
   `demo/index.html` carries three more (the hosted sandbox at `/demo/` shares the ROOT
   app.js/styles/assets, so it goes stale silently if its `?v` is forgotten). Bump ALL of them on
   every deploy or browsers serve the old `app.js`. Currently **v=88**.
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

## Outstanding — needs the user, not code

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
  realtime channel — but they only deliver once the user runs
  `alter publication supabase_realtime add table settings, agendas;` in the SQL editor.

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

