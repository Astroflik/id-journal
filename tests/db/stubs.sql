-- Minimal stand-ins for the parts of Supabase the migrations touch.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text, email_confirmed_at timestamptz,
  created_at timestamptz not null default now(), last_sign_in_at timestamptz
);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;
grant usage on schema auth, storage to anon, authenticated;
-- Supabase makes new objects in "public" reachable by the API roles by
-- default; mimic that so the tests prove the migrations lock things down.
alter default privileges in schema public grant execute on functions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;

create schema t;
grant usage on schema t to anon, authenticated;
create function t.chk(name text, ok boolean) returns text language sql as
  $$ select case when ok then 'PASS ' else 'FAIL ' end || name $$;
-- run a statement as the current role and return its SQLSTATE ('00000' = ok)
create function t.code(statement text) returns text language plpgsql as $$
begin execute statement; return '00000'; exception when others then return sqlstate; end $$;
create function t.act(who uuid) returns void language sql as
  $$ select set_config('request.jwt.claim.sub', coalesce(who::text, ''), false) $$;
