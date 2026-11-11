-- Journal by myIDgod: unique look-alike-proof names, social links, bans, reports (stages 3-4).
--   * nicks, clan names and clan tags are unique by their "skeleton": case, separators and
--     look-alike letters (Latin/Cyrillic, 0/O, 1/l/I) are folded, so "myIDgod", "my_idgod"
--     and "myІDgоd" (Cyrillic letters) are one name;
--   * profile: Discord, Telegram and TikTok usernames shown as links;
--   * admin: bans (with reason and optional end date), clan moderation;
--   * reports on users and bugs: reason, details, up to 4 screenshots (private "reports" bucket).
-- Same model as before: tables have RLS on and no grants, everything goes through functions.

-- ---------------------------------------------------------------- look-alike folding

create function public.name_skeleton(t text) returns text
language sql immutable strict parallel safe set search_path = public as $$
  select replace(replace(regexp_replace(
           translate(lower(t),            -- upper-case Cyrillic listed too: lower() is ASCII-only under the C locale
             'авеёкмнорстухьѕіїјԁ01|iАВЕЁКМНОРСТУХЬЅІЇЈ',
             'abeekmhopctyxbslljdolllabeekmhopctyxbsllj'),
           '[\s_.\-]', '', 'g'), 'rn', 'm'), 'vv', 'w')
$$;

-- existing data is checked by the index build itself: a clash aborts the migration
create unique index profiles_nick_skeleton on public.profiles (public.name_skeleton(nick));
create unique index clans_name_skeleton on public.clans (public.name_skeleton(name));
create unique index clans_tag_skeleton on public.clans (public.name_skeleton(tag));

-- which name a unique violation was about
create function public.taken_code(cname text) returns text
language sql immutable set search_path = public as $$
  select case when cname in ('clans_name_skeleton') then 'name_taken'
              when cname in ('clans_tag_key', 'clans_tag_skeleton') then 'tag_taken'
              else 'nick_taken' end
$$;

