import type { JSONContent } from "@tiptap/core";
import type { ArticleTemplateMeta } from "@/types";
import type { RpgBlockItem } from "./rpg";
import { templateFieldGroups } from "./templates";
import { isCharacterRowsKey } from "./character-sheet";

export function starterOutline(sections: string[]): JSONContent {
  return { type: "doc", content: sections.flatMap(text => [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text }] },
    { type: "paragraph" },
  ]) };
}

export function isEmptyArticle(html: string, json?: JSONContent) {
  if (json?.type === "doc" && Array.isArray(json.content)) return json.content.every(node => node.type === "paragraph" && (!node.content?.length || node.content.every(child => child.type === "text" && !child.text?.trim())));
  return !html.replace(/<\/?p\b[^>]*>|<br\s*\/?\s*>|&nbsp;/gi, "").trim();
}

export function articleBlockCategory(template: string) {
  return ({ CHARACTER: "NPC", CREATURE: "MONSTER", SPELL: "SPELL", ITEM: "ITEM" } as Record<string, string>)[template];
}
export function articleStatblockKey(system: string) { return `${system === "PF_2E" ? "pf2e" : system === "DND_5E" ? "dnd5e" : system}StatblockId`; }
export function articleStatblock(template: string, system: string, metadata: Record<string, unknown>, blocks: RpgBlockItem[]) {
  const id = metadata[articleStatblockKey(system)];
  return blocks.find(block => block.id === id && block.system === system && block.category === articleBlockCategory(template));
}

export function articleFacts(template: ArticleTemplateMeta, metadata: Record<string, unknown>) {
  const present = (value: unknown) => value !== undefined && value !== null && String(value).trim() !== "";
  const groups = templateFieldGroups(template).map(group => ({ name: group.name, fields: group.fields.filter(field => present(metadata[field.key])).map(field => ({ key: field.key, label: field.label, value: String(metadata[field.key]) })) })).filter(group => group.fields.length);
  const active = new Set(template.fields.map(field => field.key));
  const other = Object.entries(metadata).filter(([key, value]) => key !== "rulesSystem" && !isCharacterRowsKey(key) && !key.endsWith("StatblockId") && !active.has(key) && present(value)).map(([key, value]) => ({ key, label: key.replace(/([a-z])([A-Z])/g, "$1 $2"), value: String(value) }));
  return { groups, other };
}
