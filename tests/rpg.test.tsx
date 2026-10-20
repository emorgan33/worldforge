import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { StatblockCard } from "../src/components/blocks/StatblockCard";
import { blockRating, parseBlockStats, starterStats, validateBlockInput, type BlockStats, type RpgBlockItem } from "../src/lib/rpg";
import { getArticleTemplate } from "../src/lib/templates";

function block(system: string, stats: BlockStats, category = "MONSTER"): RpgBlockItem {
  return { id: "test", worldId: "world", name: "Test sentinel", system, category, statsJson: JSON.stringify(stats) };
}
function text(entry: RpgBlockItem) { return renderToStaticMarkup(<StatblockCard block={entry} />).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); }

test("Remaster creature uses signed modifiers and level zero without D&D score conversion", () => {
  const entry = block("PF_2E", { ...starterStats("PF_2E", "MONSTER"), level: 0, attributes: { str: 3, dex: 0, con: 2, int: -1, wis: 1, cha: 0 }, actions: [{ name: "Shield Bash", cost: "2", desc: "Push a foe back." }] });
  const output = text(entry);
  assert.match(output, /Creature 0/);
  assert.match(output, /Str \+3/);
  assert.match(output, /Int -1/);
  assert.match(output, /Fort/);
  assert.match(output, /2 actions/);
  assert.doesNotMatch(output, /Challenge rating|Proficiency Bonus|\(-4\)/);
});

test("D&D 2014 creature retains fractional CR and derives score modifiers", () => {
  const entry = block("DND_5E", { cr: "1/2", stats: { str: 16, dex: 8, con: 12, int: 10, wis: 10, cha: 10 }, savingThrows: "Con +3", proficiencyBonus: "+2", actions: ["Claw: An existing string ability."] });
  const output = text(entry);
  assert.match(output, /2014/);
  assert.match(output, /CR 1\/2/);
  assert.match(output, /16 \(\+3\)/);
  assert.match(output, /8 \(-1\)/);
  assert.match(output, /Claw: An existing string ability/);
  assert.doesNotMatch(output, /Fortitude|Remaster/);
});

test("spells and items render their own fields without creature defaults", () => {
  const spell = text(block("PF_2E", { rank: 1, traditions: "Primal", heightened: "+1: more damage", description: "A homebrew flare." }, "SPELL"));
  assert.match(spell, /Spell 1/); assert.match(spell, /Heightened/); assert.doesNotMatch(spell, /Armor Class|Hit Points|Challenge rating/);
  const item = text(block("DND_5E", { rarity: "Rare", attunement: "Required by a wizard", description: "A silver compass." }, "ITEM"));
  assert.match(item, /Attunement/); assert.match(item, /silver compass/); assert.doesNotMatch(item, /Armor Class|Hit Points|Level/);
  assert.equal(blockRating(block("DND_5E", { spellLevel: 0 }, "SPELL")), "Level 0");
});

test("legacy entries preserve extra fields and do not reinterpret PF ability scores as modifiers", () => {
  const original = { stats: { str: 18 }, cr: "2", spells: ["Existing spell"], customEncounterHook: "Keep this", traits: [{ name: "Ward", desc: "Retained ability" }] };
  assert.deepEqual(parseBlockStats(JSON.stringify(original)), original);
  const output = text(block("PF_2E", original));
  assert.match(output, /Legacy ability scores are preserved/);
  assert.doesNotMatch(output, /str \+18|CR 2/);
  assert.match(output, /Retained ability/);
});

test("article prompts distinguish ancestry/rank from race/components and retain base lore", () => {
  const pfNpc = getArticleTemplate("CHARACTER", "PF_2E").fields;
  assert(pfNpc.some(field => field.label === "Ancestry"));
  assert(pfNpc.some(field => field.label === "Heritage"));
  assert(!pfNpc.some(field => field.key === "alignment"));
  assert(getArticleTemplate("CHARACTER", "DND_5E").fields.some(field => field.label === "Race (2014)"));
  assert(getArticleTemplate("SPELL", "PF_2E").fields.some(field => field.label === "Spell rank"));
  assert(!getArticleTemplate("SPELL", "PF_2E").fields.some(field => field.label.includes("V, S, M")));
  assert(getArticleTemplate("ITEM", "DND_5E").fields.some(field => field.key === "attunement"));
});

test("write validation rejects unsupported systems and malformed stats while allowing partial name edits", () => {
  const input = { worldId: "world", name: "Sentinel", system: "PF_2E", category: "MONSTER", stats: {} };
  assert.equal(validateBlockInput(input), null);
  assert.equal(validateBlockInput({ name: "Renamed" }, true), null);
  assert(validateBlockInput({ ...input, system: "DND_5E_2024" }));
  assert(validateBlockInput({ ...input, stats: [] }));
  assert(validateBlockInput({ ...input, name: " " }));
  assert(validateBlockInput(null));
});

test("statblock icons follow the stored edition and preserve action labels and unknown costs", () => {
  const pf = renderToStaticMarkup(<StatblockCard block={block("PF_2E", { actions: ["Legacy action text", ...["1", "2", "3", "free", "reaction", "passive", "10 minutes"].map(cost => ({ name: `Ability ${cost}`, cost, desc: "Effect" }))] })} />);
  assert.match(pf, /data-rules-icon="pathfinder-wayfinder"/);
  assert.doesNotMatch(pf, /data-rules-icon="dnd-dragon"|data-action-icon="dnd-/);
  for (const cost of ["1", "2", "3", "free", "reaction", "passive"]) assert(pf.includes(`data-action-icon="pf-${cost}"`));
  for (const label of ["1 action", "2 actions", "3 actions", "Free action", "Reaction", "Legacy action text", "10 minutes"]) assert(pf.includes(label));
  assert(!pf.includes('data-action-icon="pf-10 minutes"'));
  const dnd = renderToStaticMarkup(<StatblockCard block={block("DND_5E", { actions: ["action", "bonus", "reaction", "legendary", "passive"].map(cost => ({ name: "Ability", cost })) })} />);
  assert.match(dnd, /data-rules-icon="dnd-dragon"/);
  assert.doesNotMatch(dnd, /data-action-icon="pf-/);
  for (const cost of ["action", "bonus", "reaction", "legendary", "passive"]) assert(dnd.includes(`data-action-icon="dnd-${cost}"`));
  const custom = renderToStaticMarkup(<StatblockCard block={block("CUSTOM", { actions: [{ name: "Ability", cost: "2" }] })} />);
  assert(!custom.includes("data-rules-icon=")); assert(!custom.includes("data-action-icon="));
});
