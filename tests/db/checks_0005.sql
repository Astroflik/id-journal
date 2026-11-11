-- Stage 6: achievement showcase on the profile and profile visibility. Runs after checks_0004.
-- Users from 0003/0004: b = Борис, c = Clara, d = Dima, z = Zoe (all with access), x = no access, m = admin.
\set b '00000000-0000-0000-0000-0000000000b2'
\set c '00000000-0000-0000-0000-0000000000b3'
\set d '00000000-0000-0000-0000-0000000000b4'
\set x '00000000-0000-0000-0000-0000000000b5'
\set z '00000000-0000-0000-0000-0000000000b6'
\set m '00000000-0000-0000-0000-0000000000c1'

-- x has no access and no profile yet; give it one directly (an old profile from before access ended)
insert into public.profiles (user_id, nick) values (:'x', 'Xavier_old');

select t.chk('0005: columns have safe defaults', (select bool_and(pinned_achievements = '{}' and visibility = 'all') from public.profiles));
select t.chk('0005: table check refuses a 7th pin', t.err(format($q$update public.profiles set pinned_achievements = '{a1,a2,a3,a4,a5,a6,a7}' where user_id = %L$q$, :'b')) like '%check constraint%');
select t.chk('0005: table check refuses a bad id', t.err(format($q$update public.profiles set pinned_achievements = '{"Bad Id"}' where user_id = %L$q$, :'b')) like '%check constraint%');
select t.chk('0005: table check refuses an unknown visibility', t.err(format($q$update public.profiles set visibility = 'friends' where user_id = %L$q$, :'b')) like '%check constraint%');
select t.chk('0005: save_showcase closed to anon', not has_function_privilege('anon', 'public.save_showcase(text[], text)', 'execute')
  and has_function_privilege('authenticated', 'public.save_showcase(text[], text)', 'execute'));
select t.chk('0005: profile_json still closed', not has_function_privilege('authenticated', 'public.profile_json(uuid)', 'execute'));

set role anon;
select t.chk('anon: cannot pin', t.code($$select public.save_showcase('{first_entry}')$$) = '42501');
reset role;

set role authenticated;
-- clan setup: Zoe leads a fresh clan, Dima joins it; Борис and Clara stay outside
select t.act(:'z');
select t.err($$select public.clan_leave()$$) \g :nul
select public.create_clan('K5K', 'Kappa Five') \g :nul
select public.clan_create_invite(7, 2) as inv \gset
select t.act(:'d');
select t.err($$select public.clan_leave()$$) \g :nul
select t.chk('setup: Dima joins Zoe''s clan', public.clan_join(:'inv') ->> 'my_role' = 'member');

-- pinning
select t.act(:'b');
select t.chk('my_profile shows empty showcase and visibility all', public.my_profile() -> 'achievements' = '[]'::jsonb and public.my_profile() ->> 'visibility' = 'all');
select t.chk('pin keeps order and drops repeats',
  public.save_showcase(array['streak_5', 'first_plan', 'streak_5', 'week_review_4']) -> 'achievements' = '["streak_5","first_plan","week_review_4"]'::jsonb);
select t.chk('null pinned leaves the showcase', public.save_showcase(null, 'all') -> 'achievements' = '["streak_5","first_plan","week_review_4"]'::jsonb);
select t.chk('7 distinct pins refused', t.err($$select public.save_showcase('{a1,a2,a3,a4,a5,a6,a7}')$$) = 'pinned_invalid');
select t.chk('6 pins allowed, 7th repeat ignored', jsonb_array_length(public.save_showcase('{a1,a2,a3,a4,a5,a6,a6}') -> 'achievements') = 6);
select t.chk('bad id refused (upper case, spaces, quotes)', t.err($$select public.save_showcase('{First}')$$) = 'pinned_invalid'
  and t.err($$select public.save_showcase(array['a b'])$$) = 'pinned_invalid'
  and t.err($$select public.save_showcase(array['x"><script>'])$$) = 'pinned_invalid');