-- Is this name free? kind: nick | clan_name | clan_tag. The caller's own record does not count.
create function public.name_available(kind text, value text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := public.social_uid(); s text := public.name_skeleton(btrim(coalesce(value, '')));
begin
  if s is null or s = '' then return false; end if;
  if kind = 'nick' then
    return not exists (select 1 from public.profiles p where public.name_skeleton(p.nick) = s and p.user_id <> uid);
  elsif kind in ('clan_name', 'clan_tag') then
    return not exists (select 1 from public.clans c
      where public.name_skeleton(case when kind = 'clan_name' then c.name else c.tag end) = s
        and c.id is distinct from (select m.clan_id from public.clan_members m where m.user_id = uid));
  end if;
  perform public.social_fail('kind_invalid');
  return false;
end;
$$;

-- ---------------------------------------------------------------- social links

alter table public.profiles
  add column discord text check (discord ~ '^[a-z0-9_.]{2,32}$'),
  add column telegram text check (telegram ~ '^[A-Za-z][A-Za-z0-9_]{4,31}$'),
  add column tiktok text check (tiktok ~ '^[A-Za-z0-9_.]{2,24}$');

create or replace function public.profile_json(uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'user_id', uid, 'nick', p.nick, 'avatar_path', p.avatar_path,
    'bio', coalesce(p.bio, ''), 'links', coalesce(p.links, '[]'::jsonb),
    'socials', jsonb_build_object('discord', p.discord, 'telegram', p.telegram, 'tiktok', p.tiktok),
    'clan', (select jsonb_build_object('id', c.id, 'tag', c.tag, 'name', c.name, 'color', c.color,
                                       'emblem_path', c.emblem_path, 'role', m.role)
               from public.clan_members m join public.clans c on c.id = m.clan_id
              where m.user_id = uid))
    from (select uid) x left join public.profiles p on p.user_id = uid
$$;

-- '' or null clears a field; "@name" and full profile links are accepted and trimmed to the username
create function public.save_socials(discord text default null, telegram text default null, tiktok text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid();
        d text := nullif(lower(regexp_replace(btrim(coalesce(discord, '')), '^@', '')), '');
        tg text := nullif(regexp_replace(regexp_replace(btrim(coalesce(telegram, '')), '^(https?://)?(www\.)?(t\.me|telegram\.me)/', '', 'i'), '^@|[/?#].*$', '', 'g'), '');
        tt text := nullif(regexp_replace(regexp_replace(btrim(coalesce(tiktok, '')), '^(https?://)?(www\.)?tiktok\.com/', '', 'i'), '^@|[/?#].*$', '', 'g'), '');
begin
  perform public.social_need_access();
  if not exists (select 1 from public.profiles where user_id = uid) then perform public.social_fail('nick_required'); end if;
  if d is not null and d !~ '^[a-z0-9_.]{2,32}$' then perform public.social_fail('discord_invalid'); end if;
  if tg is not null and tg !~ '^[A-Za-z][A-Za-z0-9_]{4,31}$' then perform public.social_fail('telegram_invalid'); end if;
  if tt is not null and tt !~ '^[A-Za-z0-9_.]{2,24}$' then perform public.social_fail('tiktok_invalid'); end if;
  update public.profiles p set discord = d, telegram = tg, tiktok = tt, updated_at = now() where p.user_id = uid;
  return public.profile_json(uid);
end;
$$;

-- ---------------------------------------------------------------- clan names: precise "taken" codes

create or replace function public.create_clan(tag text, name text, description text default '', color text default '#0a0a0b')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); t text := upper(btrim(coalesce(tag, ''))); nm text := btrim(coalesce(name, ''));
        d text := btrim(coalesce(description, '')); co text := lower(btrim(coalesce(color, '#0a0a0b'))); cid uuid; cn text;
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
    get stacked diagnostics cn = constraint_name;
    raise exception '%', public.taken_code(cn) using errcode = '23505';
  end;
  insert into public.clan_members (user_id, clan_id, role) values (uid, cid, 'leader');
  return public.my_clan();
end;
$$;

create or replace function public.update_clan(name text default null, description text default null,
                                              color text default null, emblem_path text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); r record; cn text;
begin
  perform public.social_need_access();
  select * into r from public.clan_role(uid);
  if r.clan is null or r.role not in ('leader', 'officer') then raise exception 'not_allowed' using errcode = '42501'; end if;
  if name is not null then name := btrim(name); if char_length(name) not between 3 and 32 then perform public.social_fail('name_invalid'); end if; end if;
  if description is not null then description := btrim(description); if char_length(description) > 500 then perform public.social_fail('description_too_long'); end if; end if;
  if color is not null then color := lower(btrim(color)); if color !~ '^#[0-9a-f]{6}$' then perform public.social_fail('color_invalid'); end if; end if;
  if emblem_path is not null and emblem_path <> '' and not public.social_own_file(uid, emblem_path) then perform public.social_fail('emblem_invalid'); end if;
  begin
    update public.clans c
       set name = coalesce(update_clan.name, c.name),
           description = coalesce(update_clan.description, c.description),
           color = coalesce(update_clan.color, c.color),
           emblem_path = case when update_clan.emblem_path is null then c.emblem_path
                              when update_clan.emblem_path = '' then null else update_clan.emblem_path end
     where c.id = r.clan;
  exception when unique_violation then
    get stacked diagnostics cn = constraint_name;
    raise exception '%', public.taken_code(cn) using errcode = '23505';
  end;
  return public.my_clan();
end;
$$;

-- ---------------------------------------------------------------- bans

create table public.bans (
  user_id uuid primary key references auth.users (id) on delete cascade,
  reason text not null check (char_length(reason) between 3 and 300),
  until timestamptz,                                   -- null = until lifted
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.bans enable row level security;

create function public.is_banned(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bans b where b.user_id = uid and (b.until is null or b.until > now()))
$$;

-- a ban turns writing off everywhere has_access() is checked (journal, screenshots, profile, clans)
create or replace function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or (not public.is_banned(auth.uid()) and exists (
    select 1 from public.subscriptions s
    where s.user_id = auth.uid()
      and now() < greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at))
  ));
$$;

create or replace function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then jsonb_build_object('status','admin','until',null)
    when public.is_banned(auth.uid()) then (
      select jsonb_build_object('status', 'banned', 'until', b.until, 'reason', b.reason)
        from public.bans b where b.user_id = auth.uid())
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

