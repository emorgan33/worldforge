import type { WorldExportV1, WorldExportV2, WorldExportV3, WorldExportV4 } from "@/lib/world-export";

/** Versioned wire manifests after envelope decoding. */
export type DecodedWorldTransfer =
  | { version: 1; bundle: WorldExportV1 }
  | { version: 2; bundle: WorldExportV2 }
  | { version: 3; bundle: WorldExportV3 }
  | { version: 4; bundle: WorldExportV4 };

/** Stable, version-neutral view used by execution adapters. */
export interface CanonicalWorldTransfer {
  sourceVersion: 1 | 2 | 3 | 4;
  sourceWorld: { id: string; slug: string; title: string; description: string | null; genre: string; system: string };
  categories: readonly { id: string; parentId: string | null; name: string; icon: string; order: number }[];
  articles: readonly { id: string; categoryId: string | null; title: string; slug: string }[];
  assets: readonly { id: string; title: string; data: string }[];
}

export function toCanonicalWorldTransfer(decoded: DecodedWorldTransfer): CanonicalWorldTransfer {
  const { version, bundle } = decoded;
  return {
    sourceVersion: version,
    sourceWorld: {
      id: bundle.world.id, slug: bundle.world.slug, title: bundle.world.title,
      description: bundle.world.description, genre: bundle.world.genre, system: bundle.world.system,
    },
    categories: bundle.categories,
    articles: bundle.articles,
    assets: bundle.assets,
  };
}

/** Remap embedded asset URLs and clear references absent from the bundle. */
export function remapWorldAssetUrls(content: string | null, assetUrlMap: ReadonlyMap<string, string>, warn: (sourceAssetId: string) => void): string | null {
  if (!content) return content;
  return content.replace(/(?:https?:\/\/[^\s"'<>]+)?\/api\/assets\/([0-9a-f-]{36})\/file/gi, (match, sourceAssetId: string) => {
    const target = assetUrlMap.get(`/api/assets/${sourceAssetId.toLowerCase()}/file`)
      ?? [...assetUrlMap].find(([source]) => source.toLowerCase() === `/api/assets/${sourceAssetId.toLowerCase()}/file`)?.[1];
    if (target) return target;
    // Preserve external image URLs. Only a recognized WorldForge asset path
    // is world-local and therefore eligible for clearing when it is absent.
    if (/^https?:\/\//i.test(match)) return match;
    warn(sourceAssetId);
    return "";
  });
}

export function remapWorldReferenceId(sourceId: string | null, idMap: ReadonlyMap<string, string>): string | null {
  return sourceId ? idMap.get(sourceId) ?? null : null;
}

export const MAX_WORLD_TRANSFER_BYTES = 60 * 1024 * 1024;
export const MAX_WORLD_TRANSFER_SECTION_ITEMS = 10_000;
export const MAX_WORLD_TRANSFER_ASSET_BASE64_CHARS = 14 * 1024 * 1024;

export function validTransferSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 120 && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

export function worldTransferSlugsValid(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const bundle = value as Record<string, unknown>;
  if (!validTransferSlug((bundle.world as { slug?: unknown } | null)?.slug)) return false;
  if (!Array.isArray(bundle.articles)) return false;
  const slugs = new Set<string>();
  for (const article of bundle.articles) {
    const slug = (article as { slug?: unknown } | null)?.slug;
    if (!validTransferSlug(slug) || slugs.has(slug)) return false;
    slugs.add(slug);
  }
  return bundle.articleRevisions === undefined || Array.isArray(bundle.articleRevisions) && bundle.articleRevisions.every(revision => validTransferSlug((revision as { slug?: unknown } | null)?.slug));
}

export function importedWorldSlug(base: string, suffix: number): string {
  if (!suffix) return base;
  const ending = `-${suffix}`;
  return `${base.slice(0, 120 - ending.length)}${ending}`;
}

export function clonedArticleSlug(sourceSlug: string, suffix: number): string {
  const base = sourceSlug.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "article";
  const ending = suffix === 0 ? "-copy" : `-copy-${suffix}`;
  return `${base.slice(0, 120 - ending.length)}${ending}`;
}

export function exportFilenameSlug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "world";
}

/** Return the first shared importer limit exceeded by a bundle. */
export function worldTransferLimitError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Import bundle must be a JSON object";
  const bundle = value as Record<string, unknown>;
  const sections = ["categories", "articles", "articleRevisions", "assets", "statblocks", "secrets", "timelines", "variableCollections", "members", "audiencePolicies", "audienceGrants", "auditEvents", "sessions", "sessionEntityLinks", "maps"];
  for (const key of sections) {
    const section = bundle[key];
    if (section !== undefined && (!Array.isArray(section) || section.length > MAX_WORLD_TRANSFER_SECTION_ITEMS)) {
      return `The ${key} section exceeds the ${MAX_WORLD_TRANSFER_SECTION_ITEMS.toLocaleString()} item import limit`;
    }
  }
  if (Array.isArray(bundle.assets)) {
    const oversized = bundle.assets.findIndex(asset => !asset || typeof asset !== "object" || typeof (asset as { data?: unknown }).data !== "string" || (asset as { data: string }).data.length > MAX_WORLD_TRANSFER_ASSET_BASE64_CHARS);
    if (oversized >= 0) return `Asset ${oversized + 1} exceeds the per-asset import limit`;
  }
  return null;
}

/** Read JSON within the import endpoint's documented byte limit. */
export async function readWorldTransferJson(request: Request): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_WORLD_TRANSFER_BYTES) {
    throw new Error("Import bundle exceeds the 60 MB limit");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Import bundle is empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_WORLD_TRANSFER_BYTES) {
        await reader.cancel();
        throw new Error("Import bundle exceeds the 60 MB limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Validate shared structural limits before dispatching to a version adapter. */
export function isWorldTransferShape(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bundle = value as Record<string, unknown>;
  const world = bundle.world as Record<string, unknown> | null;
  if (!world || typeof world !== "object" || typeof world.title !== "string" || world.title.length > 200 || !worldTransferSlugsValid(bundle)) return false;
  if (worldTransferLimitError(bundle)) return false;
  return true;
}

/** Decode the version envelope without lying about the v3 discriminator. */
export function decodeWorldTransfer(value: Record<string, unknown>): DecodedWorldTransfer | null {
  if (value.formatVersion === 2) return { version: 2, bundle: value as unknown as WorldExportV2 };
  if (value.formatVersion === 3) return { version: 3, bundle: value as unknown as WorldExportV3 };
  if (value.formatVersion === 4) return { version: 4, bundle: value as unknown as WorldExportV4 };
  if (value.version === 1) return { version: 1, bundle: value as unknown as WorldExportV1 };
  return null;
}
