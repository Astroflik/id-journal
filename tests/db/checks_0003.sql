-- Stage C: profiles, clans, invites, chat, avatars. Runs after checks_0002.
\set a '00000000-0000-0000-0000-0000000000b1'
\set b '00000000-0000-0000-0000-0000000000b2'
\set c '00000000-0000-0000-0000-0000000000b3'
\set d '00000000-0000-0000-0000-0000000000b4'
\set x '00000000-0000-0000-0000-0000000000b5'
\set z '00000000-0000-0000-0000-0000000000b6'

-- error message of a statement (business errors are raised as text codes)
create function t.err(statement text) returns text language plpgsql as $$
begin execute statement; return 'ok'; exception when others then return sqlerrm; end $$;

insert into auth.users (id, email, email_confirmed_at) values
  (:'a', 'anna.c@gmail.com', now()), (:'b', 'boris.c@gmail.com', now()), (:'c', 'clara.c@gmail.com', now()),
  (:'d', 'dima.c@gmail.com', now()), (:'x', 'x@mailinator.com', now()), (:'z', 'zoe.c@gmail.com', now());

select t.chk('0003: tables locked for the API roles', not has_table_privilege('authenticated', 'public.profiles', 'select')
  and not has_table_privilege('authenticated', 'public.clan_messages', 'select') and not has_table_privilege('anon', 'public.clans', 'select'));
select t.chk('0003: helpers not callable', not has_function_privilege('authenticated', 'public.profile_json(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.clan_role(uuid)', 'execute'));
select t.chk('0003: avatars bucket is public, small, images only',
  (select public and file_size_limit = 524288 and allowed_mime_types @> array['image/webp'] from storage.buckets where id = 'avatars'));

set role anon;
select t.chk('anon: no profile access', t.code($$select public.my_profile()$$) = '42501');
reset role;

