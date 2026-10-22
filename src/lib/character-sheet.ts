import type { ArticleTemplateMeta } from "@/types";

export type CharacterSystem = "DND_5E" | "PF_2E";
export type SheetField = Omit<ArticleTemplateMeta["fields"][number], "type"> & {
  type: "text" | "number" | "textarea" | "select" | "checkbox";
};
export interface SheetSection { name: string; fields: SheetField[] }
export interface SheetRowSection { key: string; name: string; singular: string; columns: SheetField[] }
export interface CharacterRow { id: string; [key: string]: string }
export interface CharacterRows { version: 1; sections: Record<string, CharacterRow[]> }

export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
const abilityNames = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
const dndSkills = ["Acrobatics", "Animal Handling", "Arcana", "Athletics", "Deception", "History", "Insight", "Intimidation", "Investigation", "Medicine", "Nature", "Perception", "Performance", "Persuasion", "Religion", "Sleight of Hand", "Stealth", "Survival"];
const pfSkills = ["Acrobatics", "Arcana", "Athletics", "Crafting", "Deception", "Diplomacy", "Intimidation", "Medicine", "Nature", "Occultism", "Performance", "Religion", "Society", "Stealth", "Survival", "Thievery"];
export const TRAINING = ["Untrained", "Trained", "Expert", "Master", "Legendary"];

export function isCharacterSystem(system: string): system is CharacterSystem {
  return system === "DND_5E" || system === "PF_2E";
}
export function characterRowsKey(system: CharacterSystem) {
  return system === "PF_2E" ? "pf2eCharacterRows" : "dnd5eCharacterRows";
}
export function isCharacterRowsKey(key: string) {
  return key === "pf2eCharacterRows" || key === "dnd5eCharacterRows";
}

export function dndAbilityModifier(score: unknown): string {
  if (typeof score !== "string" || !score.trim()) return "—";
  const value = Number(score);
  if (!Number.isInteger(value) || value < 1 || value > 30) return "—";
  const modifier = Math.floor((value - 10) / 2);
  return modifier < 0 ? String(modifier) : `+${modifier}`;
}

