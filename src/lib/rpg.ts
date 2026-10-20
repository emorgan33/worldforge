import { pathfinderFields } from "./pf2-statblocks";
export const RPG_SYSTEMS = [
  { id: "PF_2E", label: "Pathfinder 2e", edition: "Remaster", short: "PF2e", gm: "GM" },
  { id: "DND_5E", label: "Dungeons & Dragons 5e", edition: "2014 rules", short: "D&D 5e · 2014", gm: "DM" },
  { id: "COC", label: "Call of Cthulhu", edition: "", short: "Call of Cthulhu", gm: "Keeper" },
  { id: "FATE", label: "Fate", edition: "", short: "Fate", gm: "GM" },
  { id: "CUSTOM", label: "Custom system", edition: "", short: "Custom", gm: "GM" },
] as const;
export type RpgSystem = typeof RPG_SYSTEMS[number]["id"];
export const BLOCK_CATEGORIES = ["MONSTER", "NPC", "SPELL", "ITEM", "CLASS", "HAZARD", "FEAT"] as const;
export type BlockCategory = typeof BLOCK_CATEGORIES[number];
export const CATEGORY_LABELS: Record<BlockCategory, string> = { MONSTER: "Creature", NPC: "NPC", SPELL: "Spell", ITEM: "Magic item", CLASS: "Class", HAZARD: "Hazard", FEAT: "Feat" };
export const ATTRIBUTES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type BlockStats = Record<string, unknown>;
export interface RpgBlockItem { id: string; worldId: string; system: string; category: string; name: string; statsJson: string }
export interface BlockInput { id?: string; worldId: string; system: string; category: string; name: string; stats: BlockStats }
export interface StatField { key: string; label: string; placeholder?: string; multiline?: boolean; group?: string }

