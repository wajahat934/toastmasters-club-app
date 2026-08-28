# Toastmasters club app — handoff

**Repo:** `C:\Users\mwaja\toastmasters-club-app` · **Live:** https://wajahat934.github.io/toastmasters-club-app/
**State:** live and in real club use. `main` is production — every push reaches members within ~1 minute.

---

## Do this before anything else

1. **Bump the cache-buster.** `index.html` carries `?v=NN` on four asset URLs. Bump it on every
   deploy or browsers serve the old `app.js`. There is no service worker; that bump is the only
   cache control. Currently **v=71**.
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
  book/adminAssign/unbook/setAsg. Demo mode is synchronous, so it can never reproduce this: any
  future change to the write path has to be reasoned about, not just demo-tested.
- **Test the messy case, not the tidy one.** Three fixes came back because the demo sheet had keys
  and the club's did not. The club's saved agendas predate most of these features.

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

