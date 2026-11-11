-- An account that exists before 0002 (the admin), to check the backfill.
insert into auth.users (id, email, email_confirmed_at)
values ('00000000-0000-0000-0000-0000000000a1', 'I.L.ia+journal@googlemail.com', now());
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');
