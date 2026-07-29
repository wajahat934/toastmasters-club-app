# Rawalpindi Toastmasters Club — Club App

Multi-user club tool: members book meeting roles for themselves; the three
admins (President + 2 officers) run everything — schedule, printable agendas,
member accounts, Pathways tracking, and the DCP dashboard.

| Who | Can do |
|---|---|
| **Admin** (3 officers) | Everything: assign/modify any slot, approve or deactivate accounts, promote/demote admins, record level completions, build agendas, DCP, settings |
| **Member** (approved account) | See the next 3 meetings, book **open** slots for themselves, release their own bookings, edit their own path/projects/goals |
| **New signup** | Nothing until an admin approves them |
| **Guests / no-login roster people** | Added by admins; bookable by admins; no account needed |

**Try it first:** open `index.html` in a browser right now — with no
configuration it runs in **demo mode** with sample data (buttons to enter as
admin or member). Nothing is saved in demo mode.

---

## Setup (one time, ~15 minutes)

### 1. Create the database (Supabase, free)

1. Go to https://supabase.com → **Start your project** → sign up (GitHub login works).
2. **New project** → name it `toastmasters-club`, choose a strong database
   password (you won't need it day-to-day), region `ap-south-1` (Mumbai — closest).
3. Wait ~2 min for the project to provision.
4. Left sidebar → **SQL Editor** → **New query** → paste the entire contents of
   `schema.sql` → **Run**. It should say "Success".
5. Left sidebar → **Authentication → Sign In / Up → Auth Providers → Email**:
   turn **OFF** "Confirm email" (otherwise every member needs a confirmation
   email; you can turn it back on later if you set up SMTP).

### 1b. Load the club's real data (recommended)

Still in the SQL Editor, run the contents of `seed.sql` — it loads the 20
members and all bookings imported from the club's role-booking Google Sheet
(Jul 18 – Sep 26, 2026), so nobody starts from an empty app.

### 2. Connect the app

1. In Supabase: **Project Settings → API** (or **Data API**). Copy:
   - **Project URL** (like `https://abcdefgh.supabase.co`)
   - **anon / public key** (long string)
2. Open `config.js` in this folder and paste both values.
   The anon key is *meant* to be public — all protection is enforced by the
   database rules in `schema.sql`, not by hiding the key.

### 3. Make yourself the first admin

1. Open `index.html` in your browser (double-click works now that config is set).
2. **Create an account** with your name, email, password.
   You'll land on the "waiting for approval" screen — expected.
3. Back in Supabase → **SQL Editor** → run the "FIRST ADMIN" block from the
   bottom of `seed.sql` (it links your login to your seeded roster entry and
   makes it admin). If you skipped seeding, run instead:

   ```sql
   update profiles set role='admin', approved=true
   where email = 'mwajahat934@gmail.com';
   ```

4. Refresh the app — you're in with full admin tabs.
5. Ask the President and your co-officer to sign up in the app, then in the
   **Members** tab use **Approve & merge with roster** on their signup (links
   them to their seeded entry) and **Make admin** on their card.

### 4. Publish on GitHub Pages

1. Open **GitHub Desktop** → File → **Add local repository** → choose this
   folder → it will offer to create a repository here → create it
   (keep "Git ignore: None", license optional).
2. Commit all files ("initial club app") → **Publish repository** →
   ✅ keep it public or private — **note:** GitHub Pages on a *private* repo
   requires a paid plan, so choose **public** (the app itself still requires
   login; only the code is public).
3. On github.com open the repo → **Settings → Pages** →
   Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save.
4. After ~1 minute your app is live at
   `https://<your-username>.github.io/<repo-name>/` — share this link with members.

Every future change: commit in GitHub Desktop → push → Pages updates itself.

---

## Day-to-day

- **Members** open the link, sign in, and grab open slots — updates appear
  live for everyone (no refresh needed).
- **Admins** get the full dashboard. The Agenda tab pre-fills role players
  from bookings and prints a one-page A4 PDF.
- Completion tracking is automatic after each meeting date; only step in for
  absences / role changes (Roles & Meetings → past meetings), then Mark reviewed.
- New signups appear at the top of the Members tab for approval.
- **Data snapshot** button in Settings downloads a JSON backup any time.

## Files

| File | What |
|---|---|
| `index.html` | App shell + login screens |
| `app.js` | All logic (admin + member views, Supabase data layer, demo mode) |
| `styles.css` | Styling incl. the printable agenda sheet |
| `assets.js` | Embedded club badge + ExCom banner for agendas |
| `config.js` | Your Supabase URL + anon key (edit this) |
| `schema.sql` | Database tables + security rules (run once in Supabase) |
