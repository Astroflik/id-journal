-- Journal by myIDgod: trial abuse protection.
--   * one trial per mailbox (Gmail dots and "+tags" are the same mailbox),
--     remembered even after the account is deleted;
--   * no trial for disposable mail domains or accounts without an email;
--   * the trial of an email/password account starts when the email is confirmed;
--   * a soft device signal: a second trial from the same browser is put on
--     hold for the admin to approve (never a hard ban);
--   * the admin sees the signals and can approve, revoke and manage domains.
-- Nothing here depends on IP addresses. Everything is enforced in the
-- database; the site code is public.

-- ---------------------------------------------------------------- tables

create table public.blocked_domains (
  domain text primary key check (domain = lower(domain)),
  note text,
  created_at timestamptz not null default now()
);

-- Which mailbox has already had a trial. No foreign key on purpose: the row
-- must outlive the account, or deleting and re-registering resets the trial.
create table public.trial_ledger (
  email_normalized text primary key,
  first_user_id uuid,
  created_at timestamptz not null default now()
);

alter table public.blocked_domains enable row level security;
alter table public.trial_ledger enable row level security;
-- no policies: reachable only through the functions below

alter table public.subscriptions
  add column email_normalized text,
  add column trial_status text not null default 'granted'
    check (trial_status in ('granted', 'awaiting_confirmation', 'denied_duplicate',
                            'denied_disposable', 'denied_no_email', 'pending_review', 'revoked')),
  add column device_hash text,
  add column device_seen_at timestamptz;

create index subscriptions_device_hash_idx on public.subscriptions (device_hash) where device_hash is not null;
create index subscriptions_email_normalized_idx on public.subscriptions (email_normalized);

-- ---------------------------------------------------------------- helpers

-- a.b+tag@googlemail.com -> ab@gmail.com ; Name+x@Example.com -> name@example.com
create function public.normalize_email(email text) returns text
language sql immutable set search_path = public as $$
  select case
    when email is null or position('@' in email) = 0 then null
    else (
      select case
        when p.d in ('gmail.com', 'googlemail.com') then replace(split_part(p.l, '+', 1), '.', '') || '@gmail.com'
        else split_part(p.l, '+', 1) || '@' || p.d end
      from (select lower(btrim(split_part(email, '@', 1))) as l,
                   lower(btrim(split_part(email, '@', 2))) as d) p)
  end;
$$;

-- Decide the trial for one account and write its subscription row.
-- Safe to call again: only a row still waiting for confirmation is changed.
create function public.start_trial(uid uuid, email text) returns void
language plpgsql security definer set search_path = public as $$
declare
  norm text := public.normalize_email(email);
  dom text := split_part(norm, '@', 2);
  claimed integer;
  verdict text;
begin
  if norm is null or dom = '' then
    verdict := 'denied_no_email';
  elsif exists (select 1 from public.blocked_domains b
                where dom = b.domain or dom like '%.' || b.domain) then
    verdict := 'denied_disposable';
  else
    insert into public.trial_ledger (email_normalized, first_user_id)
    values (norm, uid) on conflict (email_normalized) do nothing;
    get diagnostics claimed = row_count;
    if claimed = 1 or exists (select 1 from public.trial_ledger t
                              where t.email_normalized = norm and t.first_user_id = uid) then
      verdict := 'granted';
    else
      verdict := 'denied_duplicate';
    end if;
  end if;

  insert into public.subscriptions (user_id, trial_ends_at, email_normalized, trial_status)
  values (uid, case when verdict = 'granted' then now() + interval '14 days' else now() end, norm, verdict)
  on conflict (user_id) do update
    set trial_ends_at = excluded.trial_ends_at, email_normalized = excluded.email_normalized,
        trial_status = excluded.trial_status, updated_at = now()
    where public.subscriptions.trial_status = 'awaiting_confirmation';
end;
$$;

