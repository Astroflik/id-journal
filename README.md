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

- The legacy Ruby backend uses PBKDF2-HMAC-SHA256 password hashes and random,
  HttpOnly, SameSite sessions that expire after 30 days.
- When `public/firebase-config.js` contains a Firebase project config, email and
  password sign-in uses Firebase Authentication, and trades, plans, settings,
  and other local-storage journal data sync to that user's Firestore account.
  Without Firebase config, the local Ruby server provides the existing
  email/password backend.
- The default account store is the private `.data/accounts.pstore` file. Back it
  up securely; do not put it in a public static directory or commit it.
- Account sync is limited to 5 MB per account.
- Media stored in browser IndexedDB (such as intro videos and custom video
  backgrounds) stays on that browser and is not included in account sync.

For a free static hosting setup with GitHub Pages and Firebase, see
[deploy/github-pages-firebase.md](./deploy/github-pages-firebase.md). For
server-based hosting, the Ruby backend is still available; see
[deploy/oracle-cloud.md](./deploy/oracle-cloud.md).

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

## Screenshots

Screenshots are no longer stored inside the 5 MB synced state. They live in the
browser's IndexedDB and, when you are signed in, as separate Firestore
documents `users/{uid}/journal/shot_{id}` (covered by the existing rules).
Older screenshots stored inline are migrated automatically on load. Each
screenshot is compressed to at most about 550 KB (Firestore documents are
limited to 1 MiB). Backups include screenshots.

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
