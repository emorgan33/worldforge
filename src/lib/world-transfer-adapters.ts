import type { WorldExportV1, WorldExportV2, WorldExportV3 } from "@/lib/world-export";

/** Versioned wire manifests after envelope decoding. */
export type DecodedWorldTransfer =
  | { version: 1; bundle: WorldExportV1 }
  | { version: 2; bundle: WorldExportV2 }
  | { version: 3; bundle: WorldExportV3 };

/** Stable, version-neutral view used by execution adapters. */
export interface CanonicalWorldTransfer {
  sourceVersion: 1 | 2 | 3;
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
  let remapped = content;
  for (const [sourceUrl, targetUrl] of assetUrlMap) remapped = remapped.split(sourceUrl).join(targetUrl);
  const available = new Set(assetUrlMap.values());
  return remapped.replace(/\/api\/assets\/([0-9a-f-]{36})\/file/gi, (match, sourceAssetId: string) => {
    if (available.has(match)) return match;
    warn(sourceAssetId);
    return "";
  });
}

export function remapWorldReferenceId(sourceId: string | null, idMap: ReadonlyMap<string, string>): string | null {
  return sourceId ? idMap.get(sourceId) ?? null : null;
}

export const MAX_WORLD_TRANSFER_BYTES = 60 * 1024 * 1024;

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
  if (!world || typeof world !== "object" || typeof world.title !== "string" || typeof world.slug !== "string" || world.title.length > 200 || world.slug.length > 120) return false;
  for (const key of ["categories", "articles", "articleRevisions", "assets", "statblocks", "secrets", "timelines", "variableCollections", "members", "audiencePolicies", "audienceGrants", "auditEvents", "sessions", "sessionEntityLinks", "maps"]) {
    const section = bundle[key];
    if (section !== undefined && (!Array.isArray(section) || section.length > 10000)) return false;
  }
  if (Array.isArray(bundle.assets) && bundle.assets.some((asset) => !asset || typeof asset !== "object" || typeof (asset as { data?: unknown }).data !== "string" || (asset as { data: string }).data.length > 14 * 1024 * 1024)) return false;
  return true;
}

/** Decode the version envelope without lying about the v3 discriminator. */
export function decodeWorldTransfer(value: Record<string, unknown>): DecodedWorldTransfer | null {
  if (value.formatVersion === 2) return { version: 2, bundle: value as unknown as WorldExportV2 };
  if (value.formatVersion === 3) return { version: 3, bundle: value as unknown as WorldExportV3 };
  if (value.version === 1) return { version: 1, bundle: value as unknown as WorldExportV1 };
  return null;
}