-- New account. Google accounts arrive with a confirmed email and are decided
-- at once; email/password accounts wait for the confirmation link.
-- A failure here must never block sign-up: the account is then created
-- without a trial and shows up for the admin to review.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.email is null or new.email_confirmed_at is not null then
      perform public.start_trial(new.id, new.email);
    else
      insert into public.subscriptions (user_id, trial_ends_at, email_normalized, trial_status)
      values (new.id, now(), public.normalize_email(new.email), 'awaiting_confirmation')
      on conflict (user_id) do nothing;
    end if;
  exception when others then
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
    insert into public.subscriptions (user_id, trial_ends_at, trial_status)
    values (new.id, now(), 'pending_review')
    on conflict (user_id) do nothing;
  end;
  return new;
end;
$$;

create function public.handle_user_confirmed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.start_trial(new.id, new.email);
  exception when others then
    raise warning 'handle_user_confirmed failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger on_auth_user_confirmed
  after update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.handle_user_confirmed();

-- ---------------------------------------------------------------- user API

-- Status for the UI. 'status' and 'until' are unchanged; 'trial' explains why
-- there is no trial: granted | awaiting_confirmation | denied_duplicate |
-- denied_disposable | denied_no_email | pending_review | revoked.
create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then jsonb_build_object('status','admin','until',null)
    else (
      select jsonb_build_object(
        'status', case
          when now() >= greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at)) then 'expired'
          when s.paid_until is not null and s.paid_until > s.trial_ends_at then 'active'
          else 'trial' end,
        'until', greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at)),
        'trial', s.trial_status)
      from public.subscriptions s where s.user_id = auth.uid())
  end;
$$;

-- The site sends a hash of browser traits once, right after the first sign-in.
-- Only the first device of an account is recorded. If another account already
-- used this device, a running free trial is put on hold until the admin looks.
-- Paid time and admins are never affected.
create function public.register_device(hash text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  known text;
  others integer;
  hold boolean;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if hash is null or hash !~ '^[0-9a-f]{32,64}$' then raise exception 'bad_device_hash' using errcode = '22023'; end if;

  select s.device_hash into known from public.subscriptions s where s.user_id = uid for update;
  if not found then raise exception 'no_subscription'; end if;

  if known is null then
    select count(*) into others from public.subscriptions o where o.device_hash = hash and o.user_id <> uid;
    hold := others > 0 and not public.is_admin();
    update public.subscriptions s
       set device_hash = hash, device_seen_at = now(), updated_at = now(),
           trial_status = case when hold and s.trial_status = 'granted' and s.paid_until is null
                               then 'pending_review' else s.trial_status end,
           trial_ends_at = case when hold and s.trial_status = 'granted' and s.paid_until is null
                                then least(s.trial_ends_at, now()) else s.trial_ends_at end
     where s.user_id = uid;
  end if;
  return public.my_access();
end;
$$;

-- ---------------------------------------------------------------- admin API

drop function public.admin_list_users();
create function public.admin_list_users() returns table (
  user_id uuid, email text, created_at timestamptz,
  trial_ends_at timestamptz, paid_until timestamptz, note text, has_access boolean,
  email_normalized text, trial_status text,
  same_mailbox_accounts integer, same_device_accounts integer,
  device_seen_at timestamptz, last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select u.id, u.email::text, u.created_at, s.trial_ends_at, s.paid_until, s.note,
           now() < greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at)),
           s.email_normalized, s.trial_status,
           (select count(*)::integer from public.subscriptions m
             where m.email_normalized = s.email_normalized and m.user_id <> s.user_id),
           (select count(*)::integer from public.subscriptions d
             where d.device_hash = s.device_hash and d.user_id <> s.user_id),
           s.device_seen_at, u.last_sign_in_at
    from auth.users u join public.subscriptions s on s.user_id = u.id
    order by u.created_at desc;
end;
$$;

-- Give (or give back) a free trial of `days` days starting now.
create function public.admin_approve_trial(target uuid, days integer default 14)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare ends timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if days is null or days < 1 or days > 60 then raise exception 'bad_days'; end if;
  update public.subscriptions s
     set trial_ends_at = now() + make_interval(days => days), trial_status = 'granted', updated_at = now()
   where s.user_id = target
   returning s.trial_ends_at into ends;
  if ends is null then raise exception 'user_not_found'; end if;
  insert into public.admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), target, 'approve_trial', jsonb_build_object('days', days, 'trial_ends_at', ends));
  return ends;
