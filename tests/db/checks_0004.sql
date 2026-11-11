-- Stages 3-4: look-alike-proof names, social links, bans, reports. Runs after checks_0003.
-- State from 0003: a = deleted account, b = Борис, c = Clara (leader of ZED "Zed Again"), d = Dima, z = Zoe, x = no access.
\set a '00000000-0000-0000-0000-0000000000b1'
\set b '00000000-0000-0000-0000-0000000000b2'
\set c '00000000-0000-0000-0000-0000000000b3'
\set d '00000000-0000-0000-0000-0000000000b4'
\set x '00000000-0000-0000-0000-0000000000b5'
\set z '00000000-0000-0000-0000-0000000000b6'
\set m '00000000-0000-0000-0000-0000000000c1'

insert into auth.users (id, email, email_confirmed_at) values (:'m', 'mod.c@gmail.com', now());
insert into public.admins (user_id) values (:'m');

select t.chk('0004: skeleton folds case, separators and look-alikes',
  public.name_skeleton('Anna_Trader') = public.name_skeleton('аnnа.trаder')          -- Cyrillic а
  and public.name_skeleton('myIDgod') = public.name_skeleton('MY-1DG0D')
  and public.name_skeleton('Борис') <> public.name_skeleton('Boris1'));
select t.chk('0004: new tables locked', not has_table_privilege('authenticated', 'public.bans', 'select')
  and not has_table_privilege('authenticated', 'public.reports', 'select') and not has_table_privilege('anon', 'public.reports', 'insert'));
select t.chk('0004: helpers not callable', not has_function_privilege('authenticated', 'public.is_banned(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.name_skeleton(text)', 'execute'));
select t.chk('0004: reports bucket is private', (select not public and file_size_limit = 2097152 from storage.buckets where id = 'reports'));

set role anon;
select t.chk('anon: cannot report', t.code($$select public.submit_report('bug', 'bug_ui', 'button is broken')$$) = '42501');
reset role;

set role authenticated;
-- unique names, look-alikes included
select t.act(:'d');
select t.chk('look-alike nick refused (Latin o, p, c in a Cyrillic nick)', t.err($$select public.save_profile('Бopиc')$$) = 'nick_taken');
select t.chk('nick with zero for o refused', t.err($$select public.save_profile('Z0E')$$) = 'nick_taken');
select t.chk('name_available: taken look-alike', public.name_available('nick', 'Бо-рис') = false);
select t.chk('name_available: own nick counts as free', public.name_available('nick', 'dima') = true);
select t.chk('name_available: new nick free', public.name_available('nick', 'Dmitry_NQ') = true);
select t.act(:'z');
select public.create_clan('A1B', 'Alpha One') \g :nul
select t.act(:'d');
select t.chk('clan tag look-alike refused (I and l for 1)', t.err($$select public.create_clan('AIB', 'Other Squad')$$) = 'tag_taken'
  and t.err($$select public.create_clan('ALB', 'Other Squad')$$) = 'tag_taken');
select t.chk('a different tag is fine', t.err($$select public.create_clan('Z3D', 'Third Squad')$$) = 'ok' and t.err($$select public.clan_leave()$$) = 'ok');
select t.chk('clan name look-alike refused', t.err($$select public.create_clan('QQQ', 'zed  again')$$) = 'name_taken');
select t.chk('clan name differs only by dashes refused', t.err($$select public.create_clan('QQQ', 'Zed-Again')$$) = 'name_taken');
select t.chk('clan tag taken refused', t.err($$select public.create_clan('ZED', 'Totally New')$$) = 'tag_taken');
select t.chk('name_available: clan name', public.name_available('clan_name', 'ZED AGAIN') = false and public.name_available('clan_name', 'Brand New') = true);
select t.chk('name_available: clan tag', public.name_available('clan_tag', 'zed') = false);
select t.act(:'c');
select t.chk('leader keeps own clan name on rename to same', public.update_clan('Zed Again') ->> 'name' = 'Zed Again');
select t.chk('own clan name counts as free', public.name_available('clan_name', 'zed again') = true);

-- social links
select t.act(:'b');
select t.chk('save socials: @, links and case are normalised',
  (select s -> 'socials' = '{"discord":"anna.flow","telegram":"anna_nq","tiktok":"anna.trades"}'::jsonb
     from public.save_socials('@Anna.Flow', 'https://t.me/anna_nq', 'https://www.tiktok.com/@anna.trades?lang=en') s));
