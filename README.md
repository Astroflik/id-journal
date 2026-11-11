# Journal by myIDgod

## Run locally

Ruby 2.6 or newer is required. From this folder, run:

```sh
ruby server.rb
```

Then open <http://127.0.0.1:8766/>. If that port is in use, choose another with
`PORT=8767 ruby server.rb`. The server delivers the app, its logo asset,
account endpoints, and persistent account data from the same origin.

## Accounts and data

- The published site uses [Supabase](https://supabase.com): sign-in with Google,
  one row per user in `journal_state`, screenshots in the private `shots`
  bucket. Setup, rollback and what is safe to publish:
  [deploy/supabase.md](./deploy/supabase.md).
- `public/supabase-config.js` holds only the project URL and the publishable
  key. Both are public by design; access is enforced in the database (row level
  security and functions). Never put any other key in this repository.
- Every new account gets a 14-day trial. After the trial or subscription ends
  the journal is view and export only; nothing is deleted.
- Account sync is limited to 5 MB per account. Two devices cannot silently
  overwrite each other: a stale save is merged by trade and plan id.
- Media stored in browser IndexedDB (such as intro videos and custom video
  backgrounds) stays on that browser and is not included in account sync.
- Without `supabase-config.js` the app falls back to the legacy local Ruby
  server (`ruby server.rb`, email and password, data in `.data/`). See
  [deploy/oracle-cloud.md](./deploy/oracle-cloud.md).
- `public/firebase-config.js`, `firestore.rules` and
  `deploy/github-pages-firebase.md` are kept only until the old Firebase data
  is migrated; the page no longer loads Firebase.

## Structure

- `public/journal.html` is a small shell; the app lives in `public/app.js` and
  `public/app.css`. When you change them, bump the `?v=` value in the tags in
  `journal.html` so browsers do not keep an old cached copy.
- `public/briefing.js` / `public/briefing.css` are the left-docked Briefing
  panel and the "Export for Claude" button.
- `public/briefing/latest.json` and `history.json` hold the daily briefing and
  the accuracy scoreboard (format: `public/briefing/README.md`). The repository
  is public, so never put personal data, trades, or third-party paid material
  there.
- `public/vendor/supabase.js` is the unmodified browser build of
  `@supabase/supabase-js` (version and checksum in `deploy/supabase.md`).
- `supabase/migrations/` is the database schema in the order it was applied
  (accounts, trial, subscriptions, admin functions, trial abuse protection).
  `tests/db/run.sh` applies it to a throwaway local Postgres 16 and checks it.
- `tests/sync_smoke.py` checks sign-in, sync, merge, read-only mode and
  screenshots in headless Chrome with a fake backend: `python3 tests/sync_smoke.py`.

## Screenshots

Screenshots are no longer stored inside the 5 MB synced state. They live in the
browser's IndexedDB and, when you are signed in, as files `<user id>/<shot id>`
in the private Supabase Storage bucket `shots` (2 MB limit per file). Older
screenshots stored inline are migrated automatically on load. Each screenshot
is compressed to at most about 550 KB. Backups include screenshots.

## Animations

Tab transitions have three modes in the customization panel: fast (default,
about 0.25 s), full (cinematic, about 2.3 s) and off. The intro can be skipped
with a click, Esc, Space or Enter.

## MetaTrader 5

The journal currently supports **manual import** of MT5/ATAS CSV, HTML, and
Excel reports. It does not connect to a terminal or import trades automatically.
For live sync, the usual next step is a small MQL5 Expert Advisor or script on
the machine running MT5 that reads closed deal history and sends normalized
records to an authenticated server endpoint. The web page cannot directly read a
desktop MT5 terminal, and the user's trading password should never be entered
into the journal. Before enabling live sync, add per-account access tokens,
duplicate protection based on MT5 deal IDs, and a way to revoke the connector.
An MT5 Manager/broker API is another option only if the broker provides access.

## Video cards

Card audio is captured from the selected video's audio track. Some embedded
browsers do not expose AAC audio tracks to web pages even when the file contains
sound. In that case the journal reports the limitation instead of saving a
misleading silent MP4; open the journal in an up-to-date Safari or Chrome
browser to use video sound and export.