end;
$$;

-- End paid access and trial immediately (data stays, read-only).
create or replace function public.admin_revoke(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.subscriptions
     set paid_until = now(), trial_ends_at = least(trial_ends_at, now()),
         trial_status = 'revoked', updated_at = now()
   where user_id = target;
  insert into public.admin_actions (admin_id, target_id, action) values (auth.uid(), target, 'revoke');
end;
$$;

create function public.admin_blocked_domains() returns table (domain text, note text, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query select b.domain, b.note, b.created_at from public.blocked_domains b order by b.domain;
end;
$$;

create function public.admin_block_domain(domain text, note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(btrim(domain));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if d is null or d !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then raise exception 'bad_domain'; end if;
  insert into public.blocked_domains as b (domain, note) values (d, admin_block_domain.note)
  on conflict on constraint blocked_domains_pkey do update set note = coalesce(excluded.note, b.note);
  insert into public.admin_actions (admin_id, action, detail)
  values (auth.uid(), 'block_domain', jsonb_build_object('domain', d, 'note', note));
end;
$$;

create function public.admin_unblock_domain(domain text) returns void
language plpgsql security definer set search_path = public as $$
declare d text := lower(btrim(domain));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.blocked_domains b where b.domain = d;
  insert into public.admin_actions (admin_id, action, detail)
  values (auth.uid(), 'unblock_domain', jsonb_build_object('domain', d));
end;
$$;

-- ---------------------------------------------------------------- existing accounts

update public.subscriptions s
   set email_normalized = public.normalize_email(u.email)
  from auth.users u
 where u.id = s.user_id;

insert into public.trial_ledger (email_normalized, first_user_id, created_at)
select distinct on (s.email_normalized) s.email_normalized, s.user_id, s.created_at
from public.subscriptions s
where s.email_normalized is not null
order by s.email_normalized, s.created_at
on conflict (email_normalized) do nothing;

-- ---------------------------------------------------------------- starter list
-- Well-known throwaway mailbox services. Extend from the admin panel.

insert into public.blocked_domains (domain, note)
select d, 'starter list' from unnest(array[
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'sharklasers.com',
  'grr.la', '10minutemail.com', '10minutemail.net', 'temp-mail.org', 'tempmail.com', 'tempmail.net',
  'tempmailo.com', 'temp-mail.io', 'tempail.com', 'throwawaymail.com', 'yopmail.com', 'yopmail.net',
  'yopmail.fr', 'trashmail.com', 'trashmail.net', 'getnada.com', 'nada.email', 'dispostable.com',
  'maildrop.cc', 'mohmal.com', 'fakeinbox.com', 'emailondeck.com', 'mintemail.com', 'moakt.com',
  'mailnesia.com', 'discard.email', 'mailcatch.com', 'spamgourmet.com', 'mytemp.email', 'tmpmail.org',
  'tmpmail.net', 'minuteinbox.com', 'emailfake.com', 'fakemail.net', 'burnermail.io', 'inboxkitten.com',
  'mail.tm', 'mail.gw', 'guerrillamailblock.com', 'spam4.me', 'tempr.email', 'luxusmail.org',
  '1secmail.com', '1secmail.org', '1secmail.net'
]) as d
on conflict (domain) do nothing;

-- ---------------------------------------------------------------- privileges

revoke all on public.blocked_domains, public.trial_ledger from anon, authenticated;
revoke all on function public.normalize_email(text), public.start_trial(uuid, text),
  public.handle_user_confirmed(), public.register_device(text), public.admin_list_users(),
  public.admin_approve_trial(uuid, integer), public.admin_blocked_domains(),
  public.admin_block_domain(text, text), public.admin_unblock_domain(text)
  from public, anon, authenticated;
grant execute on function public.register_device(text), public.admin_list_users(),
  public.admin_approve_trial(uuid, integer), public.admin_blocked_domains(),
  public.admin_block_domain(text, text), public.admin_unblock_domain(text) to authenticated;