select t.chk('socials appear on the public card', (select public.get_profile(:'b') #>> '{socials,telegram}') = 'anna_nq');
select t.chk('bad telegram refused', t.err($$select public.save_socials(null, 'ab', null)$$) = 'telegram_invalid');
select t.chk('bad discord refused', t.err($$select public.save_socials('a b c', null, null)$$) = 'discord_invalid');
select t.chk('empty clears a field', public.save_socials('anna.flow', '', null) #>> '{socials,telegram}' is null);
select t.act(:'x');
select t.chk('no access: socials are read-only', t.code($$select public.save_socials('x1', null, null)$$) = '42501');

-- reports
select t.act(:'b');
select t.chk('report a user', t.err(format($q$select public.submit_report('user', 'impersonation', 'pretends to be Anna', %L)$q$, :'d')) = 'ok');
select t.chk('report with own screenshot', t.err(format($q$select public.submit_report('user', 'spam', 'spams the clan chat', %L, '', array[%L])$q$, :'d', :'b' || '/r1.webp')) = 'ok');
select t.chk('foreign screenshot refused', t.err(format($q$select public.submit_report('user', 'spam', 'spams the chat', %L, '', array[%L])$q$, :'d', :'a' || '/r1.webp')) = 'evidence_invalid');
select t.chk('five screenshots refused', t.err(format($q$select public.submit_report('bug', 'bug_ui', 'broken button', null, '', array[%L,%L,%L,%L,%L])$q$,
  :'b' || '/1.webp', :'b' || '/2.webp', :'b' || '/3.webp', :'b' || '/4.webp', :'b' || '/5.webp')) = 'too_many_files');
select t.chk('cannot report self', t.err(format($q$select public.submit_report('user', 'spam', 'testing myself', %L)$q$, :'b')) = 'cannot_report_self');
select t.chk('bug category on a user report refused', t.err(format($q$select public.submit_report('user', 'bug_ui', 'wrong category', %L)$q$, :'d')) = 'category_invalid');
select t.chk('short details refused', t.err($$select public.submit_report('bug', 'bug_ui', 'bad')$$) = 'details_invalid');
select t.chk('bug report, target dropped', t.err(format($q$select public.submit_report('bug', 'bug_sync', 'trades vanished after sync', %L, 'stats')$q$, :'d')) = 'ok');
select t.chk('my_reports lists own reports', jsonb_array_length(public.my_reports()) = 3);
select t.chk('upload report screenshot into own folder', t.code(format($q$insert into storage.objects (bucket_id, name) values ('reports', %L)$q$, :'b' || '/r1.webp')) = '00000');
select t.chk('upload into a foreign folder refused', t.code(format($q$insert into storage.objects (bucket_id, name) values ('reports', %L)$q$, :'a' || '/r1.webp')) <> '00000');
select t.act(:'x');
select t.chk('expired user can still report a bug', t.err($$select public.submit_report('bug', 'bug_payment', 'cannot renew my plan')$$) = 'ok');
select t.act(:'z');
select public.clan_leave() \g :nul
select t.chk('rate limit: 10 a day', (select count(*) from generate_series(1, 11) g
   where t.err($$select public.submit_report('bug', 'bug_other', 'flood test report')$$) = 'too_many_reports') = 1);
select t.chk('non-admin cannot list reports', t.code($$select public.admin_reports()$$) = '42501');
select t.chk('non-admin cannot read a foreign screenshot', not exists (select 1 from storage.objects where bucket_id = 'reports'));

-- admin
select t.act(:'m');
select t.chk('admin sees open reports with nicks', (select count(*) = 14 and bool_or(x ->> 'target_nick' = 'Dima' and (x ->> 'target_reports')::int = 2)
  from jsonb_array_elements(public.admin_reports()) x));
select t.chk('admin can read report screenshots', exists (select 1 from storage.objects where bucket_id = 'reports'));
select t.chk('resolve a report', t.err($$select public.admin_resolve_report((select min((x->>'id')::bigint) from jsonb_array_elements(public.admin_reports()) x), 'resolved', 'warned')$$) = 'ok');
select t.chk('resolved report moves out of the open list', jsonb_array_length(public.admin_reports('resolved')) = 1 and jsonb_array_length(public.admin_reports()) = 13);
select t.chk('ban needs a reason', t.err(format($q$select public.admin_ban(%L, 'x')$q$, :'d')) = 'reason_invalid');
select t.chk('cannot ban an admin', t.err(format($q$select public.admin_ban(%L, 'testing it')$q$, :'m')) = 'cannot_ban_admin');
select t.chk('ban for 7 days', t.err(format($q$select public.admin_ban(%L, 'impersonation of Anna', 7)$q$, :'d')) = 'ok');
select t.chk('ban listed as active', (select (x ->> 'active')::boolean and x ->> 'nick' = 'Dima' from jsonb_array_elements(public.admin_bans()) x));
select t.act(:'d');
select t.chk('banned: status banned with reason', public.my_access() ->> 'status' = 'banned' and public.my_access() ->> 'reason' = 'impersonation of Anna');
select t.chk('banned: journal is read-only', t.code($$select public.save_state(0, '{}'::jsonb)$$) = '42501');
select t.chk('banned: profile is read-only', t.code($$select public.save_profile('Dima2')$$) = '42501');
select t.act(:'m');
select public.admin_unban(:'d') \g :nul
select t.act(:'d');
select t.chk('unban restores access', public.my_access() ->> 'status' = 'trial' and public.has_access());
select t.act(:'m');
select t.chk('admin resets an offensive nick', public.admin_reset_nick(:'d') like 'user%');
reset role;
select id as zed from public.clans where tag = 'ZED' \gset
set role authenticated;
select t.chk('admin disbands a clan', t.err(format($q$select public.admin_disband_clan(%L)$q$, :'zed')) = 'ok');
select t.act(:'c');
select t.chk('disbanded by admin: leader is free', public.my_clan() is null);
select t.act(:'z');
select t.chk('non-admin cannot ban', t.code(format($q$select public.admin_ban(%L, 'just because')$q$, :'a')) = '42501');
reset role;
