# Accounts and sync with Supabase

The site is static (GitHub Pages). Accounts, the journal state and screenshots
live in a Supabase project; the browser talks to it directly.

## What is in this repository, and why it is safe

- `public/supabase-config.js`: project URL and the **publishable** key
  (`sb_publishable_…`). This key only identifies the project. Everything a
  visitor can do is decided by row level security and the functions in the
  database, so the key is meant to be public.
- `public/vendor/supabase.js`: `@supabase/supabase-js` 2.119.0,
  `dist/umd/supabase.js` from the npm package, unmodified.
  SHA-256 `a867edbcfb029370aeec7223dd6180b560b621fbe3bc64c6584fb0369d1b7bce`.
  To update: download the new npm package, replace the file, update the
  version in `public/journal.html` and the checksum here, run the test.
- Never commit: the secret (`sb_secret_…`) or `service_role` key, the Google
  OAuth client secret, database passwords, user data.

## How it works

- Sign-in: Google through Supabase Auth (PKCE). The browser returns to the page
  it started from; that address must be listed in Supabase under
  Authentication → URL Configuration → Redirect URLs.
- Journal state: one row per user in `public.journal_state`. Reads are a plain
  select (own row only). Writes go through `save_state(expected_rev, new_state)`,
  which refuses a stale revision; the app then rereads, merges by trade and
  plan id, and saves again.
- Access: `my_access()` returns `admin`, `trial`, `active` or `expired`.
  When access has ended, `save_state` refuses to write and the app switches to
  view and export only.
- Screenshots: private bucket `shots`, path `<user id>/<shot id>`.
- The sign-in session is stored in the browser under keys starting with `sb-`.
  The app never syncs, exports or wipes those together with journal data.

## After moving the site to another address

Add the new address to Redirect URLs (and set it as Site URL) in Supabase, and
to the authorized domains of the Google OAuth consent screen.

## Rolling back

Revert the commit that switched the page to Supabase. The old Firebase project
and its data are untouched until the migration is confirmed.

## Checking a change

```sh
pip install playwright   # once; uses the installed Chrome
python3 tests/sync_smoke.py
```
