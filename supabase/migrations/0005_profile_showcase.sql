-- Journal by myIDgod: achievement showcase and profile privacy (stage 6).
--   * profiles.pinned_achievements: up to 6 achievement ids the owner pins to the profile card;
--     ids are the keys of the front-end config (public/app/achievements.js), checked by pattern only;
--   * profiles.visibility: who sees the profile card details (about me, links, socials, showcase):
--     'all' = every signed-in user (the behaviour before this migration), 'clan' = clanmates only,
--     'self' = only the owner. Nick, avatar and clan tag stay visible: the clan chat needs them.
-- Same model as before: tables have RLS on and no grants, everything goes through functions.
-- Both columns get constant defaults, so adding them is a metadata-only change (no table rewrite).

-- ---------------------------------------------------------------- columns

alter table public.profiles
  add column pinned_achievements text[] not null default '{}'
    check (cardinality(pinned_achievements) <= 6
           and array_position(pinned_achievements, null) is null
           and (cardinality(pinned_achievements) = 0
                or array_to_string(pinned_achievements, ',') ~ '^[a-z0-9_]{2,32}(,[a-z0-9_]{2,32}){0,5}$')),
  add column visibility text not null default 'all' check (visibility in ('all', 'clan', 'self'));

-- ---------------------------------------------------------------- reading

-- Own profile (my_profile, save_* results): everything, plus the two new fields.
create or replace function public.profile_json(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', uid, 'nick', p.nick, 'avatar_path', p.avatar_path,
    'bio', coalesce(p.bio, ''), 'links', coalesce(p.links, '[]'::jsonb),
    'socials', jsonb_build_object('discord', p.discord, 'telegram', p.telegram, 'tiktok', p.tiktok),
    'achievements', to_jsonb(coalesce(p.pinned_achievements, '{}'::text[])),
    'visibility', coalesce(p.visibility, 'all'),
    'clan', (select jsonb_build_object('id', c.id, 'tag', c.tag, 'name', c.name, 'color', c.color,
                                       'emblem_path', c.emblem_path, 'role', m.role)
               from public.clan_members m join public.clans c on c.id = m.clan_id
              where m.user_id = uid))
    from (select uid) x left join public.profiles p on p.user_id = uid
$$;

-- Another user's card. Details are shown by the owner's visibility setting; the owner and admins
-- always see everything. A hidden card keeps nick, avatar and clan and says "hidden": true.
create or replace function public.get_profile(target uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := public.social_uid(); v text; card jsonb;
begin
  select p.visibility into v from public.profiles p where p.user_id = target;
  if not found then return null; end if;
  card := public.profile_json(target) - 'clan' - 'visibility' || jsonb_build_object('clan',
    (select jsonb_build_object('tag', c.tag, 'name', c.name, 'color', c.color, 'emblem_path', c.emblem_path, 'role', m.role)
       from public.clan_members m join public.clans c on c.id = m.clan_id where m.user_id = target));
  if target = me or v = 'all' or public.is_admin()
     or (v = 'clan' and exists (select 1 from public.clan_members a join public.clan_members b on b.clan_id = a.clan_id
                                 where a.user_id = me and b.user_id = target)) then
    return card || jsonb_build_object('hidden', false);
  end if;
  return jsonb_build_object('user_id', target, 'nick', card -> 'nick', 'avatar_path', card -> 'avatar_path',
    'clan', card -> 'clan', 'bio', '', 'links', '[]'::jsonb,
    'socials', jsonb_build_object('discord', null, 'telegram', null, 'tiktok', null),
    'achievements', '[]'::jsonb, 'hidden', true);
end;
$$;

-- ---------------------------------------------------------------- writing

-- null leaves a field as it is. Pinning needs an active trial or subscription, like every other
-- profile write; hiding the profile (visibility) is always allowed, also after access ended.
-- Repeated ids are dropped, order is kept.
create function public.save_showcase(pinned text[] default null, visibility text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); clean text[] := '{}'; it text;
begin
  if not exists (select 1 from public.profiles where user_id = uid) then perform public.social_fail('nick_required'); end if;
  if pinned is not null then
    perform public.social_need_access();
    foreach it in array pinned loop
      if it is null or it !~ '^[a-z0-9_]{2,32}$' then perform public.social_fail('pinned_invalid'); end if;
      if not it = any (clean) then clean := clean || it; end if;
    end loop;
    if cardinality(clean) > 6 then perform public.social_fail('pinned_invalid'); end if;
    update public.profiles p set pinned_achievements = clean, updated_at = now() where p.user_id = uid;
  end if;
  if visibility is not null then
    if visibility not in ('all', 'clan', 'self') then perform public.social_fail('visibility_invalid'); end if;
    update public.profiles p set visibility = save_showcase.visibility, updated_at = now() where p.user_id = uid;
  end if;
  return public.profile_json(uid);
end;
$$;

-- ---------------------------------------------------------------- privileges

revoke all on function public.save_showcase(text[], text) from public, anon, authenticated;
grant execute on function public.save_showcase(text[], text) to authenticated;
-- create or replace keeps earlier grants: profile_json stays closed, get_profile stays for authenticated only
