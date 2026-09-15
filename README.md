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

## Run logs
Every `POST /api/recommend` call emits exactly one structured JSON line to stdout, tagged `"event":"run"`, containing:
- `input`/`output`: the task and the final recommendation (or `error` with the failing `stage`: `model`, `parse`, `validate`, or `no_matches`).
- `version`: `git_commit` (+ `git_dirty` locally), `prompt_hash` (hash of the system prompt and tool schemas, so you can tell prompt changes apart even between commits), and the requested/served model.
- `trace`: every model round and tool call, with arguments and a truncated (2,000 char) preview of each tool result. If the whole record would exceed ~100KB it's marked `trace.trimmed: true` and previews are dropped, to stay under platform per-log-line limits.

There is no database for this; it relies on your platform's log capture (Railway logs, or Cloudflare Workers Logs — enable `observability.enabled` in your Wrangler config). The response body also includes `run_id` so you can correlate a request with its log line.

Locally, read it straight from the `next dev` terminal, or filter it:
```bash
npm run dev | grep '"event":"run"' | jq
```
Set `RUN_LOG_DIR=runs` in `.env.local` to also write each record to `runs/<run_id>.json` for easier local inspection (gitignored).