function definition(system: CharacterSystem) {
  const pf = system === "PF_2E";
  const prefix = pf ? "pf2e" : "dnd5e";
  const text = (key: string, label: string): SheetField => ({ key: `${prefix}${key}`, label, type: "text" });
  const number = (key: string, label: string, min?: number, max?: number): SheetField => ({ ...text(key, label), type: "number", min, max, step: 1 });
  const notes = (key: string, label: string): SheetField => ({ ...text(key, label), type: "textarea" });
  const choice = (key: string, label: string, options: string[]): SheetField => ({ ...text(key, label), type: "select", options });
  const common = (key: string, label: string): SheetField => ({ key, label, type: "text" });
  const skills = pf ? pfSkills : dndSkills;
  const training = (key: string, label: string) => choice(`${key}Training`, `${label} ${pf ? "training" : "proficiency"}`, pf ? TRAINING : ["Not proficient", "Proficient", "Expertise"]);
  const saves = pf ? ["Fortitude", "Reflex", "Will"] : [...ABILITIES];
  const sections: SheetSection[] = [
    { name: "Identity", fields: [
      text("PlayerName", "Player name"), text("Class", pf ? "Class" : "Class & subclass"), number("CharacterLevel", "Character level", 1, 20),
      common("species", pf ? "Ancestry" : "Race (2014)"), ...(pf ? [text("Heritage", "Heritage")] : [common("alignment", "Alignment")]),
      text("Background", "Background"), number("Experience", "Experience points", 0), text("Size", "Size"),
    ] },
    { name: pf ? "Attribute modifiers" : "Ability scores", fields: ABILITIES.map((key, i) => number(key, `${abilityNames[i]} ${pf ? "modifier" : "score"}`, pf ? undefined : 1, pf ? undefined : 30)) },
    { name: "Defenses & movement", fields: [
      number("Ac", "Armor Class", 0), text("Initiative", "Initiative"), text("Speed", "Speed"),
      ...(pf ? [text("ClassDc", "Class DC"), training("Armor", "Armor"), text("Shield", "Shield · AC / Hardness / HP")]
        : [text("Proficiency", "Proficiency bonus"), text("PassivePerception", "Passive Perception"), { ...text("Inspiration", "Inspiration"), type: "checkbox" as const }]),
    ] },
    { name: "Hit points & resources", fields: [
      number("Hp", "Maximum HP", 0), number("CurrentHp", "Current HP", 0), number("TemporaryHp", "Temporary HP", 0),
      ...(pf ? [number("HeroPoints", "Hero Points", 0, 3), number("Dying", "Dying", 0), number("Wounded", "Wounded", 0)]
        : [text("HitDice", "Hit Dice · current / total"), number("DeathSuccesses", "Death save successes", 0, 3), number("DeathFailures", "Death save failures", 0, 3)]),
      text("Conditions", "Conditions"), text("Resistances", "Resistances & immunities"),
    ] },
    { name: "Saving throws", fields: saves.flatMap(save => [text(pf ? save : `${save}Save`, `${save} save total`),
      pf ? training(save, save) : { ...text(`${save}SaveProficient`, `${save} save proficient`), type: "checkbox" as const }]) },
    { name: "Skills", fields: [
      ...(pf ? [text("Perception", "Perception total"), training("Perception", "Perception")] : []),
      ...skills.flatMap(skill => { const key = `Skill${skill.replaceAll(" ", "")}`; return [text(key, `${skill} total`), training(key, skill)]; }),
    ] },
    { name: "Spellcasting", fields: [
      text("SpellcastingClass", "Spellcasting class"), text("SpellcastingAbility", pf ? "Spellcasting attribute" : "Spellcasting ability"), text("SpellDc", "Spell save DC"), text("SpellAttack", "Spell attack modifier"),
      ...(pf ? [choice("Tradition", "Tradition", ["Arcane", "Divine", "Occult", "Primal"]), training("Spellcasting", "Spellcasting"), number("FocusPoints", "Current Focus Points", 0, 3), number("MaxFocusPoints", "Maximum Focus Points", 0, 3)] : []),
    ] },
    { name: "Spell slots", fields: Array.from({ length: pf ? 10 : 9 }, (_, i) => i + 1).flatMap(rank => [
      number(`Slots${rank}Max`, `${pf ? "Rank" : "Level"} ${rank} slots total`, 0), number(`Slots${rank}Remaining`, `${pf ? "Rank" : "Level"} ${rank} slots remaining`, 0),
    ]) },
    { name: "Equipment notes", fields: [text("Languages", "Languages"), notes("Proficiencies", pf ? "Weapons, armor & other training" : "Armor, weapons & tool proficiencies"), text("Currency", pf ? "Coins · cp / sp / gp / pp" : "Coins · cp / sp / ep / gp / pp"), text("Carrying", pf ? "Bulk & carrying limits" : "Carried weight & capacity")] },
    { name: "Personality & appearance", fields: [
      common("age", "Age"), common("gender", "Gender & pronouns"), common("titles", "Titles & honors"), common("affiliations", "Affiliations"),
      notes("Appearance", "Appearance"), ...(pf ? [notes("Edicts", "Edicts & anathema")] : [notes("PersonalityTraits", "Personality traits"), notes("Bond", "Ideal, bond & flaw")]),
    ] },
  ];
  const col = (key: string, label: string, type: SheetField["type"] = "text"): SheetField => ({ key, label, type });
  const rows: SheetRowSection[] = [
    { key: "attacks", name: pf ? "Strikes" : "Attacks", singular: pf ? "strike" : "attack", columns: [col("name", "Name"), col("bonus", "Attack bonus"), col("damage", "Damage & type"), col("notes", pf ? "Traits & actions" : "Range & notes")] },
    { key: "equipment", name: "Equipment", singular: "item", columns: [col("name", "Item"), col("quantity", "Quantity"), col("weight", pf ? "Bulk" : "Weight"), col("carried", pf ? "Worn / held / stowed" : "Equipped / attuned"), col("notes", "Notes")] },
    { key: "features", name: pf ? "Feats & abilities" : "Features & traits", singular: pf ? "feat or ability" : "feature", columns: [col("name", "Name"), col("source", pf ? "Type / level" : "Source"), col("notes", "Description", "textarea")] },
    { key: "spells", name: "Spells", singular: "spell", columns: [col("name", "Spell"), col("level", pf ? "Rank / cantrip" : "Level / cantrip"), col("prepared", "Prepared", "checkbox"), col("casting", pf ? "Actions / tradition" : "Casting time / components"), col("notes", "Range, duration & effect", "textarea")] },
    { key: "resources", name: "Other resources", singular: "resource", columns: [col("name", "Resource"), col("current", "Current"), col("maximum", "Maximum"), col("reset", "Recovery / notes")] },
    ...(pf ? [{ key: "lore", name: "Lore skills", singular: "Lore skill", columns: [col("name", "Lore"), col("total", "Total"), { ...col("training", "Training", "select"), options: TRAINING }] }] : []),
  ];
  return { system, prefix, sections, rows };
}
const definitions = { DND_5E: definition("DND_5E"), PF_2E: definition("PF_2E") };
export function characterSheetDefinition(system: CharacterSystem) { return definitions[system]; }
export function characterSheetFields(system: CharacterSystem) {
  return definitions[system].sections.flatMap(section => section.fields.map(field => ({ ...field, group: section.name })));
}

