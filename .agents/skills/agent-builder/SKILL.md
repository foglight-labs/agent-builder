---
name: agent-builder
description: Recommend a pack of installable agent skills for a task by searching the Foglight skills catalog over MCP. Use when the user says "which skills should I install for X", "build me a skill pack", or "I want to solve X" (SEO, distribution, auth, analytics, onboarding emails, payments, etc.). Returns a ranked pack plus ready-to-run `npx skills add` commands; does not write or install skills itself.
---

# Agent Builder

Turn a task into a recommended skill pack from the Foglight catalog, the same way try.foglight.co does.

## 1. State check

You need the MCP tools `search_skills` and `get_skill` (served by the `foglight-skills` MCP server). If they are not in your tool list, reply with exactly this and stop:

> The Foglight skills catalog isn't connected. Add `https://try.foglight.co/api/mcp` to your agent as an HTTP MCP server, then rerun `/agent-builder`.

Do not fall back to curl or web search.

## 2. Clarify only if the task is vague

A task is vague when you can't name a concrete deliverable from it (e.g. "solve SEO/distribution", "grow the product"). In that case ask 1-3 short questions, all at once, then proceed:

- What outcome do you want? (e.g. rank for specific keywords, get a sitemap and meta tags right, set up content distribution to X/LinkedIn/newsletter)
- What is the site or product built with? (framework, hosting, CMS)
- What is already in place? (existing SEO setup, analytics, email tooling)

If the task is already specific ("add structured data and a sitemap to my Next.js site"), skip the questions. Use only the user's text and answers. Do not scan the repo.

## 3. Search the catalog

```
search_skills(query: "seo meta tags sitemap structured data", limit: 20)
search_skills(query: "content distribution social media newsletter", limit: 20)
search_skills(query: "<framework or tool the user named>", limit: 20)
```

- Run 2-4 searches with different keyword sets: tools, domain, activities.
- If results are thin, run `search_skills(query: "", limit: 50)` to list the whole catalog and scan it.
- For candidates whose description leaves the fit unclear, call `get_skill(id)` and read `metadata` and `files`. Skip this for obvious matches.
- If a skill's metadata says it requires another catalog skill, include that one too.

Result shapes:

```jsonc
// search_skills
{ "skills": [{ "id": "owner/repo/name", "source": "owner/repo", "name": "name", "description": "...", "url": "..." }] }

// get_skill
{ "id": "...", "source": "...", "name": "...", "description": "...", "url": "...",
  "metadata": { /* frontmatter */ }, "updated_at": "...", "files": [{ "path": "SKILL.md", "size_bytes": 1234 }],
  "install": "npx skills add owner/repo --skill name -y",
  "use_once": "npx skills use owner/repo@name" }
```

Failure handling:
- `get_skill` returns `error: Unknown skill` → drop that id.
- `get_skill` returns `matches more than one source` → call it again with one of the listed candidate ids.
- A search returns nothing → widen the keywords or use the empty query.

## 4. Pick 3-7 skills

Use only ids returned by the tools. Prefer fewer, more relevant skills over a long list. Drop duplicates that cover the same ground; if two skills overlap, keep the one whose description matches the user's outcome more closely.

## 5. Output

Show the pack, then the install script. Never run the install; the user copies it.

````markdown
## Recommended pack for: <task in a few words>

### 1. `owner/repo/name`
**Why:** One or two sentences on what this skill contributes to the task.
**Setup:** One short line (e.g. "Run /setup-foo once per repo, then invoke /bar"), or "No extra setup".

### 2. ...

## Install

```bash
#!/usr/bin/env bash
set -e
npx skills add owner/repo --skill name -y
npx skills add owner/repo --skill other-name -y
```
````

Each install line is the `install` string from `get_skill`, or `npx skills add <source> --skill <name> -y` built from the search result. One line per skill, same order as the pack.
