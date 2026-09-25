-- Invite-only access for ACCESS_MODE=invite.
--
-- One row per email. Signed-in users who aren't on the list are added as
-- `waitlisted` by join_waitlist(). Admins manage rows in the Table Editor:
--   * insert an email as `allowed` to pre-approve it (no email is sent)
--   * change a `waitlisted` row to `allowed` to approve it and send the
--     "You're in" email through the app's webhook

create extension if not exists citext with schema extensions;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;

create type public.access_status as enum ('waitlisted', 'allowed');

create table public.access_list (
  email extensions.citext primary key,
  status public.access_status not null default 'waitlisted',
  user_id uuid unique references auth.users (id) on delete set null,
  full_name text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  approved_at timestamptz
);

comment on table public.access_list is
  'Who may use the app when ACCESS_MODE=invite. Changing a row from waitlisted to allowed emails that person.';

-- RLS on with no policies, and no table privileges for API roles: the only
-- way in from the Data API is the two security definer functions below.
alter table public.access_list enable row level security;
revoke all on table public.access_list from anon, authenticated;

-- The caller's email, but only once it's confirmed. The JWT's email claim
-- isn't enough: an unconfirmed address hasn't been proven to belong to them.
--
-- Emails are compared with lower() because with an empty search_path an
-- unqualified `=` between citext values resolves to case-sensitive text
-- equality (the citext operators live in the extensions schema).

create function public.get_my_access()
returns public.access_status
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_status public.access_status;
begin
  select u.email into v_email
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;

  if v_email is null then
    return 'waitlisted';
  end if;

  select a.status into v_status
  from public.access_list a
  where lower(a.email::text) = lower(v_email);

  return coalesce(v_status, 'waitlisted');
end;
$$;

-- Adds the caller to the list if they're missing and links their account to
-- an existing (possibly pre-approved) row. Safe to call on every sign-in.
create function public.join_waitlist()
returns public.access_status
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email text;
  v_name text;
  v_status public.access_status;
begin
  select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
  into v_user_id, v_email, v_name
  from auth.users u
  where u.id = auth.uid() and u.email_confirmed_at is not null;

  if v_email is null then
    return 'waitlisted';
  end if;

  insert into public.access_list (email, user_id, full_name)
  values (v_email::extensions.citext, v_user_id, v_name)
  on conflict (email) do nothing;

  -- user_id is unique, so a row left over from a previous email must let go
  -- of it before the current row can take it.
  update public.access_list a
  set user_id = null
  where a.user_id = v_user_id and lower(a.email::text) <> lower(v_email);

  update public.access_list a
  set user_id = v_user_id,
      full_name = coalesce(a.full_name, v_name)
  where lower(a.email::text) = lower(v_email)
    and (a.user_id is distinct from v_user_id or (a.full_name is null and v_name is not null));

  select a.status into v_status
  from public.access_list a
  where lower(a.email::text) = lower(v_email);

  return coalesce(v_status, 'waitlisted');
end;
$$;

-- Supabase grants EXECUTE on new public functions to anon; only signed-in
-- users may ask about themselves.
revoke execute on function public.get_my_access() from public, anon;
revoke execute on function public.join_waitlist() from public, anon;
grant execute on function public.get_my_access() to authenticated;
grant execute on function public.join_waitlist() to authenticated;

create function private.access_list_timestamps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;

  if new.status = 'allowed' then
    if tg_op = 'INSERT' or old.status <> 'allowed' then
      new.approved_at := now();
    end if;
  else
    new.approved_at := null;
  end if;

  return new;
end;
$$;

create trigger access_list_timestamps
before insert or update on public.access_list
for each row execute function private.access_list_timestamps();

-- Asks the app to send the "You're in" email. pg_net queues the request and
-- sends it after the transaction commits, so a slow or failing app never
-- blocks the admin's edit. Does nothing until both Vault secrets exist:
--   app_url                 e.g. https://try.foglight.co
--   access_webhook_secret   same value as ACCESS_WEBHOOK_SECRET in the app
create function private.notify_access_granted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_app_url text;
  v_secret text;
begin
  select s.decrypted_secret into v_app_url from vault.decrypted_secrets s where s.name = 'app_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'access_webhook_secret';

  if coalesce(v_app_url, '') = '' or coalesce(v_secret, '') = '' then
    return new;
  end if;

  perform net.http_post(
    url := rtrim(v_app_url, '/') || '/api/webhooks/access-granted',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := jsonb_build_object('email', new.email::text, 'full_name', new.full_name)
  );

  return new;
exception when others then
  raise warning 'notify_access_granted(%) failed: %', new.email, sqlerrm;
  return new;
end;
$$;

create trigger access_list_notify_granted
after update of status on public.access_list
for each row
when (old.status = 'waitlisted' and new.status = 'allowed')
execute function private.notify_access_granted();
