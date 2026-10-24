export const STOCK_VERIFICATION_ORIGINS = ["BUNDLED_REVIEW", "IMPORTED_DECLARATION", "PENDING_REVIEW"] as const;
export type StockVerificationOrigin = (typeof STOCK_VERIFICATION_ORIGINS)[number];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function attributionUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim() || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}

export function hasApprovedStockReview(value: unknown): boolean {
  const rights = record(record(value)?.rights);
  const evidence = record(rights?.evidence);
  return rights?.reviewStatus === "approved"
    && typeof evidence?.reviewer === "string" && !!evidence.reviewer.trim()
    && !/pending|unreviewed|unknown|\btbd\b/i.test(evidence.reviewer)
    && typeof evidence.reviewedAt === "string" && !Number.isNaN(Date.parse(evidence.reviewedAt));
}

/** Old rows without an explicit approval remain unverified, even if labelled reviewed. */
export function provenanceVerificationOrigin(origin: string, snapshotJson: string): StockVerificationOrigin {
  if (origin === "IMPORTED_DECLARATION") return "IMPORTED_DECLARATION";
  if (origin === "BUNDLED_REVIEW") {
    try { if (hasApprovedStockReview(JSON.parse(snapshotJson))) return "BUNDLED_REVIEW"; } catch { /* Unusable evidence is not approval. */ }
  }
  return "PENDING_REVIEW";
}

/** Validate portable attribution without requiring catalog files on this installation. */
export function validateImportedStockSnapshot(snapshotJson: string, entryId: string, version: number): void {
  let value: Record<string, unknown> | null;
  try { value = record(JSON.parse(snapshotJson)); } catch { value = null; }
  const attribution = record(value?.attribution);
  const text = (candidate: unknown, limit: number) => typeof candidate === "string" && !!candidate.trim() && candidate.length <= limit;
  if (!value || value.id !== entryId || value.version !== version || !text(value.title, 200)
    || !attribution || !text(attribution.creditText, 500) || typeof attribution.required !== "boolean"
    || !["adjacent", "credits-section"].includes(String(attribution.placement))
    || !attributionUrl(attribution.licenseUrl)) {
    throw new Error("Malformed provenance snapshot; refusing to import the artwork as an uncredited upload");
  }
  for (const key of ["sourceUrl", "creatorUrl"] as const) {
    if (attribution[key] !== undefined && !attributionUrl(attribution[key])) throw new Error(`Malformed provenance snapshot ${key}`);
  }
  for (const [section, key] of [["creator", "url"], ["source", "itemUrl"], ["rights", "licenseUrl"]]) {
    const details = value[section];
    if (details !== undefined && !record(details)) throw new Error(`Malformed provenance snapshot ${section}`);
    const url = record(details)?.[key];
    if (url !== undefined && !attributionUrl(url)) throw new Error(`Malformed provenance snapshot ${section}.${key}`);
  }
  if (attribution.modificationNotice !== undefined
    && (typeof attribution.modificationNotice !== "string" || attribution.modificationNotice.length > 500)) {
    throw new Error("Malformed provenance snapshot modification notice");
  }
}
