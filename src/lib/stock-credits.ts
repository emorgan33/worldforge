import { prisma } from "./db";
import { isAssetId } from "./assets";
import { attributionUrl, provenanceVerificationOrigin, type StockVerificationOrigin } from "./stock-provenance";

export type CreditPlacement = "adjacent" | "credits-section";

export interface ParsedCreditSnapshot {
  title: string;
  creditText: string;
  placement: CreditPlacement;
  creatorUrl?: string;
  sourceUrl?: string;
  licenseUrl?: string;
  modificationNotice?: string;
}

export interface ReaderCredit extends ParsedCreditSnapshot {
  assetId: string;
  verificationOrigin: StockVerificationOrigin;
}

/**
 * Decode the catalog snapshot stored with an asset's provenance into the
 * reader-facing credit. Uploads (no provenance) and snapshots without a usable
 * credit text return null so nothing is invented for the reader.
 */
export function parseCreditSnapshot(snapshotJson: string): ParsedCreditSnapshot | null {
  let value: unknown;
  try {
    value = JSON.parse(snapshotJson);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const attribution = record.attribution;
  if (!attribution || typeof attribution !== "object" || Array.isArray(attribution)) return null;
  const creditText = (attribution as Record<string, unknown>).creditText;
  if (typeof creditText !== "string") return null;
  const trimmed = creditText.trim();
  if (!trimmed || trimmed.length > 500) return null;
  const placement = (attribution as Record<string, unknown>).placement === "adjacent" ? "adjacent" : "credits-section";
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : "Untitled artwork";
  const fields = attribution as Record<string, unknown>;
  const creator = record.creator && typeof record.creator === "object" ? record.creator as Record<string, unknown> : {};
  const source = record.source && typeof record.source === "object" ? record.source as Record<string, unknown> : {};
  const rights = record.rights && typeof record.rights === "object" ? record.rights as Record<string, unknown> : {};
  return {
    title, creditText: trimmed, placement,
    creatorUrl: attributionUrl(fields.creatorUrl ?? creator.url),
    sourceUrl: attributionUrl(fields.sourceUrl ?? source.itemUrl),
    licenseUrl: attributionUrl(fields.licenseUrl ?? rights.licenseUrl),
    modificationNotice: typeof fields.modificationNotice === "string" && fields.modificationNotice.length <= 500 ? fields.modificationNotice : undefined,
  };
}

/**
 * Reader-facing credits for the stock/imported assets actually used on a page.
 * Every applicable provenance row is retained; uploads and malformed
 * snapshots are dropped so private or invented text never reaches readers.
 */
export async function readerCreditsForAssets(worldId: string, assetIds: Iterable<string>): Promise<ReaderCredit[]> {
  const ids = [...new Set(assetIds)].filter(isAssetId);
  if (!ids.length) return [];
  const rows = await prisma.imageAssetProvenance.findMany({
    where: { assetId: { in: ids }, asset: { worldId } },
    select: { assetId: true, snapshotJson: true, verificationOrigin: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const credits: ReaderCredit[] = [];
  for (const row of rows) {
    const parsed = parseCreditSnapshot(row.snapshotJson);
    if (!parsed) continue;
    credits.push({
      assetId: row.assetId,
      verificationOrigin: provenanceVerificationOrigin(row.verificationOrigin, row.snapshotJson),
      ...parsed,
    });
  }
  return credits.sort((a, b) => a.assetId.localeCompare(b.assetId));
}

/** Collapse credits that share text and placement for a readable section list. */
export function dedupeCredits(credits: ReaderCredit[]): ReaderCredit[] {
  const seen = new Set<string>();
  const result: ReaderCredit[] = [];
  for (const credit of credits) {
    const key = creditIdentity(credit);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(credit);
  }
  return result.sort(
    (a, b) => a.placement.localeCompare(b.placement) || a.creditText.localeCompare(b.creditText) || a.assetId.localeCompare(b.assetId),
  );
}

export function creditIdentity(credit: ReaderCredit): string {
  return JSON.stringify([credit.title, credit.placement, credit.creditText, credit.creatorUrl, credit.sourceUrl, credit.licenseUrl, credit.modificationNotice, credit.verificationOrigin]);
}

export function adjacentCreditsFor(credits: ReaderCredit[], assetId: string | null | undefined): ReaderCredit[] {
  return assetId ? dedupeCredits(credits.filter(credit => credit.assetId === assetId && credit.placement === "adjacent")) : [];
}

/** Credit to place directly beneath a specific image, if it asks for adjacent placement. */
export function adjacentCreditFor(credits: ReaderCredit[], assetId: string | null | undefined): ReaderCredit | null {
  if (!assetId) return null;
  return credits.find(credit => credit.assetId === assetId && credit.placement === "adjacent") ?? null;
}
