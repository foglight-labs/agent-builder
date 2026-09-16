# agent-builder
Turn any task into an optimal agent harness from open-source components.

## MVP v0
A Postgres skills catalog is served over MCP: any MCP client (Claude Code, Codex, Droid, a custom agent, ...) can search it and pull a skill's install command directly, over `POST /api/mcp`. The web UI is one such client — it runs an LLM agent over the same two tools to turn a task description into a recommended skill pack and a copyable `npx skills add` install script.

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

## MCP server
`POST /api/mcp` speaks MCP (Streamable HTTP, stateless — no session, no auth yet) over two read-only tools backed by parameterized queries. `lib/mcp.ts` is the single source of truth for both; `/api/mcp` and the recommender below connect to the same server definition, so they can never drift apart.

- `search_skills(query, limit)` — full-text search on name/description, ranked by relevance (empty query lists everything alphabetically).
- `get_skill(id)` — full metadata, the files a skill ships, and ready-to-run `npx skills add`/`npx skills use` commands for one skill.

Skills are addressed as `source/name` (e.g. `vercel-labs/agent-skills/web-design-guidelines`), which `search_skills` returns as `id`. `get_skill` also accepts a bare name if it's unique across sources; if it isn't, the tool reports every matching id instead of guessing.

Point any MCP client at it, for example:

```json
{
  "mcpServers": {
    "foglight-skills": { "url": "http://localhost:3000/api/mcp" }
  }
}
```

(Claude Code, Cursor, and most clients accept this `url`-style entry directly; Codex and Droid config formats differ slightly — see each tool's MCP docs.)

## How recommendations work
`POST /api/recommend` runs a tool-calling loop against OpenRouter, connected to an in-process instance of the same MCP server (over an in-memory transport — no extra network hop). The model never writes SQL and only sees `search_skills`/`get_skill`; picked ids are validated against the database before the install script is generated.

A query that matches nothing is a normal `200` with `skills: []`, not an error — this is a search over a finite catalog. Only genuine failures (model, tool, validation, unparseable output) return `502`.

If the model's final message isn't valid JSON, the loop spends one **repair round** re-asking for the payload with tools disabled and `response_format: {"type":"json_object"}` set, before giving up. JSON mode is only sent on rounds that can't emit tool calls: OpenRouter resolves structured-output support per endpoint, and mixing it with live `tools` is inconsistent across providers.

## Run logs
Every `POST /api/recommend` call emits exactly one structured JSON line to stdout, tagged `"event":"run"`, containing:
- `input`/`output`: the task and the final recommendation (or `error` with the failing `stage`: `model`, `tool`, `parse`, or `validate`).
- `version`: `git_commit` (+ `git_dirty` locally), `prompt_hash` (hash of the system prompt and tool schemas, so you can tell prompt changes apart even between commits), and the requested/served model.
- `trace`: every model round and tool call, with arguments and a truncated (2,000 char) preview of each tool result. Repair rounds are flagged `repair: true`. If the whole record would exceed ~100KB it's marked `trace.trimmed: true` and previews are dropped, to stay under platform per-log-line limits.
- `trace.tool_call_count`: tool calls executed across all rounds. `0` means the agent answered without ever searching the catalog — the difference between "nothing matched" and "we never looked". Worth alerting on:
  ```bash
  npm run dev | grep '"event":"run"' | jq 'select(.trace.tool_call_count == 0)'
  ```

There is no database for this; it relies on your platform's log capture (Railway logs, or Cloudflare Workers Logs — enable `observability.enabled` in your Wrangler config). The response body also includes `run_id` so you can correlate a request with its log line.

Locally, read it straight from the `next dev` terminal, or filter it:
```bash
npm run dev | grep '"event":"run"' | jq
```
Set `RUN_LOG_DIR=runs` in `.env.local` to also write each record to `runs/<run_id>.json` for easier local inspection (gitignored).

## Tests
```bash
npm test
```
`lib/mcp.test.ts` exercises the MCP server end-to-end (list tools, call each one, both error paths) through an in-memory MCP client, with `lib/skills.ts` mocked — no database needed.

`lib/recommend.test.ts` covers the tool-calling loop against scripted OpenRouter replies (`fetch` stubbed, `lib/skills.ts` mocked): the repair round, empty result sets, `tool_call_count`, and which rounds carry `response_format`.