/** Empty sheets are a presentation default. Never rewrite metadata on opening an article. */
export function readCharacterRows(raw: unknown): { data: CharacterRows; error?: string } {
  const empty: CharacterRows = { version: 1, sections: {} };
  if (raw === undefined || raw === "") return { data: empty };
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : null;
    if (!value || value.version !== 1 || !value.sections || typeof value.sections !== "object" || Array.isArray(value.sections)) throw new Error();
    for (const rows of Object.values(value.sections)) {
      if (!Array.isArray(rows)) throw new Error();
      const ids = new Set<string>();
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || !row.id || ids.has(row.id) || Object.values(row).some(cell => typeof cell !== "string")) throw new Error();
        ids.add(row.id);
      }
    }
    return { data: value };
  } catch {
    return { data: empty, error: "Saved sheet rows use an unreadable or unsupported format. They have been preserved. Restore a working article revision to edit these rows." };
  }
}

export function updateCharacterRows(data: CharacterRows, section: string, rows: CharacterRow[]): string {
  return JSON.stringify({ ...data, sections: { ...data.sections, [section]: rows } });
}

/** Only known sheet columns reach a reader. Other profiles and unknown extension data stay private. */
export function readerCharacterRows(system: string, metadata: Record<string, unknown>): Record<string, string> {
  if (!isCharacterSystem(system)) return {};
  const key = characterRowsKey(system);
  if (!metadata[key]) return {};
  const { data, error } = readCharacterRows(metadata[key]);
  if (error) return {};
  const sections = Object.fromEntries(definitions[system].rows.map(section => [section.key, (data.sections[section.key] || []).map(row => Object.fromEntries([[
    "id", row.id,
  ], ...section.columns.filter(column => typeof row[column.key] === "string").map(column => [column.key, row[column.key]])]))]));
  return { [key]: JSON.stringify({ version: 1, sections }) };
}

export function validateCharacterRows(metadata: unknown, previous: Record<string, unknown> = {}): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  for (const key of ["dnd5eCharacterRows", "pf2eCharacterRows"]) {
    const value = (metadata as Record<string, unknown>)[key];
    if (value === previous[key]) continue;
    const { error } = readCharacterRows(value);
    if (error) return error;
  }
  return null;
}
