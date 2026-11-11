-- Journal by myIDgod: profiles and clans (stage C).
--   * profile: nick (unique, case-insensitive), own avatar, short bio, up to 5 https links;
--   * clans: tag shown next to the nick, name, colour, emblem, description;
--     roles leader / officer / member, one clan per user, up to 50 members;
--   * invites by code (expiry + use limit), clan chat with a simple rate limit;
--   * if the leader leaves or the account is deleted, the oldest officer (else
--     the oldest member) becomes leader; the last member leaving removes the clan.
-- Tables have RLS on and no grants: everything goes through the functions below.
-- Writing (profile, clan, invites, joining, chat, avatar upload) needs an active
-- trial or subscription, like screenshots. Leaving a clan is always allowed.

-- ---------------------------------------------------------------- tables

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nick text not null check (nick ~ '^[A-Za-z0-9_.А-Яа-яЁёІіЇїЄєҐґ-]{3,20}$'),
  avatar_path text check (avatar_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,64}$'),
  bio text not null default '' check (char_length(bio) <= 300),
  links jsonb not null default '[]'::jsonb
    check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 5),
  updated_at timestamptz not null default now()
);
create unique index profiles_nick_key on public.profiles (lower(nick));

create table public.clans (
  id uuid primary key default gen_random_uuid(),
  tag text not null unique check (tag ~ '^[A-Z0-9]{2,5}$'),
  name text not null check (char_length(name) between 3 and 32),
  description text not null default '' check (char_length(description) <= 500),
  color text not null default '#0a0a0b' check (color ~ '^#[0-9a-f]{6}$'),
  emblem_path text check (emblem_path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- user_id is the key: one clan per user.
create table public.clan_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  clan_id uuid not null references public.clans (id) on delete cascade,
  role text not null default 'member' check (role in ('leader', 'officer', 'member')),
  joined_at timestamptz not null default now()
);
create index clan_members_clan on public.clan_members (clan_id);
create unique index clan_members_one_leader on public.clan_members (clan_id) where role = 'leader';

create table public.clan_invites (
  code text primary key check (code ~ '^[A-Z0-9]{10}$'),
  clan_id uuid not null references public.clans (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  max_uses integer not null check (max_uses between 1 and 100),
  uses integer not null default 0,
  created_at timestamptz not null default now()
);
create index clan_invites_clan on public.clan_invites (clan_id);

create table public.clan_messages (
  id bigint generated always as identity primary key,
  clan_id uuid not null references public.clans (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index clan_messages_clan on public.clan_messages (clan_id, id desc);
create index clan_messages_user on public.clan_messages (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_invites enable row level security;
alter table public.clan_messages enable row level security;
-- no policies: reachable only through the functions below

-- ---------------------------------------------------------------- helpers

create function public.social_uid() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  return u;
end;
$$;

create function public.social_need_access() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_access() then raise exception 'subscription_required' using errcode = '42501'; end if;
end;
$$;

create function public.social_fail(code text) returns void
language plpgsql volatile set search_path = public as $$
begin raise exception '%', code using errcode = 'P0001'; end;
$$;

-- avatar / emblem file inside the caller's own folder of the "avatars" bucket
create function public.social_own_file(uid uuid, path text) returns boolean
language sql immutable set search_path = public as $$
  select path ~ '^[0-9a-f-]{36}/[A-Za-z0-9_.-]{1,64}$' and split_part(path, '/', 1) = uid::text
$$;

create function public.profile_json(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', uid, 'nick', p.nick, 'avatar_path', p.avatar_path,
    'bio', coalesce(p.bio, ''), 'links', coalesce(p.links, '[]'::jsonb),
    'clan', (select jsonb_build_object('id', c.id, 'tag', c.tag, 'name', c.name, 'color', c.color,
                                       'emblem_path', c.emblem_path, 'role', m.role)
               from public.clan_members m join public.clans c on c.id = m.clan_id
              where m.user_id = uid))
    from (select uid) x left join public.profiles p on p.user_id = uid
$$;

-- succession: leader gone -> oldest officer, else oldest member; empty clan -> removed
create function public.clan_member_gone() returns trigger
language plpgsql security definer set search_path = public as $$
declare nxt uuid;
begin
  if not exists (select 1 from public.clans where id = old.clan_id) then return null; end if;
  if not exists (select 1 from public.clan_members where clan_id = old.clan_id) then
    delete from public.clans where id = old.clan_id;
    return null;
  end if;
  if old.role = 'leader' and not exists (select 1 from public.clan_members where clan_id = old.clan_id and role = 'leader') then
    select user_id into nxt from public.clan_members where clan_id = old.clan_id
     order by (role = 'officer') desc, joined_at, user_id limit 1;
    update public.clan_members set role = 'leader' where user_id = nxt;
  end if;
  return null;
end;
$$;
create trigger clan_member_gone after delete on public.clan_members
  for each row execute function public.clan_member_gone();

-- ---------------------------------------------------------------- profile

create function public.my_profile() returns jsonb
language sql stable security definer set search_path = public as $$
  select public.profile_json(public.social_uid())
$$;

-- Another user's public card (signed-in users only).
create function public.get_profile(target uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.social_uid();
  if not exists (select 1 from public.profiles where user_id = target) then return null; end if;
  return public.profile_json(target) - 'clan' || jsonb_build_object('clan',
    (select jsonb_build_object('tag', c.tag, 'name', c.name, 'color', c.color, 'emblem_path', c.emblem_path, 'role', m.role)
       from public.clan_members m join public.clans c on c.id = m.clan_id where m.user_id = target));
end;
$$;

create function public.save_profile(nick text, bio text default '', links jsonb default '[]'::jsonb,
                                    avatar_path text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); n text := btrim(coalesce(nick, '')); b text := btrim(coalesce(bio, ''));
        clean jsonb := '[]'::jsonb; it jsonb; u text; l text;
begin
  perform public.social_need_access();
  if n !~ '^[A-Za-z0-9_.А-Яа-яЁёІіЇїЄєҐґ-]{3,20}$' then perform public.social_fail('nick_invalid'); end if;
  if char_length(b) > 300 then perform public.social_fail('bio_too_long'); end if;
  if links is null then links := '[]'::jsonb; end if;
  if jsonb_typeof(links) <> 'array' or jsonb_array_length(links) > 5 then perform public.social_fail('links_invalid'); end if;
  for it in select * from jsonb_array_elements(links) loop
    if jsonb_typeof(it) <> 'object' then perform public.social_fail('links_invalid'); end if;
    u := btrim(coalesce(it ->> 'url', '')); l := btrim(coalesce(it ->> 'label', ''));
    if u !~ '^https://[^\s<>"''`]{3,200}$' or char_length(l) > 24 then perform public.social_fail('links_invalid'); end if;
    clean := clean || jsonb_build_array(jsonb_build_object('label', l, 'url', u));
  end loop;
  if avatar_path = '' then avatar_path := null; end if;
  if avatar_path is not null and not public.social_own_file(uid, avatar_path) then perform public.social_fail('avatar_invalid'); end if;
  begin
    insert into public.profiles (user_id, nick, avatar_path, bio, links, updated_at)
    values (uid, n, avatar_path, b, clean, now())
    on conflict (user_id) do update
      set nick = excluded.nick, avatar_path = excluded.avatar_path, bio = excluded.bio,
          links = excluded.links, updated_at = now();
  exception when unique_violation then
    raise exception 'nick_taken' using errcode = '23505';
  end;
  return public.profile_json(uid);
end;
$$;

-- ---------------------------------------------------------------- clans

create function public.clan_role(uid uuid, out clan uuid, out role text)
language sql stable security definer set search_path = public as $$
  select clan_id, role from public.clan_members where user_id = uid
$$;

create function public.my_clan() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record;
begin
  select * into r from public.clan_role(uid);
  if r.clan is null then return null; end if;
  return (select jsonb_build_object(
      'id', c.id, 'tag', c.tag, 'name', c.name, 'description', c.description, 'color', c.color,
      'emblem_path', c.emblem_path, 'created_at', c.created_at, 'my_role', r.role,
      'members', (select coalesce(jsonb_agg(jsonb_build_object(
                    'user_id', m.user_id, 'nick', p.nick, 'avatar_path', p.avatar_path,
                    'role', m.role, 'joined_at', m.joined_at)
                  order by case m.role when 'leader' then 0 when 'officer' then 1 else 2 end, m.joined_at), '[]'::jsonb)
                    from public.clan_members m left join public.profiles p on p.user_id = m.user_id
                   where m.clan_id = c.id))
    from public.clans c where c.id = r.clan);
end;
$$;

create function public.create_clan(tag text, name text, description text default '', color text default '#0a0a0b')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); t text := upper(btrim(coalesce(tag, ''))); nm text := btrim(coalesce(name, ''));
        d text := btrim(coalesce(description, '')); co text := lower(btrim(coalesce(color, '#0a0a0b'))); cid uuid;
begin
  perform public.social_need_access();
  if not exists (select 1 from public.profiles where user_id = uid) then perform public.social_fail('nick_required'); end if;
  if exists (select 1 from public.clan_members where user_id = uid) then perform public.social_fail('already_in_clan'); end if;
  if t !~ '^[A-Z0-9]{2,5}$' then perform public.social_fail('tag_invalid'); end if;
  if char_length(nm) not between 3 and 32 then perform public.social_fail('name_invalid'); end if;
  if char_length(d) > 500 then perform public.social_fail('description_too_long'); end if;
  if co !~ '^#[0-9a-f]{6}$' then perform public.social_fail('color_invalid'); end if;
  begin
    insert into public.clans (tag, name, description, color, created_by) values (t, nm, d, co, uid) returning id into cid;
  exception when unique_violation then
    raise exception 'tag_taken' using errcode = '23505';
  end;
  insert into public.clan_members (user_id, clan_id, role) values (uid, cid, 'leader');
  return public.my_clan();
end;
$$;

-- null = keep the field; emblem_path '' = remove the emblem
create function public.update_clan(name text default null, description text default null,
                                   color text default null, emblem_path text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record;
begin
  perform public.social_need_access();
  select * into r from public.clan_role(uid);
  if r.clan is null or r.role not in ('leader', 'officer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if name is not null then name := btrim(name); if char_length(name) not between 3 and 32 then perform public.social_fail('name_invalid'); end if; end if;
  if description is not null then description := btrim(description); if char_length(description) > 500 then perform public.social_fail('description_too_long'); end if; end if;
  if color is not null then color := lower(btrim(color)); if color !~ '^#[0-9a-f]{6}$' then perform public.social_fail('color_invalid'); end if; end if;
  if emblem_path is not null and emblem_path <> '' and not public.social_own_file(uid, emblem_path) then perform public.social_fail('emblem_invalid'); end if;
  update public.clans c
     set name = coalesce(update_clan.name, c.name),
         description = coalesce(update_clan.description, c.description),
         color = coalesce(update_clan.color, c.color),
         emblem_path = case when update_clan.emblem_path is null then c.emblem_path
                            when update_clan.emblem_path = '' then null else update_clan.emblem_path end
   where c.id = r.clan;
  return public.my_clan();
end;
$$;

create function public.clan_create_invite(days integer default 7, max_uses integer default 10) returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record; code text;
begin
  perform public.social_need_access();
  select * into r from public.clan_role(uid);
  if r.clan is null or r.role not in ('leader', 'officer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if days is null or days not between 1 and 30 or max_uses is null or max_uses not between 1 and 100 then
    perform public.social_fail('invite_params_invalid');
  end if;
  if (select count(*) from public.clan_invites where clan_id = r.clan and expires_at > now() and uses < clan_invites.max_uses) >= 20 then
    perform public.social_fail('too_many_invites');
  end if;
  code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.clan_invites (code, clan_id, created_by, expires_at, max_uses)
  values (code, r.clan, uid, now() + make_interval(days => days), max_uses);
  return code;
end;
$$;

create function public.clan_invites_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record;
begin
  select * into r from public.clan_role(uid);
  if r.clan is null or r.role not in ('leader', 'officer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'expires_at', expires_at, 'max_uses', max_uses, 'uses', uses)
                                    order by created_at desc), '[]'::jsonb)
            from public.clan_invites where clan_id = r.clan and expires_at > now() and uses < max_uses);
end;
$$;

create function public.clan_revoke_invite(code text) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record;
begin
  select * into r from public.clan_role(uid);
  if r.clan is null or r.role not in ('leader', 'officer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.clan_invites i where i.code = upper(btrim(clan_revoke_invite.code)) and i.clan_id = r.clan;
end;
$$;

-- What a code leads to, before joining.
create function public.clan_preview(code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.social_uid();
  return (select jsonb_build_object('tag', c.tag, 'name', c.name, 'description', c.description, 'color', c.color,
                                    'emblem_path', c.emblem_path,
                                    'members', (select count(*) from public.clan_members m where m.clan_id = c.id))
            from public.clan_invites i join public.clans c on c.id = i.clan_id
           where i.code = upper(btrim(coalesce(clan_preview.code, ''))) and i.expires_at > now() and i.uses < i.max_uses);
end;
$$;

create function public.clan_join(code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); inv record;
begin
  perform public.social_need_access();
  if not exists (select 1 from public.profiles where user_id = uid) then perform public.social_fail('nick_required'); end if;
  if exists (select 1 from public.clan_members where user_id = uid) then perform public.social_fail('already_in_clan'); end if;
  select * into inv from public.clan_invites i where i.code = upper(btrim(coalesce(clan_join.code, ''))) for update;
  if inv.code is null or inv.expires_at <= now() or inv.uses >= inv.max_uses then perform public.social_fail('invite_invalid'); end if;
  perform 1 from public.clans where id = inv.clan_id for update;
  if (select count(*) from public.clan_members where clan_id = inv.clan_id) >= 50 then perform public.social_fail('clan_full'); end if;
  insert into public.clan_members (user_id, clan_id, role) values (uid, inv.clan_id, 'member');
  update public.clan_invites set uses = uses + 1 where clan_invites.code = inv.code;
  return public.my_clan();
end;
$$;

create function public.clan_leave() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.clan_members where user_id = public.social_uid();
end;
$$;

-- Leader only. role 'leader' hands the clan over (the old leader becomes an officer).
create function public.clan_set_role(target uuid, role text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record; t record;
begin
  select * into r from public.clan_role(uid);
  select * into t from public.clan_role(target);
  if r.clan is null or r.role <> 'leader' or target = uid or t.clan is distinct from r.clan then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if clan_set_role.role not in ('leader', 'officer', 'member') then perform public.social_fail('role_invalid'); end if;
  if clan_set_role.role = 'leader' then
    update public.clan_members set role = 'officer' where user_id = uid;
  end if;
  update public.clan_members set role = clan_set_role.role where user_id = target;
  return public.my_clan();
end;
$$;

-- Leader: anyone but themselves. Officer: members only.
create function public.clan_kick(target uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record; t record;
begin
  select * into r from public.clan_role(uid);
  select * into t from public.clan_role(target);
  if r.clan is null or target = uid or t.clan is distinct from r.clan
     or not (r.role = 'leader' or (r.role = 'officer' and t.role = 'member')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.clan_members where user_id = target;
  return public.my_clan();
end;
$$;

create function public.clan_disband() returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.clan_role(public.social_uid());
  if r.clan is null or r.role <> 'leader' then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.clans where id = r.clan;
end;
$$;

-- ---------------------------------------------------------------- clan chat

create function public.clan_send(body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record; b text := btrim(coalesce(body, '')); mid bigint;
begin
  perform public.social_need_access();
  select * into r from public.clan_role(uid);
  if r.clan is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  if char_length(b) not between 1 and 1000 then perform public.social_fail('message_invalid'); end if;
  if (select count(*) from public.clan_messages where user_id = uid and created_at > now() - interval '1 minute') >= 20 then
    perform public.social_fail('slow_down');
  end if;
  insert into public.clan_messages (clan_id, user_id, body) values (r.clan, uid, b) returning id into mid;
  return mid;
end;
$$;

-- Newest first. after_id: only newer messages (polling); before_id: older page.
create function public.clan_messages(after_id bigint default null, before_id bigint default null, lim integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record;
begin
  select * into r from public.clan_role(uid);
  if r.clan is null then raise exception 'not_allowed' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(x order by (x ->> 'id')::bigint desc), '[]'::jsonb) from (
    select jsonb_build_object('id', m.id, 'user_id', m.user_id, 'nick', p.nick, 'avatar_path', p.avatar_path,
                              'body', m.body, 'created_at', m.created_at, 'mine', m.user_id = uid) x
      from public.clan_messages m left join public.profiles p on p.user_id = m.user_id
     where m.clan_id = r.clan and m.id > coalesce(after_id, 0) and m.id < coalesce(before_id, 9223372036854775807)
     order by m.id desc limit least(greatest(coalesce(lim, 50), 1), 100)) q);
end;
$$;

create function public.clan_delete_message(id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record;
begin
  select * into r from public.clan_role(uid);
  delete from public.clan_messages m
   where m.id = clan_delete_message.id and m.clan_id = r.clan
     and (m.user_id = uid or r.role in ('leader', 'officer'));
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
end;
$$;

-- ---------------------------------------------------------------- avatars and emblems
-- Public bucket (others must see avatars); files live under "<user id>/<file>".
-- Writing needs an active trial/subscription; only the owner lists or deletes.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 512 * 1024, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_read_own on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access());
create policy avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access());
create policy avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------- privileges

revoke all on public.profiles, public.clans, public.clan_members, public.clan_invites, public.clan_messages
  from anon, authenticated;
revoke all on function public.social_uid(), public.social_need_access(), public.social_fail(text),
  public.social_own_file(uuid, text), public.profile_json(uuid), public.clan_member_gone(),
  public.clan_role(uuid), public.my_profile(), public.get_profile(uuid),
  public.save_profile(text, text, jsonb, text), public.my_clan(), public.create_clan(text, text, text, text),
  public.update_clan(text, text, text, text), public.clan_create_invite(integer, integer),
  public.clan_invites_list(), public.clan_revoke_invite(text), public.clan_preview(text), public.clan_join(text),
  public.clan_leave(), public.clan_set_role(uuid, text), public.clan_kick(uuid), public.clan_disband(),
  public.clan_send(text), public.clan_messages(bigint, bigint, integer), public.clan_delete_message(bigint)
  from public, anon, authenticated;
grant execute on function public.my_profile(), public.get_profile(uuid),
  public.save_profile(text, text, jsonb, text), public.my_clan(), public.create_clan(text, text, text, text),
  public.update_clan(text, text, text, text), public.clan_create_invite(integer, integer),
  public.clan_invites_list(), public.clan_revoke_invite(text), public.clan_preview(text), public.clan_join(text),
  public.clan_leave(), public.clan_set_role(uuid, text), public.clan_kick(uuid), public.clan_disband(),
  public.clan_send(text), public.clan_messages(bigint, bigint, integer), public.clan_delete_message(bigint)
  to authenticated;
