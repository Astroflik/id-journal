\set admin '00000000-0000-0000-0000-0000000000a1'
\set u1 '00000000-0000-0000-0000-000000000001'
\set u2 '00000000-0000-0000-0000-000000000002'
\set u3 '00000000-0000-0000-0000-000000000003'
\set u4 '00000000-0000-0000-0000-000000000004'
\set u5 '00000000-0000-0000-0000-000000000005'
\set u6 '00000000-0000-0000-0000-000000000006'
\set u7 '00000000-0000-0000-0000-000000000007'
\set u8 '00000000-0000-0000-0000-000000000008'
\set u9 '00000000-0000-0000-0000-000000000009'
\set u10 '00000000-0000-0000-0000-000000000010'
\set u11 '00000000-0000-0000-0000-000000000011'
\set u12 '00000000-0000-0000-0000-000000000012'
\set u13 '00000000-0000-0000-0000-000000000013'
\set dev 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

select t.chk('normalize: gmail dots, tag, googlemail', public.normalize_email('A.B+c@GoogleMail.com') = 'ab@gmail.com');
select t.chk('normalize: other domain keeps dots, drops tag', public.normalize_email(' First.Name+x@Example.com ') = 'first.name@example.com');
select t.chk('normalize: junk and null', public.normalize_email('noatsign') is null and public.normalize_email(null) is null);

select t.chk('backfill: existing account normalised and in the ledger',
  (select email_normalized = 'ilia@gmail.com' and trial_status = 'granted' from public.subscriptions where user_id = :'admin')
  and exists (select 1 from public.trial_ledger where email_normalized = 'ilia@gmail.com' and first_user_id = :'admin'));

