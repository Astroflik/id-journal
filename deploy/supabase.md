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
  version in `public/app/index.html` and the checksum here, run the test.
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

## Trial rules (migration 0002)

- One free trial per mailbox. Gmail dots and `+tags` count as the same
  mailbox, and the mailbox is remembered after the account is deleted.
- No trial for disposable mail domains (`blocked_domains`, managed by the
  admin) or for accounts without an email.
- An email/password account starts its trial when the email is confirmed.
- `register_device(hash)`: the site may send a hash of browser traits after
  sign-in. A second trial from the same browser is put on hold
  (`pending_review`) until the admin approves it. It is a signal, not a ban,
  and must be mentioned in the privacy policy once the site sends it.
- `my_access()` returns `trial` with the reason when there is no trial.
- IP addresses are not used for any of this.

## Profiles and clans (migration 0003)

- Everything goes through RPC functions; the tables (`profiles`, `clans`,
  `clan_members`, `clan_invites`, `clan_messages`) have RLS on and no grants.
- Profile: `my_profile()`, `save_profile(nick, bio, links, avatar_path)`,
  `get_profile(target)`. Nick 3–20 chars, unique ignoring case; up to 5 https links.
- Clan: `create_clan`, `update_clan` (null keeps a field, emblem `''` removes it),
  `my_clan`, `clan_create_invite(days, max_uses)`, `clan_invites_list`,
  `clan_revoke_invite`, `clan_preview(code)`, `clan_join(code)`, `clan_leave`,
  `clan_set_role(target, role)` (leader only; `leader` hands the clan over),
  `clan_kick(target)`, `clan_disband`. One clan per user, up to 50 members.
  When the leader leaves, the oldest officer (else member) leads; the last
  member leaving removes the clan.
- Chat: `clan_send(body)` (20 messages a minute), `clan_messages(after_id,
  before_id, lim)`, `clan_delete_message(id)` (author, officer, leader).
- Writing needs an active trial/subscription; leaving a clan is always allowed.
  Errors come back as text codes (`nick_taken`, `invite_invalid`, …).
- Avatars and emblems: public bucket `avatars`, 512 KB, png/jpeg/webp, path
  `<user id>/<file>`; only the owner writes there.

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
