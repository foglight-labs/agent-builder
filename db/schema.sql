-- Skills catalog schema.
--
-- This app only READS these tables. Ingestion/writes are owned by a separate
-- repository, which must respect this contract. Apply once as an admin:
--   local:    psql "$ADMIN_URL" -f db/schema.sql
--   Supabase: paste into the SQL editor (or run via psql with the direct URL)
--
-- Before running, replace the skills_reader password placeholder below.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.skills (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                        -- e.g. 'mattpocock/skills' (used in `npx skills add <source>`)
  name        text not null,                        -- slug from SKILL.md frontmatter (used in `--skill <name>`)
  description text not null default '',
  url         text not null,                        -- human-facing link to the skill
  metadata    jsonb not null default '{}'::jsonb,   -- raw frontmatter / anything else the writer wants to keep
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (source, name)
);

create table if not exists public.skill_files (
  id         uuid primary key default gen_random_uuid(),
  skill_id   uuid not null references public.skills (id) on delete cascade,
  path       text not null,                         -- relative to the skill dir: 'SKILL.md', 'scripts/x.sh'
  content    bytea not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (skill_id, path)                           -- also serves as the skill_id lookup index
);

-- ---------------------------------------------------------------------------
-- Row level security
-- Supabase exposes `public` through PostgREST; a select-only policy keeps the
-- anon/authenticated keys read-only. On a plain local Postgres this is a no-op.
-- ---------------------------------------------------------------------------

alter table public.skills      enable row level security;
alter table public.skill_files enable row level security;

drop policy if exists "skills are readable by everyone" on public.skills;
create policy "skills are readable by everyone"
  on public.skills for select using (true);

drop policy if exists "skill files are readable by everyone" on public.skill_files;
create policy "skill files are readable by everyone"
  on public.skill_files for select using (true);

-- ---------------------------------------------------------------------------
-- Read-only role used by this app (DATABASE_URL).
-- Defense in depth: the app never runs model-authored SQL, but this role could
-- not write even if it tried.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'skills_reader') then
    create role skills_reader login password 'CHANGE_ME';
  end if;
end
$$;

grant usage on schema public to skills_reader;
grant select on table public.skills, public.skill_files to skills_reader;
alter role skills_reader set default_transaction_read_only = on;
