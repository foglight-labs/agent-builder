# agent-builder
Turn any task into an optimal agent harness from open-source components.

## MVP v0
Describe a task → an LLM agent searches a Postgres skills catalog with read-only tools → get a recommended skill pack and a copyable `npx skills add` install script.

## Run
```bash
cp .env.example .env.local   # set OPENROUTER_API_KEY and DATABASE_URL
npm install
npm run dev
```

## Catalog database
Skills live in Postgres (Supabase in production, any local Postgres in dev). This repo only **reads**; ingestion is owned by a separate repository. `db/schema.sql` is the contract between the two:

- `skills` — one row per skill: `source` (e.g. `mattpocock/skills`), `name`, `description`, `url`, `metadata jsonb`.
- `skill_files` — the skill's files as `bytea` (`SKILL.md`, scripts, …), keyed by `(skill_id, path)`.

Apply the schema once as an admin, after replacing the `CHANGE_ME` password for the `skills_reader` role:

```bash
# local
createdb skills
psql skills -f db/schema.sql

# Supabase: paste db/schema.sql into the SQL editor
```

Then point `DATABASE_URL` at the database as `skills_reader` (see `.env.example`; for Supabase use the transaction-pooler URL with `?sslmode=require`).

## How recommendations work
`POST /api/recommend` runs a tool-calling loop against OpenRouter. The model never writes SQL; it gets three read-only tools backed by parameterized queries:

- `search_skills(query, limit)` — keyword search on name/description (empty query lists everything).
- `get_skill(skill)` — full metadata plus the list of files a skill ships.
- `get_skill_file(skill, path)` — read a file (default `SKILL.md`).

Picked names are validated against the database before the install script is generated.