-- days null = until lifted
create function public.admin_ban(target uuid, reason text, days integer default null) returns void
language plpgsql security definer set search_path = public as $$
declare r text := btrim(coalesce(reason, ''));
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if target is null or not exists (select 1 from auth.users where id = target) then perform public.social_fail('user_not_found'); end if;
  if exists (select 1 from public.admins where user_id = target) then perform public.social_fail('cannot_ban_admin'); end if;
  if char_length(r) not between 3 and 300 then perform public.social_fail('reason_invalid'); end if;
  if days is not null and days not between 1 and 3650 then perform public.social_fail('days_invalid'); end if;
  insert into public.bans (user_id, reason, until, created_by)
  values (target, r, case when days is null then null else now() + make_interval(days => days) end, auth.uid())
  on conflict (user_id) do update set reason = excluded.reason, until = excluded.until,
    created_by = excluded.created_by, created_at = now();
end;
$$;

create function public.admin_unban(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.bans where user_id = target;
end;
$$;

create function public.admin_bans() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', b.user_id, 'email', u.email, 'nick', p.nick,
      'reason', b.reason, 'until', b.until, 'created_at', b.created_at,
      'active', b.until is null or b.until > now()) order by b.created_at desc)
    from public.bans b join auth.users u on u.id = b.user_id left join public.profiles p on p.user_id = b.user_id), '[]'::jsonb);
end;
$$;

-- moderation of clans and chat
create function public.admin_delete_message(id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.clan_messages m where m.id = admin_delete_message.id;
end;
$$;

create function public.admin_disband_clan(clan uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.clans c where c.id = admin_disband_clan.clan;
end;
$$;

-- a nick an admin finds offensive is replaced by a neutral one; the user picks a new one later
create function public.admin_reset_nick(target uuid) returns text
language plpgsql security definer set search_path = public as $$
declare n text := 'user' || substr(replace(target::text, '-', ''), 1, 8);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.profiles set nick = n, bio = '', links = '[]'::jsonb, updated_at = now() where user_id = target;
  return n;
end;
$$;

-- ---------------------------------------------------------------- reports

create table public.reports (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('user', 'bug')),
  reporter uuid references auth.users (id) on delete set null,
  target uuid references auth.users (id) on delete set null,
  category text not null check (category in ('spam', 'abuse', 'cheating', 'impersonation', 'scam', 'other',
                                              'bug_ui', 'bug_data', 'bug_sync', 'bug_payment', 'bug_other')),
  details text not null check (char_length(details) between 5 and 2000),
  page text not null default '' check (char_length(page) <= 200),
  evidence text[] not null default '{}' check (cardinality(evidence) <= 4),
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  admin_note text not null default '' check (char_length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id) on delete set null
);
create index reports_status on public.reports (status, created_at desc);
create index reports_reporter on public.reports (reporter, created_at desc);
alter table public.reports enable row level security;

-- Signed-in users only; any access status (an expired user can still report a bug).
-- At most 10 reports a day; screenshots must sit in the caller's own folder of "reports".
create function public.submit_report(kind text, category text, details text, target uuid default null,
                                     page text default '', evidence text[] default '{}')
returns bigint
language plpgsql security definer set search_path = public as $$
declare uid uuid := public.social_uid(); d text := btrim(coalesce(details, '')); pg text := left(btrim(coalesce(page, '')), 200);
        ev text[] := coalesce(evidence, '{}'); f text; rid bigint;
begin
  if kind not in ('user', 'bug') then perform public.social_fail('kind_invalid'); end if;
  if kind = 'user' then
    if category not in ('spam', 'abuse', 'cheating', 'impersonation', 'scam', 'other') then perform public.social_fail('category_invalid'); end if;
    if target is null or not exists (select 1 from public.profiles where user_id = target) then perform public.social_fail('user_not_found'); end if;
    if target = uid then perform public.social_fail('cannot_report_self'); end if;
  else
    if category not in ('bug_ui', 'bug_data', 'bug_sync', 'bug_payment', 'bug_other') then perform public.social_fail('category_invalid'); end if;
    target := null;
  end if;
  if char_length(d) not between 5 and 2000 then perform public.social_fail('details_invalid'); end if;
  if cardinality(ev) > 4 then perform public.social_fail('too_many_files'); end if;
  foreach f in array ev loop
    if not public.social_own_file(uid, f) then perform public.social_fail('evidence_invalid'); end if;
  end loop;
  if (select count(*) from public.reports r where r.reporter = uid and r.created_at > now() - interval '1 day') >= 10 then
    perform public.social_fail('too_many_reports');
  end if;
  insert into public.reports (kind, reporter, target, category, details, page, evidence)
  values (kind, uid, target, category, d, pg, ev) returning id into rid;
  return rid;
end;
$$;

create function public.my_reports() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'category', r.category, 'status', r.status,
           'admin_note', r.admin_note, 'created_at', r.created_at, 'target_nick', p.nick) order by r.id desc), '[]'::jsonb)
    from (select * from public.reports where reporter = public.social_uid() order by id desc limit 50) r
    left join public.profiles p on p.user_id = r.target
