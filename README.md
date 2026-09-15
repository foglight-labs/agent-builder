# agent-builder
Turn any task into an optimal agent harness from open-source components.

## MVP v0
Describe a task → get a recommended skill pack (from [mattpocock/skills](https://github.com/mattpocock/skills)) → copy an `npx skills add` install script.

## Run
```bash
cp .env.example .env.local   # set OPENROUTER_API_KEY
npm install
npm run dev
```

## Catalog
`data/skills.json` is the skill catalog the model picks from. Regenerate it with:
```bash
node scripts/build-catalog.mjs
```
