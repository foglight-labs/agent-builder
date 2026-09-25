-- Manual checks for the access_list migration, run against local Supabase:
--   docker exec -i supabase_db_agent-builder psql -U postgres -d postgres < supabase/tests/access_list.test.sql
-- Not part of migrations; rolled back where possible so it can run repeatedly.

begin;

-- Two confirmed users. Alice is pre-approved (allowed, silent); Bob is nobody.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Alice@Example.com', '', now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Alice A"}', now(), now()),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bob@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

insert into public.access_list (email, status) values ('alice@example.com', 'allowed');

-- Case-insensitive match under an empty search_path: Alice's auth email is
-- 'Alice@Example.com', her row is 'alice@example.com'.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select public.get_my_access() as alice_status;            -- expect: allowed
select public.join_waitlist() as alice_join;              -- expect: allowed
reset role;

select email::text, status::text, user_id is not null as linked, full_name, approved_at is not null as approved
from public.access_list where lower(email::text) = 'alice@example.com';
-- expect: alice@example.com | allowed | t | Alice A | t

-- Bob: not on the list at all.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';
select public.get_my_access() as bob_status;              -- expect: waitlisted
select public.join_waitlist() as bob_join;                -- expect: waitlisted
reset role;

select email::text, status::text, user_id is not null as linked
from public.access_list where email::text = 'bob@example.com';
-- expect: bob@example.com | waitlisted | t

-- Approving Bob stamps approved_at and queues the webhook via pg_net.
update public.access_list set status = 'allowed' where email::text = 'bob@example.com';
select status::text, approved_at is not null as approved from public.access_list where email::text = 'bob@example.com';
-- expect: allowed | t

-- Rejecting (back to waitlisted) clears approved_at.
update public.access_list set status = 'waitlisted' where email::text = 'bob@example.com';
select status::text, approved_at is null as unapproved from public.access_list where email::text = 'bob@example.com';
-- expect: waitlisted | t

rollback;

-- Vault secrets seeded for the webhook URL and secret.
select name from vault.decrypted_secrets order by name;
-- expect: access_webhook_secret, app_url

-- Table and function lockdown: authenticated can call the functions but not
-- read the table; anon can do neither. Expected failures are marked.
set role authenticated;
select count(*) from public.access_list;                  -- expect: ERROR permission denied
reset role;

set role anon;
select public.get_my_access();                            -- expect: ERROR permission denied
reset role;

select 'done' as status;