$$;

create function public.admin_reports(status text default 'open', lim integer default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(x order by (x->>'id')::bigint desc) from (
    select jsonb_build_object('id', r.id, 'kind', r.kind, 'category', r.category, 'details', r.details, 'page', r.page,
      'evidence', to_jsonb(r.evidence), 'status', r.status, 'admin_note', r.admin_note, 'created_at', r.created_at,
      'reporter', r.reporter, 'reporter_email', ru.email, 'reporter_nick', rp.nick,
      'target', r.target, 'target_email', tu.email, 'target_nick', tp.nick,
      'target_banned', r.target is not null and public.is_banned(r.target),
      'target_reports', (select count(*) from public.reports q where q.target = r.target and r.target is not null)) x
      from public.reports r
      left join auth.users ru on ru.id = r.reporter left join public.profiles rp on rp.user_id = r.reporter
      left join auth.users tu on tu.id = r.target left join public.profiles tp on tp.user_id = r.target
     where admin_reports.status = 'all' or r.status = admin_reports.status
     order by r.id desc limit least(greatest(coalesce(lim, 100), 1), 500)) s), '[]'::jsonb);
end;
$$;

create function public.admin_resolve_report(id bigint, status text, note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if status not in ('open', 'resolved', 'rejected') then perform public.social_fail('status_invalid'); end if;
  update public.reports r set status = admin_resolve_report.status, admin_note = left(btrim(coalesce(note, '')), 1000),
         resolved_at = case when admin_resolve_report.status = 'open' then null else now() end,
         resolved_by = case when admin_resolve_report.status = 'open' then null else auth.uid() end
   where r.id = admin_resolve_report.id;
end;
$$;

-- Private bucket for report screenshots: "<user id>/<file>", 2 MB, images only.
-- The author and the admin can read (the admin through signed links); only the author uploads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('reports', 'reports', false, 2 * 1024 * 1024, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy reports_read_own_or_admin on storage.objects for select to authenticated
  using (bucket_id = 'reports' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy reports_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);
create policy reports_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'reports' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------- privileges

revoke all on public.bans, public.reports from anon, authenticated;
revoke all on function public.name_skeleton(text), public.taken_code(text), public.is_banned(uuid),
  public.name_available(text, text), public.save_socials(text, text, text),
  public.admin_ban(uuid, text, integer), public.admin_unban(uuid), public.admin_bans(),
  public.admin_delete_message(bigint), public.admin_disband_clan(uuid), public.admin_reset_nick(uuid),
  public.submit_report(text, text, text, uuid, text, text[]), public.my_reports(),
  public.admin_reports(text, integer), public.admin_resolve_report(bigint, text, text)
  from public, anon, authenticated;
-- name_skeleton is used by the unique indexes; it stays executable for the table owner only
grant execute on function public.name_available(text, text), public.save_socials(text, text, text),
  public.admin_ban(uuid, text, integer), public.admin_unban(uuid), public.admin_bans(),
  public.admin_delete_message(bigint), public.admin_disband_clan(uuid), public.admin_reset_nick(uuid),
  public.submit_report(text, text, text, uuid, text, text[]), public.my_reports(),
  public.admin_reports(text, integer), public.admin_resolve_report(bigint, text, text)
  to authenticated;
-- create or replace keeps earlier grants; profile_json/create_clan/update_clan/has_access/my_access unchanged in that respect
