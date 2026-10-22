import { ArticleTemplateMeta, ArticleTemplateType } from "@/types";
import { characterSheetFields } from "./character-sheet";

export const ARTICLE_TEMPLATES: Record<ArticleTemplateType, ArticleTemplateMeta> = {
  CHARACTER: {
    type: "CHARACTER",
    label: "Character",
    category: "Entities",
    iconName: "User",
    description: "An individual NPC, player character, deity, or historical figure.",
    fields: [
      { key: "species", label: "Species / Ancestry", type: "text", placeholder: "e.g. High Elf, Human" },
      { key: "age", label: "Age", type: "text", placeholder: "e.g. 120 years" },
      { key: "gender", label: "Gender & Pronouns", type: "text", placeholder: "e.g. Non-binary (they/them)" },
      { key: "alignment", label: "Moral Alignment", type: "text", placeholder: "e.g. Chaotic Good" },
      { key: "titles", label: "Titles & Honors", type: "text", placeholder: "e.g. Grand Magister, Knight Commander" },
      { key: "affiliations", label: "Primary Affiliations", type: "text", placeholder: "e.g. Order of the Silver Dawn" },
    ],
  },
  CREATURE: {
    type: "CREATURE", label: "Creature", category: "Entities", iconName: "Skull",
    description: "A bestiary entry with defenses, abilities, tactics and ecology.",
    starterSections: ["Appearance & signs", "Habitat & behavior", "Abilities & tactics", "Adventure hooks"],
    fields: [{ key: "habitat", label: "Habitat", type: "text", group: "Ecology" }, { key: "behavior", label: "Behavior", type: "textarea", group: "Ecology" }],
  },
  ENCOUNTER: {
    type: "ENCOUNTER", label: "Encounter", category: "Campaign", iconName: "Swords",
    description: "Session-ready opposition, objectives, terrain, stakes and rewards.",
    starterSections: ["Scene & read-aloud", "Objectives & stakes", "Opposition & tactics", "Terrain & hazards", "Outcomes & rewards"],
    fields: [{ key: "location", label: "Location", type: "text", group: "Scene" }, { key: "objectives", label: "Objectives", type: "textarea", group: "Scene" }, { key: "opposition", label: "Opposition & reinforcements", type: "textarea", group: "Opposition" }, { key: "terrain", label: "Terrain & hazards", type: "textarea", group: "Scene" }, { key: "treasure", label: "Treasure & rewards", type: "textarea", group: "Outcomes" }, { key: "aftermath", label: "Aftermath & consequences", type: "textarea", group: "Outcomes" }],
  },
  SETTLEMENT: {
    type: "SETTLEMENT",
    label: "Settlement",
    category: "Places",
    iconName: "Building2",
    description: "An inhabited city, town, village, space station, or nomadic encampment.",
    fields: [
      { key: "settlementType", label: "Settlement Type", type: "select", options: ["Metropolis", "City", "Town", "Village", "Hamlet", "Citadel", "Nomad Camp"] },
      { key: "population", label: "Demographics / Population", type: "text", placeholder: "e.g. 85,000" },
      { key: "government", label: "Government Style", type: "text", placeholder: "e.g. Magocratic Oligarchy" },
      { key: "ruler", label: "Current Ruler / Leader", type: "text", placeholder: "e.g. High Chancellor" },
      { key: "defense", label: "Defenses & Walls", type: "text", placeholder: "e.g. Prismatic Aegis Ward" },
    ],
  },
  BUILDING: {
    type: "BUILDING",
    label: "Building",
    category: "Places",
    iconName: "Home",
    description: "A specific architecture, tavern, temple, dungeon, or estate.",
    fields: [
      { key: "architect", label: "Architect / Builder", type: "text" },
      { key: "purpose", label: "Primary Function", type: "text", placeholder: "e.g. Arcane Library, Fortress" },
      { key: "condition", label: "Structural Condition", type: "select", options: ["Pristine", "Occupied", "Dilapidated", "Ruined", "Submerged"] },
    ],
  },
  LANDMARK: {
    type: "LANDMARK",
    label: "Landmark",
    category: "Places",
    iconName: "MapPin",
    description: "A distinctive monument, obelisk, statue, or ancient ruin.",
    fields: [
      { key: "age", label: "Era of Creation", type: "text" },
      { key: "significance", label: "Cultural Significance", type: "text" },
    ],
  },
  GEOGRAPHY: {
    type: "GEOGRAPHY",
    label: "Geography & Region",
    category: "Places",
    iconName: "Compass",
    description: "Natural terrain, oceans, mountain ranges, forests, or whole continents.",
    fields: [
      { key: "biome", label: "Biome & Climate", type: "text", placeholder: "e.g. Arctic Tundra, Astral Void" },
      { key: "resources", label: "Natural Resources", type: "text", placeholder: "e.g. Silver, Aether Ore" },
      { key: "hazards", label: "Environmental Hazards", type: "text", placeholder: "e.g. Leyline Flares" },
    ],
  },
  ORGANIZATION: {
    type: "ORGANIZATION",
    label: "Organization & Guild",
    category: "Groups",
    iconName: "Shield",
    description: "Factions, guilds, knightly orders, political syndicates, or noble houses.",
    fields: [
      { key: "founded", label: "Founding Date / Era", type: "text" },
      { key: "leader", label: "Current Leader", type: "text" },
      { key: "headquarters", label: "Headquarters", type: "text" },
      { key: "motto", label: "Motto / Creed", type: "text" },
      { key: "symbol", label: "Insignia & Colors", type: "text" },
    ],
  },
  MILITARY: {
    type: "MILITARY",
    label: "Military Formation",
    category: "Groups",
    iconName: "Swords",
    description: "Armies, legions, fleets, mercenary companies, or special forces.",
    fields: [
      { key: "commander", label: "Commander", type: "text" },
      { key: "strength", label: "Troop Strength", type: "text" },
      { key: "specialty", label: "Tactical Specialty", type: "text" },
    ],
  },
  SPECIES: {
    type: "SPECIES",
    label: "Species & Creatures",
    category: "Entities",
    iconName: "Dna",
    description: "Biological or magical species, monstrous beasts, and races.",
    fields: [
      { key: "classification", label: "Biological Classification", type: "text" },
      { key: "lifespan", label: "Average Lifespan", type: "text" },
      { key: "habitat", label: "Native Habitat", type: "text" },
      { key: "diet", label: "Diet & Sustenance", type: "text" },
      { key: "danger", label: "Threat Rating", type: "select", options: ["Harmless", "Docile", "Dangerous", "Lethal", "Cataclysmic"] },
    ],
  },
  ETHNICITY: {
    type: "ETHNICITY",
    label: "Ethnicity & Culture",
    category: "Lore & Culture",
    iconName: "Users",
    description: "Cultural subgroup, traditions, dialect, and social values.",
    fields: [
      { key: "homeland", label: "Ancestral Homeland", type: "text" },
      { key: "language", label: "Primary Language", type: "text" },
      { key: "values", label: "Core Cultural Ideals", type: "text" },
    ],
  },
  ITEM: {
    type: "ITEM",
    label: "Item & Artifact",
    category: "Entities",
    iconName: "Sparkles",
    description: "Magical relics, unique weapons, legendary tomes, or cursed objects.",
    fields: [
      { key: "rarity", label: "Rarity", type: "select", options: ["Common", "Uncommon", "Rare", "Very Rare", "Legendary", "Artifact"] },
      { key: "creator", label: "Creator / Crafter", type: "text" },
      { key: "attunement", label: "Requires Attunement?", type: "select", options: ["Yes", "No", "Special Condition"] },
      { key: "powers", label: "Primary Powers", type: "textarea" },
    ],
  },
  VEHICLE: {
    type: "VEHICLE",
    label: "Vehicle & Vessel",
    category: "Entities",
    iconName: "Ship",
    description: "Skyships, naval vessels, dimensional barges, or mechanical mounts.",
    fields: [
      { key: "propulsion", label: "Propulsion System", type: "text", placeholder: "e.g. Elemental Engine" },
      { key: "crew", label: "Crew Capacity", type: "text" },
      { key: "armament", label: "Armament & Turrets", type: "text" },
    ],
  },
  TECHNOLOGY: {
    type: "TECHNOLOGY",
    label: "Technology & Magitech",
    category: "Rules & Systems",
    iconName: "Cpu",
    description: "Scientific discoveries, arcane engineering, or mechanical inventions.",
    fields: [
      { key: "inventor", label: "Inventor", type: "text" },
      { key: "fuel", label: "Energy Source", type: "text" },
    ],
  },
  MATERIAL: {
    type: "MATERIAL",
    label: "Material & Mineral",
    category: "Rules & Systems",
    iconName: "Boxes",
    description: "Alchemical substances, mithril ores, strange flora, or alloys.",
    fields: [
      { key: "hardness", label: "Hardness & Durability", type: "text" },
      { key: "magicalProperties", label: "Arcane Resonance", type: "text" },
    ],
  },
  CONDITION: {
    type: "CONDITION",
    label: "Condition & Affliction",
    category: "Rules & Systems",
    iconName: "Activity",
    description: "Magical curses, void rot, diseases, lycanthropy, or mutations.",
    fields: [
      { key: "vector", label: "Transmission Vector", type: "text" },
      { key: "cure", label: "Known Cure or Ward", type: "text" },
    ],
  },
  DOCUMENT: {
    type: "DOCUMENT",
    label: "Document & Tome",
    category: "Lore & Culture",
    iconName: "Scroll",
    description: "Historical treaties, holy scriptures, ancient letters, or diaries.",
    fields: [
      { key: "author", label: "Author", type: "text" },
      { key: "dateWritten", label: "Date Written", type: "text" },
    ],
  },
  LAW: {
    type: "LAW",
    label: "Law & Edict",
    category: "Rules & Systems",
    iconName: "Scale",
    description: "Imperial decrees, legal codices, and divine commandments.",
    fields: [
      { key: "jurisdiction", label: "Jurisdiction", type: "text" },
      { key: "punishment", label: "Prescribed Penalty", type: "text" },
    ],
  },
  LANGUAGE: {
    type: "LANGUAGE",
    label: "Language & Script",
    category: "Lore & Culture",
    iconName: "Languages",
    description: "Spoken tongues, runic alphabets, cipher codes, and dialects.",
    fields: [
      { key: "script", label: "Writing Script", type: "text" },
      { key: "family", label: "Language Family", type: "text" },
    ],
  },
  TRADITION: {
    type: "TRADITION",
    label: "Tradition & Custom",
    category: "Lore & Culture",
    iconName: "Calendar",
    description: "Festivals, holidays, coming-of-age rites, and cultural taboos.",
    fields: [
      { key: "frequency", label: "Frequency / Season", type: "text" },
      { key: "celebrants", label: "Practicing Peoples", type: "text" },
    ],
  },
  RITUAL: {
    type: "RITUAL",
    label: "Ritual & Ceremony",
    category: "Lore & Culture",
    iconName: "Flame",
    description: "Complex ceremonial incantations, coronation rites, and summonings.",
    fields: [
      { key: "components", label: "Required Components", type: "text" },
      { key: "duration", label: "Casting Duration", type: "text" },
    ],
  },
  MYTH: {
    type: "MYTH",
    label: "Myth & Legend",
    category: "Lore & Culture",
    iconName: "BookOpen",
    description: "Folklore tales, creation myths, constellation fables, and prophecies.",
    fields: [
      { key: "culture", label: "Originating Culture", type: "text" },
      { key: "truthValue", label: "Historical Veracity", type: "select", options: ["Pure Allegory", "Distorted Memory", "Literal Truth", "Divine Prophecy"] },
    ],
  },
  SPELL: {
    type: "SPELL",
    label: "Spell & Incantation",
    category: "Rules & Systems",
    iconName: "Wand2",
    description: "Arcane formulae, divine blessings, psionic disciplines, and hexes.",
    fields: [
      { key: "level", label: "Spell Level", type: "text", placeholder: "e.g. 5th level evocation" },
      { key: "components", label: "Components (V, S, M)", type: "text" },
      { key: "castingTime", label: "Casting Time", type: "text" },
    ],
  },
  PLOT: {
    type: "PLOT",
    label: "Plot & Adventure Arc",
    category: "Campaign",
    iconName: "GitBranch",
    description: "Campaign questlines, 3-act story outlines, and adventure hooks.",
    fields: [],
  },
  REPORT: {
    type: "REPORT",
    label: "Session Report",
    category: "Campaign",
    iconName: "FileText",
    description: "Session chronicles, player recap, and game master campaign log.",
    fields: [],
  },
  PROSE: {
    type: "PROSE",
    label: "Prose & Fiction",
    category: "Lore & Culture",
    iconName: "Feather",
    description: "Short stories, in-universe poems, vignettes, and novel chapters.",
    fields: [
      { key: "povCharacter", label: "Point-of-View Character", type: "text" },
      { key: "era", label: "Setting Era", type: "text" },
    ],
  },
  GENERIC: {
    type: "GENERIC",
    label: "Generic Article",
    category: "Lore & Culture",
    iconName: "File",
    description: "Open-format worldbuilding article for primers, rules, or unclassified lore.",
    fields: [],
  },
};

