import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const requiredPages = [
  "Home", "Getting-Started", "Installation", "Configuration", "Troubleshooting",
  "Worlds-and-the-World-Switcher", "Writing-and-Editing", "Publishing-and-Permissions",
  "Player-Accounts-and-Invitations", "Reader-Navigation-and-Search", "Article-Links-and-Backlinks",
  "Character-Sheets", "Structured-Article-Templates", "Variable-Macros", "Interactive-Maps",
  "Images-and-Stock-Art", "World-Appearance-and-Themes", "Campaign-Sessions",
  "Importing-from-Foundry-VTT", "Backup-and-Restore", "Performance-and-Limits",
  "Security-Model", "Installation-Administration", "Upgrading-and-Releases",
  "Development-Setup", "Testing-and-Isolated-Databases", "Architecture-Overview",
  "AI-Disclosure", "Wiki-Maintenance", "Wiki-Verification", "_Sidebar", "_Footer",
];

function headingIds(text) {
  const counts = new Map();
  return new Set([...text.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => {
    const base = match[1].toLowerCase().replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}_\-\s]/gu, "").replace(/ /g, "-");
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  }));
}

export async function checkWiki(directory, required = requiredPages) {
  directory = directory instanceof URL ? fileURLToPath(directory) : directory;
  const names = (await readdir(directory)).filter((name) => name.endsWith(".md"));
  const pages = new Map(await Promise.all(names.map(async (name) =>
    [name.slice(0, -3), await readFile(resolve(directory, name), "utf8")])));
  const errors = [];
  for (const page of required) {
    if (!pages.has(page)) errors.push(`Missing required page: ${page}`);
  }
  const sidebarTargets = new Set();
  for (const [name, text] of pages) {
    if (!/\*\*Source owner:\*\*/.test(text)) errors.push(`${name}: missing source owner`);
    if (!/\*\*Verified against:\*\*[^\n]*`[^`]+`/.test(text)) errors.push(`${name}: missing verification baseline`);
    // Fenced examples are not rendered Markdown links.
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
    for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^[a-z][a-z\d+.-]*:/i.test(target)) continue;
      let path;
      let anchor;
      try {
        [path, anchor] = target.split("#").map(decodeURIComponent);
      } catch {
        errors.push(`${name}: malformed link ${target}`);
        continue;
      }
      const page = path ? path.replace(/^\.\//, "").replace(/\.md$/, "") : name;
      if (!pages.has(page)) errors.push(`${name}: missing link target ${target}`);
      else if (anchor && !headingIds(pages.get(page)).has(anchor)) {
        errors.push(`${name}: missing heading ${target}`);
      }
      if (name === "_Sidebar") sidebarTargets.add(page);
    }
  }
  for (const name of pages.keys()) {
    if (!name.startsWith("_") && !sidebarTargets.has(name)) errors.push(`${name}: absent from sidebar`);
  }
  return { pages: pages.size, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkWiki(fileURLToPath(new URL("../wiki/", import.meta.url))).then((result) => {
    for (const error of result.errors) console.error(error);
    console.log(`Wiki: ${result.pages} pages, ${result.errors.length} errors`);
    process.exitCode = result.errors.length ? 1 : 0;
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