select t.chk('null id refused', t.err($$select public.save_showcase(array[null]::text[])$$) = 'pinned_invalid');
select t.chk('one-letter and 33-letter ids refused', t.err($$select public.save_showcase('{a}')$$) = 'pinned_invalid'
  and t.err(format('select public.save_showcase(array[%L])', repeat('a', 33))) = 'pinned_invalid');
select t.chk('empty array clears the showcase', public.save_showcase('{}') -> 'achievements' = '[]'::jsonb);
select public.save_showcase('{streak_5,first_plan}') \g :nul
select t.chk('unknown visibility refused', t.err($$select public.save_showcase(null, 'friends')$$) = 'visibility_invalid');
select t.act(:'c');
select t.chk('Clara has no clan and sees Борис (all): showcase visible', (select x -> 'achievements' = '["streak_5","first_plan"]'::jsonb and x ->> 'hidden' = 'false' and x ? 'visibility' = false
  from (select public.get_profile(:'b') x) s));

-- no profile / no access
select t.act(:'x');
select t.chk('no access: pinning refused', t.code($$select public.save_showcase('{first_entry}')$$) = '42501');
select t.chk('no access: hiding the profile is allowed', public.save_showcase(null, 'self') ->> 'visibility' = 'self');
reset role;
select t.chk('no access: pins untouched in the table', (select pinned_achievements = '{}' and visibility = 'self' from public.profiles where user_id = :'x'));
delete from public.profiles where user_id = :'x';
set role authenticated;
select t.act(:'x');
select t.chk('no profile: showcase needs a nick first', t.err($$select public.save_showcase(null, 'self')$$) = 'nick_required');

-- visibility: clan
select t.act(:'z');
select public.save_profile('Zoe', 'scalps NQ at the open', '[{"label":"site","url":"https://example.com"}]'::jsonb) \g :nul
select public.save_socials('zoe.trades', null, null) \g :nul
select public.save_showcase('{streak_10,week_review_4}', 'clan') \g :nul
select t.act(:'d');
select t.chk('clanmate sees a clan-only card in full', (select x ->> 'hidden' = 'false' and x ->> 'bio' = 'scalps NQ at the open'
  and x -> 'achievements' = '["streak_10","week_review_4"]'::jsonb and x -> 'socials' ->> 'discord' = 'zoe.trades'
  from (select public.get_profile(:'z') x) s));
select t.act(:'b');
select t.chk('outsider gets the short card: nick, avatar, clan only', (select x ->> 'hidden' = 'true' and x ->> 'nick' = 'Zoe'
  and x -> 'clan' ->> 'tag' = 'K5K' and x ->> 'bio' = '' and x -> 'links' = '[]'::jsonb and x -> 'achievements' = '[]'::jsonb
  and x -> 'socials' ->> 'discord' is null from (select public.get_profile(:'z') x) s));
select t.act(:'z');
select t.chk('owner always sees own card in full', public.get_profile(:'z') ->> 'hidden' = 'false' and public.my_profile() ->> 'bio' = 'scalps NQ at the open');

-- visibility: self
select public.save_showcase(null, 'self') \g :nul
select t.act(:'d');
select t.chk('self-only: even a clanmate gets the short card', public.get_profile(:'z') ->> 'hidden' = 'true' and public.get_profile(:'z') -> 'achievements' = '[]'::jsonb);
select t.act(:'m');
select t.chk('admin sees a hidden card in full', public.get_profile(:'z') ->> 'hidden' = 'false' and public.get_profile(:'z') -> 'achievements' = '["streak_10","week_review_4"]'::jsonb);
select t.act(:'z');
select t.chk('back to all: outsider sees it again', public.save_showcase(null, 'all') ->> 'visibility' = 'all');
select t.act(:'b');
select t.chk('outsider sees the full card after switching to all', public.get_profile(:'z') ->> 'hidden' = 'false');
select t.chk('missing profile still returns null', public.get_profile('00000000-0000-0000-0000-00000000dead') is null);
reset role;
select t.chk('profile writes keep the table consistent', (select count(*) = 0 from public.profiles where cardinality(pinned_achievements) > 6));
