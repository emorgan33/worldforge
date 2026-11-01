import type { ArticleTemplateMeta } from "@/types";

export type MetadataReferenceKind = "scalar" | "article" | "statblock" | "article-list";

/**
 * Metadata reference semantics are explicit. Similar-looking prose fields are
 * intentionally not inferred as IDs: adding a reference field requires adding
 * its key here as well as to the corresponding template.
 */
const SINGLE_ARTICLE_REFERENCE_KEYS = new Set([
  "linkedLocation",
  "linkedPlot",
  "linkedSession",
  "previousPlot",
  "nextPlot",
]);

const ARTICLE_LIST_REFERENCE_KEYS = new Set([
  "linkedEncounters",
  "linkedPlots",
  "linkedLocations",
  "linkedSessions",
]);

const STATBLOCK_REFERENCE_KEYS = new Set([
  "dnd5eStatblockId",
  "pf2eStatblockId",
  "COCStatblockId",
  "FATEStatblockId",
  "CUSTOMStatblockId",
]);

const PARTICIPANT_REFERENCE_KEY = /^(?:dnd5e|pf2e)Participant[1-6]$/;

export function metadataReferenceKind(key: string): MetadataReferenceKind {
  if (SINGLE_ARTICLE_REFERENCE_KEYS.has(key)) return "article";
  if (ARTICLE_LIST_REFERENCE_KEYS.has(key)) return "article-list";
  if (STATBLOCK_REFERENCE_KEYS.has(key) || PARTICIPANT_REFERENCE_KEY.test(key)) return "statblock";
  return "scalar";
}

/** Validate the serialized shape of known references while retaining opaque extensions. */
export function validateMetadataReferences(metadata: unknown): string | null {
  if (metadata === undefined || metadata === null) return null;
  if (typeof metadata !== "object" || Array.isArray(metadata)) return "Article metadata must be an object.";
  for (const [key, value] of Object.entries(metadata)) {
    if (metadataReferenceKind(key) === "scalar") continue;
    if (typeof value !== "string") return `${key} must be a string reference.`;
  }
  return null;
}

/** Project active template metadata for a reader and remove inaccessible IDs. */
export function projectReaderMetadata(
  rawMetadata: Record<string, unknown>,
  template: ArticleTemplateMeta,
  system: string,
  allowedArticleIds: ReadonlySet<string>,
  allowedStatblockIds: ReadonlySet<string>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = Object.fromEntries(
    template.fields
      .filter(field => typeof rawMetadata[field.key] === "string")
      .map(field => [field.key, rawMetadata[field.key]]),
  );

  for (const key of Object.keys(projected)) {
    const kind = metadataReferenceKind(key);
    const value = projected[key];
    if (typeof value !== "string") continue;
    if (kind === "article" && value && !allowedArticleIds.has(value)) projected[key] = "";
    if (kind === "statblock" && value && !allowedStatblockIds.has(value)) projected[key] = "";
    if (kind === "article-list") {
      projected[key] = value
        .split(/\r?\n/)
        .map(id => id.trim())
        .filter(id => id && allowedArticleIds.has(id))
        .join("\n");
    }
  }

  projected.rulesSystem = system;
  return projected;
}

/** Remap known IDs in a serialized article metadata object, retaining extensions. */
export function remapArticleMetadata(
  metadataJson: string | null,
  articleIdMap: ReadonlyMap<string, string>,
  statblockIdMap: ReadonlyMap<string, string>,
  onMissing?: (key: string, sourceId: string, kind: "article" | "statblock") => void,
): string | null {
  if (!metadataJson) return metadataJson;

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return metadataJson;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return metadataJson;

  const metadata = parsed as Record<string, unknown>;
  for (const [key, value] of Object.entries(metadata)) {
    const kind = metadataReferenceKind(key);
    if (kind === "scalar") continue;
    if (typeof value !== "string") {
      metadata[key] = "";
      continue;
    }
    if (kind === "article" || kind === "statblock") {
      if (!value) continue;
      const idMap = kind === "article" ? articleIdMap : statblockIdMap;
      const targetId = idMap.get(value);
      if (targetId) metadata[key] = targetId;
      else {
        metadata[key] = "";
        onMissing?.(key, value, kind);
      }
    } else if (kind === "article-list") {
      metadata[key] = value
        .split(/\r?\n/)
        .map(id => id.trim())
        .filter(Boolean)
        .map(sourceId => {
          const targetId = articleIdMap.get(sourceId);
          if (targetId) return targetId;
          onMissing?.(key, sourceId, "article");
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
  }

  return JSON.stringify(metadata);
}