set role authenticated;
select t.act(:'a');
select t.chk('direct table read refused', t.code($$select * from public.profiles$$) = '42501');
select t.chk('no profile yet: empty nick', public.my_profile() ->> 'nick' is null and public.my_profile() -> 'clan' = 'null'::jsonb);
select t.chk('save profile', public.save_profile('Anna_Trader', ' NQ scalper ', '[{"label":"TG","url":"https://t.me/anna"}]'::jsonb) ->> 'nick' = 'Anna_Trader');
select t.chk('profile stored trimmed with links', (public.my_profile() ->> 'bio') = 'NQ scalper' and public.my_profile() #>> '{links,0,url}' = 'https://t.me/anna');
select t.chk('own avatar path ok', t.err(format($q$select public.save_profile('Anna_Trader', '', '[]', %L)$q$, :'a' || '/avatar-1.webp')) = 'ok');
select t.chk('avatar in a foreign folder refused', t.err(format($q$select public.save_profile('Anna_Trader', '', '[]', %L)$q$, :'b' || '/a.webp')) = 'avatar_invalid');
select t.chk('javascript link refused', t.err($q$select public.save_profile('Anna_Trader', '', '[{"label":"x","url":"javascript:alert(1)"}]')$q$) = 'links_invalid');
select t.chk('six links refused', t.err($q$select public.save_profile('Anna_Trader', '', '[{"url":"https://a.io"},{"url":"https://a.io"},{"url":"https://a.io"},{"url":"https://a.io"},{"url":"https://a.io"},{"url":"https://a.io"}]')$q$) = 'links_invalid');
select t.chk('short nick refused', t.err($$select public.save_profile('ab')$$) = 'nick_invalid');
select t.chk('nick with spaces refused', t.err($$select public.save_profile('an na')$$) = 'nick_invalid');
select t.chk('long bio refused', t.err(format('select public.save_profile(%L, %L)', 'Anna_Trader', repeat('x', 301))) = 'bio_too_long');
select t.act(:'b');
select t.chk('nick taken, any letter case', t.err($$select public.save_profile('anna_trader')$$) = 'nick_taken');
select t.chk('cyrillic nick ok', public.save_profile('Борис') ->> 'nick' = 'Борис');
select t.act(:'x');
select t.chk('no access: profile is read-only', t.code($$select public.save_profile('Xavier')$$) = '42501');
select t.act(:'c');
select t.chk('clan needs a nick first', t.err($$select public.create_clan('ABC', 'Alpha')$$) = 'nick_required');
select public.save_profile('Clara') \g :nul
select t.act(:'d');
select public.save_profile('Dima') \g :nul
select t.act(:'z');
select public.save_profile('Zoe') \g :nul

-- create
select t.act(:'a');
select t.chk('bad tag refused', t.err($$select public.create_clan('A', 'Alpha')$$) = 'tag_invalid');
select t.chk('bad colour refused', t.err($$select public.create_clan('ALP', 'Alpha', '', 'red')$$) = 'color_invalid');
select t.chk('create clan: tag upper-cased, creator is leader',
  (select c ->> 'tag' = 'ALP' and c ->> 'my_role' = 'leader' and jsonb_array_length(c -> 'members') = 1
     from public.create_clan(' alp ', 'Alpha Flow', 'Order flow crew', '#FF5500') c));
select t.chk('profile shows the clan tag', public.my_profile() #>> '{clan,tag}' = 'ALP' and public.my_profile() #>> '{clan,color}' = '#ff5500');
select t.chk('second clan refused', t.err($$select public.create_clan('BET', 'Beta')$$) = 'already_in_clan');
select t.act(:'z');
select t.chk('taken tag refused', t.err($$select public.create_clan('Alp', 'Other')$$) = 'tag_taken');

-- invites
select t.act(:'a');
select t.chk('invite params checked', t.err($$select public.clan_create_invite(0, 5)$$) = 'invite_params_invalid');
select public.clan_create_invite(7, 2) as inv \gset
select t.chk('invite code: 10 characters', :'inv' ~ '^[A-Z0-9]{10}$');
select t.chk('invite listed', jsonb_array_length(public.clan_invites_list()) = 1);
select t.act(:'b');
select t.chk('preview by code', public.clan_preview(lower(:'inv')) ->> 'tag' = 'ALP' and (public.clan_preview(:'inv') ->> 'members')::int = 1);
select t.chk('wrong code: no preview', public.clan_preview('NOPE000000') is null);
select t.chk('join by code (any case)', public.clan_join(lower(:'inv')) ->> 'my_role' = 'member');
select t.chk('already a member: cannot join again', t.err(format('select public.clan_join(%L)', :'inv')) = 'already_in_clan');
select t.chk('member cannot make invites', t.code($$select public.clan_create_invite()$$) = '42501');
select t.chk('member cannot edit the clan', t.code($$select public.update_clan('New name')$$) = '42501');
select t.act(:'c');
select t.chk('second use of the code', public.clan_join(:'inv') ->> 'tag' = 'ALP');
select t.act(:'d');
select t.chk('used-up code refused', t.err(format('select public.clan_join(%L)', :'inv')) = 'invite_invalid');
select t.act(:'x');
select t.chk('no access: cannot join', t.code(format('select public.clan_join(%L)', :'inv')) = '42501');
reset role;
insert into public.clan_invites (code, clan_id, expires_at, max_uses)
  select 'OLDCODE000', id, now() - interval '1 minute', 5 from public.clans where tag = 'ALP';
set role authenticated;
select t.act(:'d');
select t.chk('expired code refused', t.err($$select public.clan_join('OLDCODE000')$$) = 'invite_invalid');

-- roles
select t.act(:'a');
select t.chk('leader makes an officer', (select m ->> 'role' = 'officer' from jsonb_array_elements(public.clan_set_role(:'b', 'officer') -> 'members') m where m ->> 'user_id' = :'b'));
select t.chk('bad role refused', t.err(format($q$select public.clan_set_role(%L, 'king')$q$, :'c')) = 'role_invalid');
select t.act(:'b');
select t.chk('officer edits the clan', public.update_clan(null, 'New description', '#112233') ->> 'description' = 'New description');
select t.chk('officer emblem from own folder', public.update_clan(emblem_path => :'b' || '/emblem.png') ->> 'emblem_path' = :'b' || '/emblem.png');
select t.chk('emblem from a foreign folder refused', t.err(format('select public.update_clan(emblem_path => %L)', :'a' || '/e.png')) = 'emblem_invalid');
select t.chk('officer cannot change roles', t.code(format($q$select public.clan_set_role(%L, 'officer')$q$, :'c')) = '42501');
select t.chk('officer cannot kick the leader', t.code(format('select public.clan_kick(%L)', :'a')) = '42501');
select t.act(:'z');
select t.chk('outsider: no clan, cannot see members', public.my_clan() is null);
select t.chk('outsider cannot kick', t.code(format('select public.clan_kick(%L)', :'c')) = '42501');

-- chat
select t.act(:'c');
select public.clan_send('  hello  ') as m1 \gset
select t.act(:'a');
select public.clan_send('hi Clara') as m2 \gset
select t.chk('chat: newest first, trimmed, with nicks', (select x -> 0 ->> 'body' = 'hi Clara' and x -> 1 ->> 'body' = 'hello' and x -> 1 ->> 'nick' = 'Clara'
  and (x -> 0 ->> 'mine')::boolean from public.clan_messages() x));
select t.chk('chat: polling returns only newer', jsonb_array_length(public.clan_messages(after_id => :m1)) = 1);
select t.chk('chat: older page', jsonb_array_length(public.clan_messages(before_id => :m2)) = 1);
select t.chk('empty message refused', t.err($$select public.clan_send('   ')$$) = 'message_invalid');
select t.act(:'z');
select t.chk('outsider cannot read the chat', t.code($$select public.clan_messages()$$) = '42501');
select t.chk('outsider cannot write to the chat', t.code($$select public.clan_send('spam')$$) = '42501');
select t.act(:'c');
select t.chk('member cannot delete others', t.code(format('select public.clan_delete_message(%s)', :m2)) = '42501');
select t.act(:'b');
select t.chk('officer deletes a message', t.code(format('select public.clan_delete_message(%s)', :m1)) = '00000');
select t.chk('deleted message is gone',  jsonb_array_length(public.clan_messages()) = 1);
select t.act(:'c');
select t.chk('rate limit: 20 messages a minute', (select count(*) from generate_series(1, 25) g where t.err('select public.clan_send(''flood'')') = 'slow_down') = 5);

-- kick, leave, succession
select t.act(:'b');
select t.chk('officer kicks a member', jsonb_array_length(public.clan_kick(:'c') -> 'members') = 2);
select t.act(:'c');
select t.chk('kicked member is out', public.my_clan() is null and public.my_profile() -> 'clan' = 'null'::jsonb);
select t.chk('kicked member keeps old messages hidden', t.code($$select public.clan_messages()$$) = '42501');
select t.act(:'a');
select t.chk('others see the clan tag on a profile', public.get_profile(:'b') #>> '{clan,tag}' = 'ALP' and public.get_profile(:'c') -> 'clan' = 'null'::jsonb);
select t.chk('hand over leadership', (select bool_and(case m ->> 'user_id' when :'b' then m ->> 'role' = 'leader' else m ->> 'role' = 'officer' end)
  from jsonb_array_elements(public.clan_set_role(:'b', 'leader') -> 'members') m));
select t.act(:'b');
select public.clan_create_invite(7, 10) as inv2 \gset
select t.act(:'d');
select public.clan_join(:'inv2') \g :nul
select t.act(:'b');
select public.clan_leave() \g :nul
select t.act(:'a');
select t.chk('leader leaves: oldest officer leads', public.my_clan() ->> 'my_role' = 'leader');
reset role;
delete from auth.users where id = :'a';
set role authenticated;
select t.act(:'d');
select t.chk('leader account deleted: next member leads', public.my_clan() ->> 'my_role' = 'leader');
select public.clan_leave() \g :nul
reset role;
select t.chk('last member leaves: clan removed with invites and chat', not exists (select 1 from public.clans where tag = 'ALP')
  and not exists (select 1 from public.clan_invites) and not exists (select 1 from public.clan_messages) and not exists (select 1 from public.clan_members));
set role authenticated;

-- disband
select t.act(:'z');
select public.create_clan('ZED', 'Zed Squad') \g :nul
select public.clan_create_invite() as inv3 \gset
select t.act(:'c');
select public.clan_join(:'inv3') \g :nul
select t.chk('member cannot disband', t.code($$select public.clan_disband()$$) = '42501');
select t.act(:'z');
select public.clan_disband() \g :nul
select t.act(:'c');
select t.chk('disband frees members', public.my_clan() is null);
select t.chk('tag is free again', public.create_clan('ZED', 'Zed Again') ->> 'tag' = 'ZED');

-- avatar files
select t.act(:'c');
select t.chk('upload avatar into own folder', t.code(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, :'c' || '/avatar-1.webp')) = '00000');
select t.chk('upload into a foreign folder refused', t.code(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, :'d' || '/x.webp')) <> '00000');
select t.act(:'x');
select t.chk('no access: avatar upload refused', t.code(format($q$insert into storage.objects (bucket_id, name) values ('avatars', %L)$q$, :'x' || '/a.webp')) <> '00000');
reset role;
