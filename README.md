# agent-builder
Turn any task into an optimal agent harness from open-source components.

## MVP v0
A skills catalog (backed by a hosted Meilisearch index) is served over MCP: any MCP client (Claude Code, Codex, Droid, a custom agent, ...) can search it and pull a skill's install command directly, over `POST /api/mcp`. The web UI is one such client — it runs an LLM agent over the same two tools to turn a task description into a recommended skill pack and a copyable `npx skills add` install script.

## Run
```bash
cp .env.example .env.local   # set OPENROUTER_API_KEY and MEILISEARCH_API_KEY
npm install
npm run dev
```

## Search index
The skills catalog is served from a hosted Meilisearch index (`MEILISEARCH_HOST`, default `https://search.foglight.co`) using a search-scoped `MEILISEARCH_API_KEY`. It is the **only** source for the catalog — there is no fallback if it's unreachable. This repo only reads from it (`POST /indexes/<MEILISEARCH_INDEX>/search`, default index `skills`); the index itself is populated and maintained by a separate system.

Each document carries `repo` (`owner/repo`, our `source`), `name`, `description`, `url`, `frontmatter` (our `metadata`), `files`, and more — see `lib/meilisearch.ts` for the full shape and `lib/skills.ts` for how it's mapped onto the catalog's public types.

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
`POST /api/recommend` runs a tool-calling loop against OpenRouter, connected to an in-process instance of the same MCP server (over an in-memory transport — no extra network hop). The model only sees `search_skills`/`get_skill`; picked ids are validated against the catalog before the install script is generated.

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

## Deploy (Railway)
The repo ships a `Dockerfile` (Next.js `output: "standalone"`) and a `railway.json`, so
Railway just needs to build and run it:

1. Railway → **New Project** → **Deploy from GitHub repo** → pick this repo. Railway
   detects the `Dockerfile` automatically.
2. **Variables** → add `OPENROUTER_API_KEY`, `MEILISEARCH_HOST`, and `MEILISEARCH_API_KEY`
   (plus the optional `OPENROUTER_MODEL` / `MEILISEARCH_INDEX` overrides — see `.env.example`).
3. **Settings → Networking → Custom Domain** → add `try.foglight.co`. Railway shows a
   CNAME target for it.
4. In Cloudflare DNS for `foglight.co`, add `CNAME try → <target Railway gave you>`.
   Either proxy it (orange cloud, with SSL/TLS mode set to **Full (strict)**) or leave it
   DNS-only — both work.
5. `/api/health` is the healthcheck endpoint Railway polls during deploys.
