import type { FoundryCandidate, FoundryMetadata } from "../types";

const SUPPORTED_TYPES: Record<string, string> = {
  weapon: "ITEM", armor: "ITEM", equipment: "ITEM", consumable: "ITEM",
  treasure: "ITEM", backpack: "ITEM", spell: "SPELL", feat: "FEAT",
};
// Provisional adapter gate only. These synthetic-shape tests do not establish real-export compatibility.
const PROVISIONAL_VERSIONS = { systemVersion: "8.6.1", foundryVersion: "14.369" };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function object(value: unknown): boolean { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

function plainText(input: unknown): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/<(script|style|iframe|object|svg)[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<br\s*\/?>|<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/\[\[\/(?:r|roll|gmroll|blindroll|selfroll)\s+([^\]]+)\]\]/gi, "Roll: $1")
    .replace(/\[\[([\s\S]*?)\]\]/g, "$1")
    .replace(/@(?:Check|Damage|Template|UUID|Compendium|Embed)\[([^\]]*)\](?:\{([^}]*)\})?/gi, (_m, args: string, label: string) => label || args.replace(/[|,]+/g, " "))
    .replace(/@([A-Za-z][\w-]*)\[([^\]]*)\](?:\{([^}]*)\})?/g, (_m, kind: string, args: string, label: string) => label || `${kind} ${args.replace(/[|,]+/g, " ")}`)
    .replace(/\[\/(?:r|roll|gmroll|blindroll|selfroll)\s+([^\]]+)\]/gi, "Roll: $1")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
}

function fieldText(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  const wrapped = record(value);
  if (typeof wrapped.value === "string" || typeof wrapped.value === "number") return plainText(String(wrapped.value));
  if (Array.isArray(wrapped.value)) return wrapped.value.filter(v => typeof v === "string" || typeof v === "number").map(String).join(", ");
  return "";
}