type Field = ArticleTemplateMeta["fields"][number];
const field = (key: string, label: string, group: string, placeholder?: string): Field => ({ key, label, group, type: "text", placeholder });
const notes = (key: string, label: string, group: string, placeholder?: string): Field => ({ ...field(key, label, group, placeholder), type: "textarea" });
const number = (key: string, label: string, group: string, min: number, max?: number): Field => ({ ...field(key, label, group), type: "number", min, max, step: 1 });
const select = (key: string, label: string, group: string, options: string[]): Field => ({ ...field(key, label, group), type: "select", options });
const pfRarity = ["Common", "Uncommon", "Rare", "Unique"];
const sizes = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
const outlines: Partial<Record<ArticleTemplateType, string[]>> = {
  CHARACTER: ["Appearance & voice", "Motives & relationships", "Role in the campaign", "Abilities & tactics"],
  SPELL: ["Spell effect", "Limitations & interactions", "Discovery & lore"],
  ITEM: ["Appearance & history", "Properties & activation", "Adventure hooks"],
};

/** Rules fields are optional campaign notes; prose and existing metadata remain intact. */
export function getArticleTemplate(type: ArticleTemplateType, system: string): ArticleTemplateMeta {
  const base = ARTICLE_TEMPLATES[type] ?? ARTICLE_TEMPLATES.GENERIC;
  if (system !== "PF_2E" && system !== "DND_5E") return base;
  const pf = system === "PF_2E";
  const prefix = pf ? "pf2e" : "dnd5e";
  let fields: Field[] = base.fields;
  if (type === "CHARACTER") fields = [
    ...base.fields.filter(item => item.key !== "alignment" || !pf).map(item => ({ ...item, group: "Identity", ...(item.key === "species" ? { label: pf ? "Ancestry" : "Race (2014)", placeholder: "Elf, human, dwarf…" } : {}) })),
    ...(pf ? [field("pf2eHeritage", "Heritage", "Identity"), field("pf2eClass", "Class", "Character"), number("pf2eCharacterLevel", "Character level", "Character", 1, 20), field("pf2eBackground", "Background", "Character"), notes("pf2eEdicts", "Edicts & anathema", "Identity"), field("pf2ePerception", "Perception", "Character"), field("pf2eLanguages", "Languages", "Character")]
      : [field("dnd5eClass", "Class & subclass", "Character"), number("dnd5eCharacterLevel", "Character level", "Character", 1, 20), field("dnd5eNpcCr", "NPC challenge rating (CR)", "Character", "1/2, 1, 5…"), field("dnd5eBackground", "Background", "Character"), notes("dnd5eBond", "Ideal, bond & flaw", "Identity"), field("dnd5eLanguages", "Languages", "Character"), field("dnd5eProficiency", "Proficiency bonus", "Character", "+2")]),
    notes(`${prefix}Roleplay`, "Roleplaying cues", "Campaign"), notes(`${prefix}Goals`, "Goals & relationships", "Campaign"),
  ];
  if (type === "CHARACTER") {
    const sheetFields: Field[] = characterSheetFields(system).map(item => item.type === "checkbox"
      ? { ...item, type: "select", options: ["true", "false"] } : { ...item, type: item.type });
    const keys = new Set(sheetFields.map(item => item.key));
    fields = [...sheetFields, ...fields.filter(item => !keys.has(item.key))];
  }
  if (type === "CREATURE") fields = [
    ...(pf ? [number("pf2eCreatureLevel", "Creature level", "Profile", -1, 25), select("pf2eCreatureRarity", "Rarity", "Profile", pfRarity), field("pf2eCreatureTraits", "Creature traits", "Profile", "Humanoid, elf, scout…"), field("pf2eCreaturePerception", "Perception", "Awareness"), field("pf2eCreatureSenses", "Senses", "Awareness")]
      : [field("dnd5eCr", "Challenge rating (CR)", "Profile", "0, 1/8, 1/4, 1/2, 1…"), field("dnd5eCreatureType", "Creature type", "Profile", "Humanoid, dragon, undead…"), field("dnd5eAlignment", "Alignment", "Profile"), field("dnd5eCreatureSenses", "Senses", "Awareness")]),
    select(`${prefix}Size`, "Size", "Profile", sizes), field(`${prefix}Ac`, "Armor Class", "Defenses"), field(`${prefix}Hp`, "Hit Points", "Defenses", pf ? "45" : "45 (6d8 + 18)"), field(`${prefix}Speed`, "Speed", "Movement"),
    ...(pf ? [field("pf2eFortitude", "Fortitude", "Defenses"), field("pf2eReflex", "Reflex", "Defenses"), field("pf2eWill", "Will", "Defenses"), field("pf2eWeaknesses", "Weaknesses", "Defenses"), field("pf2eResistances", "Resistances & immunities", "Defenses")]
      : [field("dnd5eSavingThrows", "Saving throws", "Defenses"), field("dnd5eResistances", "Damage resistances & immunities", "Defenses"), field("dnd5eConditionImmunities", "Condition immunities", "Defenses")]),
    ...["str", "dex", "con", "int", "wis", "cha"].map(ability => number(`${prefix}${ability.toUpperCase()}`, `${ability.toUpperCase()} ${pf ? "modifier" : "score"}`, pf ? "Attribute modifiers" : "Ability scores", pf ? -10 : 1, pf ? undefined : 30)),
    notes(`${prefix}Abilities`, pf ? "Actions, reactions & free actions" : "Actions, bonus actions & reactions", "Abilities & tactics", pf ? "Include action costs, triggers, attack modifiers and effects." : "Include attack bonuses, damage, recharge and triggers."),
    ...(pf ? [] : [notes("dnd5eLegendaryActions", "Legendary & lair actions", "Abilities & tactics")]),
    notes(`${prefix}Tactics`, "Tactics & morale", "Abilities & tactics"), ...base.fields,
  ];
  if (type === "SPELL") fields = pf ? [
    number("pf2eRank", "Spell rank", "Profile", 1, 10), select("pf2eSpellKind", "Spell kind", "Profile", ["Spell", "Cantrip", "Focus spell"]),
    field("pf2eTraditions", "Traditions", "Profile", "Arcane, divine, occult, primal"), field("pf2eTraits", "Spell traits", "Profile", "Concentrate, manipulate…"),
    field("pf2eCast", "Cast / actions", "Casting", "2 actions; reaction (include trigger)"), field("pf2eRange", "Range", "Targeting"), field("pf2eTargets", "Targets / area", "Targeting"), field("pf2eDuration", "Duration", "Casting"),
    field("pf2eDefense", "Defense / saving throw", "Targeting"), notes("pf2eEffect", "Spell effect", "Effect"), notes("pf2eHeightened", "Heightened", "Effect"),
  ] : [
    number("dnd5eSpellLevel", "Spell level (0 = cantrip)", "Profile", 0, 9), select("dnd5eSchool", "School", "Profile", ["Abjuration", "Conjuration", "Divination", "Enchantment", "Evocation", "Illusion", "Necromancy", "Transmutation"]),
    field("castingTime", "Casting time", "Casting", "1 action; bonus action; reaction (include trigger)"), field("components", "Components (V, S, M)", "Casting"), field("dnd5eMaterials", "Material details & cost", "Casting"),
    select("dnd5eRitual", "Ritual", "Casting", ["Yes", "No"]), select("dnd5eConcentration", "Concentration", "Casting", ["Yes", "No"]),
    field("dnd5eRange", "Range", "Targeting"), field("dnd5eTargets", "Targets / area", "Targeting"), field("dnd5eDuration", "Duration / concentration", "Casting"), field("dnd5eDefense", "Saving throw / attack", "Targeting"), notes("dnd5eEffect", "Spell effect", "Effect"), notes("dnd5eHigherLevels", "At higher levels", "Effect"),
  ];
  if (type === "ITEM") fields = pf ? [
    number("pf2eItemLevel", "Item level", "Profile", 0), select("pf2eRarity", "Rarity", "Profile", pfRarity), field("pf2eTraits", "Item traits", "Profile", "Magical, invested…"),
    field("pf2eUsage", "Usage & Bulk", "Usage", "Worn gloves; Bulk L"), field("pf2eActivation", "Activation / actions", "Usage"), field("pf2eFrequency", "Frequency & requirements", "Usage"), field("pf2ePrice", "Price", "Profile"),
    ...base.fields.filter(item => ["creator", "powers"].includes(item.key)).map(item => ({ ...item, group: "Properties & history" })),
  ] : [
    ...base.fields.map(item => ({ ...item, group: ["rarity", "attunement"].includes(item.key) ? "Profile" : "Properties & history" })),
    field("dnd5eItemType", "Item type", "Profile", "Wondrous item, weapon, armor…"), field("dnd5eAttunement", "Attunement requirements", "Usage"), field("dnd5eCharges", "Charges & recharge", "Usage"), field("dnd5eWeight", "Weight", "Profile"), field("dnd5ePrice", "Price", "Profile"),
  ];
  if (type === "ENCOUNTER") {
    // Structured encounter participants - up to 6 combatants linked to compendium
    const participantFields = Array.from({ length: 6 }, (_, i) => 
      field(`${prefix}Participant${i + 1}`, `${pf ? "Creature" : "Enemy"} ${i + 1}`, "Participants", "Click to link from compendium…")
    );
    fields = [
      number(`${prefix}PartyLevel`, pf ? "Party level" : "Average party level", "Party & difficulty", 1, 20),
      number(`${prefix}PartySize`, "Party size", "Party & difficulty", 1),
      select(pf ? "pf2eThreat" : "dnd5eDifficulty", pf ? "Encounter threat" : "Encounter difficulty (2014)", "Party & difficulty", pf ? ["Trivial", "Low", "Moderate", "Severe", "Extreme"] : ["Easy", "Medium", "Hard", "Deadly"]),
      number(`${prefix}XpBudget`, pf ? "Total XP budget" : "Adjusted encounter XP", "Party & difficulty", 0),
      ...participantFields,
      ...(pf ? [] : [number("dnd5eXpAward", "Unadjusted XP reward", "Outcomes", 0)]),
      field(`${prefix}Conditions`, pf ? "Environmental conditions" : "Environmental effects", "Environment", pf ? "Prone, concealed, difficult terrain…" : "Difficult terrain, dim light, water…"),
      field(`${prefix}TerrainFeatures`, pf ? "Terrain features" : "Notable terrain", "Environment"),
      field(`${prefix}Weather`, pf ? "Weather" : "Weather / time of day", "Environment"),
      field("linkedLocation", "Setting Location", "Session Prep", "Location article ID…"),
      field("linkedPlot", "Part of Plot Arc", "Session Prep", "Plot article ID…"),
      field("linkedSession", "Session Run", "Session Prep", "Session Report article ID…"),
      ...base.fields,
    ];
  }
  if (type === "BUILDING" || type === "PLOT") fields = [...base.fields, field(pf ? "pf2ePartyLevel" : "dnd5ePartyLevel", "Suggested party level", "Adventure"), field(pf ? "pf2eThreat" : "dnd5eDifficulty", pf ? "Encounter threat / XP budget" : "Encounter difficulty / XP", "Adventure"), field("adventureHooks", "Adventure hooks", "Adventure"), field("treasure", "Treasure & rewards", "Adventure")];
  if (type === "REPORT") {
    const reportFields = [
      field("sessionNumber", "Session #", "Session"), field("inGameDate", "In-Game Date", "Session"), field("attendees", "Attending Players", "Session"),
      field("partyLevel", "Party level", "Session"), field("xpAwarded", "XP / advancement", "Session"), field("treasureAwarded", "Treasure awarded", "Session"),
      field("linkedEncounters", "Linked Encounters", "Related Articles", "Encounter article IDs, one per line…"), field("linkedPlots", "Part of Plot Arc", "Related Articles", "Plot article IDs, one per line…"), field("linkedLocations", "Key Locations", "Related Articles", "Location article IDs, one per line…"),
      field("nextSession", "Next session hooks", "Planning"), field("recap", "Session Recap", "Planning", "Brief summary for returning players…"),
    ];
    fields = pf ? [...base.fields, ...reportFields] : [...base.fields, ...reportFields];
  }
  if (type === "PLOT") {
    const plotFields = [
      field("act", "Current Act / Phase", "Story"), field("stakes", "High Stakes", "Story"), field("antagonist", "Primary Antagonist", "Story"),
      field("linkedEncounters", "Key Encounters", "Session Prep", "Encounter article IDs, one per line…"), field("linkedSessions", "Sessions Run", "Session Prep", "Session Report article IDs, one per line…"),
      field("previousPlot", "Previous Arc", "Story"), field("nextPlot", "Next Arc", "Story"),
    ];
    fields = pf ? [...base.fields, ...plotFields] : [...base.fields, ...plotFields];
  }
  return { ...base, fields, starterSections: base.starterSections || outlines[type] };
}

export function templateFieldGroups(template: ArticleTemplateMeta) {
  const groups = new Map<string, Field[]>();
  for (const field of template.fields) {
    const name = field.group || "Details";
    groups.set(name, [...(groups.get(name) || []), field]);
  }
  return [...groups].map(([name, fields]) => ({ name, fields }));
}

export function validateTemplateMetadata(template: ArticleTemplateMeta, metadata: Record<string, string>, previous: Record<string, string> = {}) {
  for (const field of template.fields) {
    const value = metadata[field.key];
    if (!value || field.type !== "number" || previous[field.key] === value) continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || (field.min !== undefined && numeric < field.min) || (field.max !== undefined && numeric > field.max)) {
      return `${field.label} must be a whole number${field.min !== undefined ? ` of at least ${field.min}` : ""}${field.max !== undefined ? ` and at most ${field.max}` : ""}.`;
    }
  }
  return null;
}
