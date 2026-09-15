// One-off: builds data/skills.json from mattpocock/skills SKILL.md frontmatter.
// Usage: node scripts/build-catalog.mjs
import { writeFile, mkdir } from "node:fs/promises";

const REPO = "mattpocock/skills";
const BRANCH = "main";

const tree = await (
  await fetch(`https://api.github.com/repos/${REPO}/git/trees/${BRANCH}?recursive=1`)
).json();

const paths = tree.tree
  .map((e) => e.path)
  .filter((p) => p.startsWith("skills/") && p.endsWith("/SKILL.md"));

function frontmatter(md) {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  const out = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const skills = [];
for (const path of paths) {
  const md = await (
    await fetch(`https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`)
  ).text();
  const fm = frontmatter(md);
  const dir = path.replace(/\/SKILL\.md$/, "");
  const name = fm.name || dir.split("/").pop();
  skills.push({
    name,
    description: fm.description || "",
    url: `https://github.com/${REPO}/tree/${BRANCH}/${dir}`,
  });
  console.error(`ok ${name}`);
}

skills.sort((a, b) => a.name.localeCompare(b.name));
await mkdir("data", { recursive: true });
await writeFile("data/skills.json", JSON.stringify(skills, null, 2) + "\n");
console.error(`wrote ${skills.length} skills to data/skills.json`);
