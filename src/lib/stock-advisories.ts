import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./db";

export const STOCK_ADVISORY_ACTIONS = ["restrict", "clear"] as const;
export type StockAdvisoryAction = (typeof STOCK_ADVISORY_ACTIONS)[number];

export interface StockAdvisoryRecord {
  catalogEntryId: string;
  version: number;
  action: StockAdvisoryAction;
  reason?: string;
  date?: string;
}

export interface StockAdvisoryApplyResult {
  restricted: number;
  cleared: number;
  unmatched: string[];
  errors: string[];
}

/** Parse and validate an operator advisory file. Unknown/malformed rows are rejected. */
export function parseStockAdvisories(raw: unknown): { advisories: StockAdvisoryRecord[]; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { advisories: [], errors: ["The advisory file must be a JSON object with an advisories array."] };
  const list = (raw as Record<string, unknown>).advisories;
  if (list === undefined) return { advisories: [], errors: [] };
  if (!Array.isArray(list)) return { advisories: [], errors: ["advisories must be an array."] };
  const advisories: StockAdvisoryRecord[] = [];
  list.forEach((value, index) => {
    const prefix = `advisories[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) { errors.push(`${prefix}: must be an object.`); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.catalogEntryId !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.catalogEntryId)) { errors.push(`${prefix}.catalogEntryId: invalid entry id.`); return; }
    if (!Number.isSafeInteger(record.version) || (record.version as number) < 1) { errors.push(`${prefix}.version: must be a positive integer.`); return; }
    if (!STOCK_ADVISORY_ACTIONS.includes(record.action as StockAdvisoryAction)) { errors.push(`${prefix}.action: must be "restrict" or "clear".`); return; }
    if (record.action === "restrict" && (typeof record.reason !== "string" || !record.reason.trim() || record.reason.length > 500)) { errors.push(`${prefix}.reason: explain why display is restricted.`); return; }
    const date = typeof record.date === "string" && record.date.trim() ? record.date.trim() : new Date().toISOString().slice(0, 10);
    if (Number.isNaN(Date.parse(date))) { errors.push(`${prefix}.date: must be an ISO date.`); return; }
    advisories.push({ catalogEntryId: record.catalogEntryId, version: record.version as number, action: record.action as StockAdvisoryAction, reason: typeof record.reason === "string" ? record.reason.trim() : undefined, date });
  });
  return { advisories, errors };
}

/**
 * Apply operator advisories to installed copies. `restrict` marks affected
 * copies unavailable to readers but keeps bytes/provenance for owner review and
 * recovery (ordinary library edits cannot clear it); `clear` reverses it.
 * Applies by catalog identity in provenance, so it works with no installed
 * catalog present.
 */
export async function applyStockAdvisories(advisories: StockAdvisoryRecord[]): Promise<StockAdvisoryApplyResult> {
  const result: StockAdvisoryApplyResult = { restricted: 0, cleared: 0, unmatched: [], errors: [] };
  for (const advisory of advisories) {
    const rows = await prisma.imageAssetProvenance.findMany({
      where: { catalogEntryId: advisory.catalogEntryId, catalogVersion: advisory.version },
      select: { assetId: true },
      distinct: ["assetId"],
    });
    if (!rows.length) { result.unmatched.push(`${advisory.catalogEntryId}@${advisory.version}`); continue; }
    const assetIds = rows.map(row => row.assetId);
    if (advisory.action === "restrict") {
      const updated = await prisma.imageAsset.updateMany({
        where: { id: { in: assetIds } },
        data: { displayRestricted: true, restrictionReason: advisory.reason ?? null, restrictionDate: new Date(advisory.date!) },
      });
      result.restricted += updated.count;
    } else {
      const updated = await prisma.imageAsset.updateMany({
        where: { id: { in: assetIds } },
        data: { displayRestricted: false, restrictionReason: null, restrictionDate: null },
      });
      result.cleared += updated.count;
    }
  }
  return result;
}

export function stockAdvisoryFile(root: string) {
  return path.resolve(process.env.WORLDFORGE_STOCK_ART_ADVISORY || path.join(root, "advisories.json"));
}

export async function readStockAdvisoryFile(file: string): Promise<{ advisories: StockAdvisoryRecord[]; errors: string[] }> {
  try {
    return parseStockAdvisories(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") return { advisories: [], errors: [] };
    return { advisories: [], errors: [error instanceof Error ? error.message : "Could not read the advisory file."] };
  }
}
