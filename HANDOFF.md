# Toastmasters club app — handoff

**Repo:** `C:\Users\mwaja\toastmasters-club-app` · **Live:** https://wajahat934.github.io/toastmasters-club-app/
**State:** live and in real club use. `main` is production — every push reaches members within ~1 minute.

---

## Do this before anything else

1. **Bump the cache-buster.** `index.html` carries `?v=NN` on four asset URLs. Bump it on every
   deploy or browsers serve the old `app.js`. There is no service worker; that bump is the only
   cache control. Currently **v=68**.
2. **Verify against a demo copy, not the live app.** Copy the repo to a scratch folder and replace
   `config.js` with placeholder values (`https://YOUR-PROJECT.supabase.co`) — the app then runs in
   DEMO MODE with fake in-memory data. Serve it and drive it with the browser tools.
3. **Watch for backslash halving.** Writing JS through Bash/python heredocs eats one level of
   backslash. `\b` in a patch became a literal backspace byte inside three regexes once, and the
   file still parsed. After any scripted edit: `node --check app.js` **and** grep for control
   characters.

---

## Outstanding — needs the user, not code

- **Supabase → Auth → URL Configuration.** Site URL *and* Redirect URLs must both list the Pages
  URL, or password-reset emails land nowhere. **Still not confirmed done.**
- **Booking-time migration**, never run:
  `alter table assignments add column booked_at timestamptz not null default now();`
  Until then the move-forward fairness rule falls back to slot order instead of real booking time.
- **Urdu wording review.** The Urdu is machine-written. Least trustworthy: ناظمِ انتظامات (SAA),
  صدرِ اجلاس (Presiding Officer), مجموعی تجزیہ کار (General Evaluator). The sheet is click-to-edit,
  and `AG_UR_RETIRED` + `healRetiredWording()` migrate saved sheets when a wording changes —
  that is how Table Topics became فی البدیہہ تقاریر.

## Open questions the user never answered

- Should evaluators follow their speaker when junior-first reorders the speakers?
- Should the speech→project credit prompt automatically at review instead of relying on the dropdown?
- Confirm the move-forward rule direction: built as **last to book gives way**, inferred from the
  user's wording, never confirmed.

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
- **Test the messy case, not the tidy one.** Three fixes came back because the demo sheet had keys
  and the club's did not. The club's saved agendas predate most of these features.

## Recently added, worth knowing

Urdu agenda (per-meeting toggle, RTL, name inventory under Members → اردو نام) · Independence Day
green theme + one-click layout · movable/removable sessions, rows and the break; rows cross session
boundaries · Joke Master one-minute line · speakers can go to 0 · practice tab · password reset ·
move-forward with undo · attendance register · speech→project credit.