insert into auth.users (id, email, email_confirmed_at) values (:'u1', 'new.user@gmail.com', now());
select t.chk('google account: 14-day trial', (select trial_status = 'granted' and trial_ends_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 minute' from public.subscriptions where user_id = :'u1'));

insert into auth.users (id, email, email_confirmed_at) values (:'u2', 'n.e.w.user+2@gmail.com', now());
select t.chk('same mailbox again: no second trial', (select trial_status = 'denied_duplicate' and trial_ends_at <= now() from public.subscriptions where user_id = :'u2'));

insert into auth.users (id, email, email_confirmed_at) values (:'u3', 'a@mailinator.com', now()), (:'u4', null, null), (:'u13', 'b@inbox.YOPMAIL.com', now());
select t.chk('disposable domain: no trial', (select trial_status = 'denied_disposable' from public.subscriptions where user_id = :'u3'));
select t.chk('disposable subdomain: no trial', (select trial_status = 'denied_disposable' from public.subscriptions where user_id = :'u13'));
select t.chk('no email: no trial', (select trial_status = 'denied_no_email' and trial_ends_at <= now() from public.subscriptions where user_id = :'u4'));

insert into auth.users (id, email) values (:'u5', 'p@example.com'), (:'u6', 'P+1@example.com');
select t.chk('unconfirmed email: waiting, no access', (select trial_status = 'awaiting_confirmation' and trial_ends_at <= now() from public.subscriptions where user_id = :'u5'));
update auth.users set email_confirmed_at = now() where id = :'u5';
select t.chk('confirmed email: trial starts then', (select trial_status = 'granted' and trial_ends_at > now() + interval '13 days' from public.subscriptions where user_id = :'u5'));
update auth.users set last_sign_in_at = now() where id = :'u5';
update auth.users set email_confirmed_at = now() where id = :'u6';
select t.chk('confirmed alias of a used mailbox: no trial', (select trial_status = 'denied_duplicate' from public.subscriptions where user_id = :'u6'));

delete from auth.users where id = :'u1';
insert into auth.users (id, email, email_confirmed_at) values (:'u7', 'newuser@gmail.com', now());
select t.chk('delete and re-register: no new trial', (select trial_status = 'denied_duplicate' from public.subscriptions where user_id = :'u7'));

-- broken internals must not block sign-up
alter table public.trial_ledger rename to trial_ledger_gone;
insert into auth.users (id, email, email_confirmed_at) values (:'u12', 'x@example.org', now());
alter table public.trial_ledger_gone rename to trial_ledger;
select t.chk('trigger failure: account still created, held for review', (select trial_status = 'pending_review' and trial_ends_at <= now() from public.subscriptions where user_id = :'u12'));

insert into auth.users (id, email, email_confirmed_at) values (:'u8', 'd1@example.org', now()), (:'u9', 'd2@example.org', now()), (:'u10', 'd3@example.org', now()), (:'u11', 'z@example.net', now());

-- ---- as ordinary signed-in users
set role authenticated;
select t.act(:'u2');
select t.chk('denied account cannot write', t.code($$select public.save_state(0, '{}'::jsonb)$$) = '42501');
select t.chk('my_access explains why', public.my_access() ->> 'status' = 'expired' and public.my_access() ->> 'trial' = 'denied_duplicate');
select t.act(:'u8');
select t.chk('first device: trial keeps running', public.register_device(:'dev') ->> 'status' = 'trial');
select t.chk('trial account can write', t.code($$select public.save_state(0, '{"jt":"[]"}'::jsonb)$$) = '00000');
select t.chk('bad device hash refused', t.code($$select public.register_device('not-a-hash')$$) = '22023');
select t.chk('non-admin: admin_list_users forbidden', t.code($$select * from public.admin_list_users()$$) = '42501');
select t.chk('non-admin: admin_approve_trial forbidden', t.code($$select public.admin_approve_trial('00000000-0000-0000-0000-000000000009')$$) = '42501');
select t.chk('non-admin: admin_block_domain forbidden', t.code($$select public.admin_block_domain('gmail.com')$$) = '42501');
select t.chk('non-admin: admin_blocked_domains forbidden', t.code($$select * from public.admin_blocked_domains()$$) = '42501');
select t.chk('tables are not readable through the API', t.code($$select * from public.trial_ledger$$) = '42501' and t.code($$select * from public.blocked_domains$$) = '42501');
select t.chk('internal functions are not callable', t.code($$select public.start_trial(gen_random_uuid(), 'q@q.io')$$) = '42501' and t.code($$select public.normalize_email('q@q.io')$$) = '42501');
select t.chk('user sees only the own subscription row', (select count(*) = 1 from public.subscriptions));
select t.act(:'u9');
select t.chk('second account on the same device: trial on hold', public.register_device(:'dev') ->> 'trial' = 'pending_review');
select t.chk('held account sees itself as expired', public.my_access() ->> 'status' = 'expired');
select t.chk('held account cannot write', t.code($$select public.save_state(0, '{}'::jsonb)$$) = '42501');
select t.act(:'u8');
select public.register_device('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') \g /dev/null
reset role;
select t.chk('only the first device is recorded', (select device_hash = :'dev' from public.subscriptions where user_id = :'u8'));

set role anon;
select t.act(null);
select t.chk('anonymous visitor cannot call anything new', t.code($$select public.register_device('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')$$) = '42501' and t.code($$select * from public.admin_list_users()$$) = '42501');
reset role;

-- ---- as the admin
set role authenticated;
select t.act(:'admin');
select t.chk('admin on a shared device is not held', public.register_device(:'dev') ->> 'status' = 'admin');
select t.chk('admin sees the signals', (select trial_status = 'pending_review' and same_device_accounts = 2 from public.admin_list_users() where user_id = :'u9')
  and (select same_mailbox_accounts >= 1 from public.admin_list_users() where user_id = :'u2'));
select t.chk('admin approves the held trial', public.admin_approve_trial(:'u9') > now() + interval '13 days');
select public.admin_grant(:'u10', 30) \g /dev/null
select t.act(:'u9');
select t.chk('approved account has its trial', public.my_access() ->> 'status' = 'trial' and public.my_access() ->> 'trial' = 'granted');
select t.act(:'u10');
select t.chk('paying account on a shared device keeps access', public.register_device(:'dev') ->> 'status' = 'active');
select t.act(:'admin');
select public.admin_revoke(:'u9') \g /dev/null
select t.chk('admin revokes', (select trial_status = 'revoked' and not has_access from public.admin_list_users() where user_id = :'u9'));
select t.chk('admin blocks a domain (any letter case)', t.code($$select public.admin_block_domain(' Example.NET ', 'test')$$) = '00000');
select t.chk('blocked domain is listed in lower case', (select count(*) = 1 from public.admin_blocked_domains() where domain = 'example.net'));
reset role;
insert into auth.users (email, email_confirmed_at) values ('late@example.net', now());
select t.chk('newly blocked domain gets no trial', (select s.trial_status = 'denied_disposable' from public.subscriptions s where s.email_normalized = 'late@example.net'));
set role authenticated;
select t.chk('bad domain refused', t.code($$select public.admin_block_domain('not a domain')$$) <> '00000');
select public.admin_unblock_domain('example.net') \g /dev/null
select t.chk('admin unblocks a domain', (select count(*) = 0 from public.admin_blocked_domains() where domain = 'example.net'));
reset role;
select t.chk('admin actions are logged', (select count(*) from public.admin_actions where action in ('approve_trial', 'revoke', 'block_domain', 'unblock_domain', 'grant')) = 5);
select t.chk('starter list of disposable domains loaded', (select count(*) >= 40 from public.blocked_domains));