export function adaptPf2e(document: unknown, metadata: FoundryMetadata, ids: { id: string; sourceHash: string; sourceIdentity: string }): FoundryCandidate {
  const doc = record(document);
  const system = record(doc.system);
  const traits = record(system.traits);
  const traitValues = Array.isArray(traits.value) ? traits.value.filter((v): v is string => typeof v === "string") : [];
  const flags = record(doc.flags);
  const pf2eFlags = record(flags.pf2e);
  const internalStats = record(doc._stats);
  const type = typeof doc.type === "string" ? doc.type : "unknown";
  const category = SUPPORTED_TYPES[type] ?? "UNSUPPORTED";
  const validName = typeof doc.name === "string" && Boolean(doc.name.trim()) && doc.name.length <= 200;
  const name = validName ? (doc.name as string).trim() : "Invalid Foundry item";
  const warnings: string[] = [];
  const legacy = metadata.remaster !== true || pf2eFlags.legacy === true || pf2eFlags.remaster === false || traitValues.some(t => /^(legacy|OGL)$/i.test(t));
  const actorOwned = [doc.uuid, internalStats.compendiumSource].some(value => typeof value === "string" && /Actor\.[^.]+\.Item\./.test(value));
  const correctSystem = object(doc.system) && typeof doc.type === "string";
  const versionsMatch = metadata.foundryVersion === PROVISIONAL_VERSIONS.foundryVersion && metadata.systemVersion === PROVISIONAL_VERSIONS.systemVersion;
  const provenanceMatches = (internalStats.systemId === undefined || internalStats.systemId === metadata.system)
    && (internalStats.systemVersion === undefined || internalStats.systemVersion === metadata.systemVersion)
    && (internalStats.coreVersion === undefined || internalStats.coreVersion === metadata.foundryVersion);
  const supported = category !== "UNSUPPORTED" && !legacy && validName && correctSystem && !actorOwned && versionsMatch && provenanceMatches;
  if (category === "UNSUPPORTED") warnings.push(`Foundry Item type “${type}” is not supported by this adapter.`);
  if (legacy) warnings.push("This source is not explicitly declared as Pathfinder 2e Remaster or carries legacy markers; it cannot be imported into the Remaster profile.");
  if (!validName) warnings.push("A valid non-empty name of at most 200 characters is required.");
  if (!correctSystem) warnings.push("The document is missing a usable Foundry Item type or system object.");
  if (actorOwned) warnings.push("Actor-owned Item documents are outside this import milestone.");
  if (!versionsMatch) warnings.push(`This provisional adapter gate accepts only Foundry ${PROVISIONAL_VERSIONS.foundryVersion} with PF2e ${PROVISIONAL_VERSIONS.systemVersion}; compatibility still requires representative real exports.`);
  if (!provenanceMatches) warnings.push("Embedded _stats system or core version metadata conflicts with the submitted source metadata.");
  if (typeof doc.img === "string" && doc.img.trim()) warnings.push("The source has an image path. Images are not fetched or copied by this parser.");
  const sourceText = JSON.stringify(document);
  if (/@(?:UUID|Compendium|Embed)\[|\[\[|\[\/(?:r|roll|gmroll|blindroll|selfroll)\s/i.test(sourceText)) warnings.push("This document contains Foundry references or roll commands. References remain unresolved and rolls are shown as text in this preview.");
  if (system.rules !== undefined || system.effects !== undefined || system.rollOptions !== undefined || system.rulesSelections !== undefined)
    warnings.push("Foundry rules, effects, roll options, and automation are not converted; review the source record for mechanics that need manual mapping.");
  if (type === "weapon" || type === "spell" || type === "feat")
    warnings.push("Some system-specific actions, damage, prerequisites, or automation may not map to WorldForge fields and require manual review.");
  const description = plainText(fieldText(system, "description"));
  const stats: Record<string, unknown> = {
    sourceType: type,
    description,
    level: String(record(system.level).value ?? record(system.level).rank ?? "").trim(),
    rarity: fieldText(traits, "rarity") || "common",
    traitsText: traitValues.join(", "),
  };
  for (const key of ["bulk", "usage", "activation", "frequency", "requirements", "trigger", "range", "area", "targets", "duration", "save", "traditions"])
    if (system[key] !== undefined) {
      const mapped = fieldText(system, key);
      if (mapped) stats[key] = mapped;
    }
  const price = record(system.price);
  if (price.value && typeof price.value === "object" && !Array.isArray(price.value)) {
    const currency = record(price.value);
    const text = ["pp", "gp", "sp", "cp"].filter(k => typeof currency[k] === "number" && currency[k] !== 0).map(k => `${currency[k]} ${k}`).join(", ");
    if (text) stats.price = text;
  } else if (typeof price.value === "string" || typeof price.value === "number") stats.price = String(price.value);
  if (system.variants !== undefined) warnings.push("This document includes variants; the preview preserves them in the source record but does not convert them.");
  const levelField = record(system.level);
  const level = String(type === "spell" ? (levelField.rank ?? levelField.value ?? "") : (levelField.value ?? "")).trim();
  if (type === "spell" && level) stats.rank = level;
  if (type === "feat") {
    const actionCost = record(system.actionCost);
    const actions = actionCost.value ?? actionCost.type;
    if (typeof actions === "string" || typeof actions === "number") stats.actionCost = String(actions);
    for (const key of ["prerequisites", "requirements", "frequency", "trigger", "special"])
      if (system[key] !== undefined) {
        const mapped = fieldText(system, key);
        if (mapped) stats[key] = mapped;
      }
  }
  const rarity = String(stats.rarity);
  return {
    ...ids, name, type, source: typeof doc.folder === "string" ? doc.folder : "Foundry upload",
    sourceDocument: document, systemVersion: metadata.systemVersion, foundryVersion: metadata.foundryVersion,
    supported, warnings, category, stats,
    ...(level ? { level } : {}), ...(rarity ? { rarity } : {}),
  };
}

export { plainText as sanitizeFoundryText };
