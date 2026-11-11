-- Journal by myIDgod: accounts, trial, subscriptions, admin, synced state.
-- Run once in Supabase: SQL Editor -> paste -> Run.
-- Access is enforced here in the database (row level security + functions),
-- never in the browser: the site code is public.


-- ---------------------------------------------------------------- tables

create table public.admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trial_ends_at timestamptz not null,
  paid_until timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.admin_actions (
  id bigint generated always as identity primary key,
  admin_id uuid not null,
  target_id uuid,
  action text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

-- One row per user: the whole journal state (trades, plans, settings).
-- rev is bumped on every save so two devices cannot silently overwrite
-- each other (compare-and-set in save_state).
create table public.journal_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  rev bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint state_size check (pg_column_size(state) < 20 * 1024 * 1024)
);

alter table public.admins enable row level security;
alter table public.subscriptions enable row level security;
alter table public.admin_actions enable row level security;
alter table public.journal_state enable row level security;

-- ---------------------------------------------------------------- helpers

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- Admins always have access. Others: trial or paid period still running.
create function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or exists (
    select 1 from public.subscriptions s
    where s.user_id = auth.uid()
      and now() < greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at))
  );
$$;

-- 14-day trial for every new account (email or Google sign-in).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.subscriptions (user_id, trial_ends_at)
  values (new.id, now() + interval '14 days')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- policies

-- Users read only their own subscription row; nobody writes directly.
create policy subscriptions_select_own on public.subscriptions
  for select using (user_id = auth.uid());

-- Own state is always readable (view + export after expiry).
-- Writes go only through save_state(), which checks has_access().
create policy journal_state_select_own on public.journal_state
  for select using (user_id = auth.uid());

-- admins / admin_actions: no policies = not readable through the API.

-- ---------------------------------------------------------------- state API

create function public.save_state(expected_rev bigint, new_state jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  new_rev bigint;
begin
  if uid is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if not public.has_access() then raise exception 'subscription_required' using errcode = '42501'; end if;

  insert into public.journal_state (user_id, state, rev)
  values (uid, new_state, 1)
  on conflict (user_id) do update
    set state = excluded.state, rev = public.journal_state.rev + 1, updated_at = now()
    where public.journal_state.rev = expected_rev
  returning rev into new_rev;

  if new_rev is null then raise exception 'rev_conflict' using errcode = '40001'; end if;
  return new_rev;
end;
$$;

-- Status for the UI: 'admin' | 'trial' | 'active' | 'expired'.
create function public.my_access() returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when public.is_admin() then jsonb_build_object('status','admin','until',null)
    else (
      select jsonb_build_object(
        'status', case
          when now() >= greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at)) then 'expired'
          when s.paid_until is not null and s.paid_until > s.trial_ends_at then 'active'
          else 'trial' end,
        'until', greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at)))
      from public.subscriptions s where s.user_id = auth.uid())
  end;
$$;

-- ---------------------------------------------------------------- admin API

create function public.admin_list_users() returns table (
  user_id uuid, email text, created_at timestamptz,
  trial_ends_at timestamptz, paid_until timestamptz, note text, has_access boolean
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  return query
    select u.id, u.email::text, u.created_at, s.trial_ends_at, s.paid_until, s.note,
           now() < greatest(s.trial_ends_at, coalesce(s.paid_until, s.trial_ends_at))
    from auth.users u join public.subscriptions s on s.user_id = u.id
    order by u.created_at desc;
end;
$$;

-- Give `days` of paid access (negative shortens). Extends from the later of
-- now and the current paid end, so early renewals do not lose days.
create function public.admin_grant(target uuid, days integer, note text default null)
returns timestamptz
language plpgsql security definer set search_path = public as $$
declare new_until timestamptz;
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if days is null or days = 0 or abs(days) > 3660 then raise exception 'bad_days'; end if;
  update public.subscriptions s
     set paid_until = greatest(now(), coalesce(s.paid_until, now())) + make_interval(days => days),
         note = coalesce(admin_grant.note, s.note), updated_at = now()
   where s.user_id = target
   returning s.paid_until into new_until;
  if new_until is null then raise exception 'user_not_found'; end if;
  insert into public.admin_actions (admin_id, target_id, action, detail)
  values (auth.uid(), target, 'grant', jsonb_build_object('days', days, 'paid_until', new_until, 'note', note));
  return new_until;
end;
$$;

-- End paid access and trial immediately (data stays, read-only).
create function public.admin_revoke(target uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.subscriptions
     set paid_until = now(), trial_ends_at = least(trial_ends_at, now()), updated_at = now()
   where user_id = target;
  insert into public.admin_actions (admin_id, target_id, action) values (auth.uid(), target, 'revoke');
end;
$$;

-- ---------------------------------------------------------------- privileges

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant usage on schema public to anon, authenticated;
grant select on public.subscriptions, public.journal_state to authenticated;
grant execute on function public.save_state(bigint, jsonb), public.my_access(),
  public.admin_list_users(), public.admin_grant(uuid, integer, text),
  public.admin_revoke(uuid), public.is_admin(), public.has_access() to authenticated;

-- ---------------------------------------------------------------- screenshots
-- Private bucket; files live under "<user id>/<file>". Reading is always
-- allowed for the owner; uploading needs an active trial/subscription.

insert into storage.buckets (id, name, public, file_size_limit)
values ('shots', 'shots', false, 2 * 1024 * 1024)
on conflict (id) do nothing;

create policy shots_read_own on storage.objects for select to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
create policy shots_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access());
create policy shots_update_own on storage.objects for update to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access());
create policy shots_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'shots' and (storage.foldername(name))[1] = auth.uid()::text);