export function systemProfile(system: string) {
  return RPG_SYSTEMS.find(profile => profile.id === system) ?? RPG_SYSTEMS[4];
}
export function isDnd(system: string) { return system === "DND_5E"; }
export function parseBlockStats(json: string): BlockStats {
  try { const value = JSON.parse(json); return value && typeof value === "object" && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
export function statText(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : ""; }
export function signed(value: number) { return value >= 0 ? `+${value}` : String(value); }
export function actionCostLabel(system: string, value: unknown) {
  const cost = statText(value);
  if (system === "PF_2E" && /^[123]$/.test(cost)) return `${cost} ${cost === "1" ? "action" : "actions"}`;
  return ({ action: "Action", bonus: "Bonus action", reaction: "Reaction", legendary: "Legendary action", free: "Free action", passive: "Passive" } as Record<string, string>)[cost] ?? cost;
}
export function blockRating(block: Pick<RpgBlockItem, "system" | "category" | "statsJson">) {
  const stats = parseBlockStats(block.statsJson);
  if (block.category === "SPELL") return block.system === "PF_2E" ? `Rank ${statText(stats.rank) || "—"}` : `Level ${statText(stats.spellLevel) || "—"}`;
  if (block.system === "PF_2E") return `Level ${statText(stats.level) || "—"}`;
  if (isDnd(block.system) && ["MONSTER", "NPC"].includes(block.category)) return `CR ${statText(stats.cr) || "—"}`;
  return CATEGORY_LABELS[block.category as BlockCategory] ?? block.category;
}

export function blockFields(system: string, category: string): StatField[] {
  if (system === "PF_2E") return pathfinderFields(category);
  const pf = system === "PF_2E";
  const creature = category === "MONSTER" || category === "NPC";
  if (creature) return [
    ...(pf ? [{ key: "level", label: "Creature level", placeholder: "e.g. 3" }, { key: "rarity", label: "Rarity", placeholder: "Common, uncommon, rare or unique" }, { key: "traitsText", label: "Creature traits", placeholder: "Humanoid, elf, scout" }] : [{ key: "cr", label: "Challenge rating (CR)", placeholder: "e.g. 1/2, 3, 10" }, { key: "creatureType", label: "Creature type", placeholder: "Humanoid, dragon, undead…" }, { key: "alignment", label: "Alignment", placeholder: "Unaligned, neutral good…" }]),
    { key: "size", label: "Size", placeholder: "Medium" },
    { key: "ac", label: "Armor Class" }, { key: "hp", label: "Hit Points", placeholder: pf ? "45" : "45 (6d8 + 18)" }, { key: "speed", label: "Speed", placeholder: "25 ft., climb 15 ft." },
    ...(pf ? [{ key: "perception", label: "Perception", placeholder: "+9; darkvision" }, { key: "fortitude", label: "Fortitude", placeholder: "+10" }, { key: "reflex", label: "Reflex", placeholder: "+8" }, { key: "will", label: "Will", placeholder: "+7" }] : [{ key: "savingThrows", label: "Saving throws", placeholder: "Dex +5, Wis +3" }, { key: "proficiencyBonus", label: "Proficiency Bonus", placeholder: "+2" }, { key: "initiative", label: "Initiative", placeholder: "+3" }, { key: "senses", label: "Senses", placeholder: "Darkvision 60 ft., Passive Perception 13" }]),
    { key: "skills", label: "Skills" }, { key: "languages", label: "Languages" },
    { key: "resistances", label: "Resistances" }, { key: "damageImmunities", label: "Immunities" },
    ...(pf ? [{ key: "weaknesses", label: "Weaknesses" }] : [{ key: "vulnerabilities", label: "Vulnerabilities" }]),
  ];
  if (category === "SPELL") return [
    { key: pf ? "rank" : "spellLevel", label: pf ? "Spell rank" : "Spell level", placeholder: pf ? "1–10; note cantrips in traits" : "0 for a cantrip, otherwise 1–9" },
    ...(pf ? [{ key: "traditions", label: "Traditions", placeholder: "Arcane, divine, occult, primal" }, { key: "traitsText", label: "Traits", placeholder: "Cantrip, concentrate, fire…" }, { key: "cast", label: "Cast / actions", placeholder: "2 actions" }] : [{ key: "school", label: "School", placeholder: "Evocation" }, { key: "castingTime", label: "Casting time", placeholder: "1 action" }, { key: "components", label: "Components", placeholder: "V, S, M (describe materials)" }]),
    { key: "range", label: "Range" }, { key: "targets", label: "Targets / area" }, { key: "duration", label: "Duration" },
    { key: "save", label: pf ? "Defense / saving throw" : "Saving throw / attack" },
    { key: "description", label: "Spell effect", multiline: true },
    { key: pf ? "heightened" : "higherLevels", label: pf ? "Heightened" : "At higher levels", multiline: true },
  ];
  if (category === "ITEM") return [
    ...(pf ? [{ key: "level", label: "Item level" }, { key: "traitsText", label: "Traits", placeholder: "Magical, invested…" }] : [{ key: "itemType", label: "Item type", placeholder: "Wondrous item, weapon…" }]),
    { key: "rarity", label: "Rarity", placeholder: pf ? "Common, uncommon, rare or unique" : "Common through legendary; artifact" },
    { key: "price", label: "Price", placeholder: "25 gp" },
    ...(pf ? [{ key: "bulk", label: "Bulk", placeholder: "L, 1…" }, { key: "usage", label: "Usage", placeholder: "Worn gloves; held in 1 hand" }, { key: "activation", label: "Activation / actions", placeholder: "1 action; command" }] : [{ key: "attunement", label: "Attunement", placeholder: "Not required / required by a spellcaster" }, { key: "charges", label: "Charges / recharge" }]),
    { key: "description", label: "Properties and effect", multiline: true },
  ];
  return [{ key: "description", label: "Class features and notes", multiline: true }];
}

// These are homebrew starting points, not published creatures or balance recommendations.
export function starterStats(system: string, category: string): BlockStats {
  if (!["MONSTER", "NPC"].includes(category)) return {};
  if (system === "PF_2E") return { level: "1", rarity: "Common", size: "Medium", ac: "16", hp: "20", speed: "25 ft.", perception: "+7", fortitude: "+7", reflex: "+5", will: "+4", attributes: { str: 2, dex: 1, con: 2, int: 0, wis: 1, cha: 0 }, actions: [{ name: "Strike", cost: "1", desc: "Add attack modifier, reach, damage and traits." }] };
  if (isDnd(system)) return { cr: "1", size: "Medium", ac: "13", hp: "22 (4d8 + 4)", speed: "30 ft.", proficiencyBonus: "+2", stats: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 }, actions: [{ name: "Weapon attack", cost: "action", desc: "Add attack bonus, reach or range, target and damage." }] };
  return {};
}

export function validateBlockInput(body: unknown, partial = false): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Expected a statblock object";
  const value = body as Record<string, unknown>;
  if ((!partial || value.name !== undefined) && (typeof value.name !== "string" || !value.name.trim() || value.name.length > 200)) return "A name of up to 200 characters is required";
  if ((!partial || value.system !== undefined) && !RPG_SYSTEMS.some(system => system.id === value.system)) return "Choose a supported rules system";
  if ((!partial || value.category !== undefined) && !BLOCK_CATEGORIES.some(category => category === value.category)) return "Choose a statblock category";
  if ((!partial || value.stats !== undefined) && (!value.stats || typeof value.stats !== "object" || Array.isArray(value.stats))) return "Stats must be a JSON object";
  if (value.system !== undefined && value.system !== "PF_2E" && ["HAZARD", "FEAT"].includes(String(value.category))) return "Hazards and feats require Pathfinder 2e Remaster";
  if (!partial && (typeof value.worldId !== "string" || !value.worldId)) return "A world is required";
  return null;
}
