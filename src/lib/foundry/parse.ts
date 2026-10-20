import { createHash } from "node:crypto";
import { adaptPf2e } from "./adapters/pf2e";
import type { FoundryCandidate, FoundryMetadata } from "./types";

export type FoundryUpload = { name: string; text: string };
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENTS = 1000;
const MAX_DOCUMENT_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

function extractDocuments(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!object(value)) throw new Error("Each upload must contain a Foundry Item document or an array of documents.");
  // A typed document is never a bundle: Actor exports can contain embedded items.
  if (typeof value.type === "string" || value.documentName === "Actor") return [value];
  for (const key of ["items", "documents"]) if (Array.isArray(value[key])) return value[key] as unknown[];
  throw new Error("No Item document or documents array was found in this upload.");
}

export function parseFoundrySources(files: FoundryUpload[], metadata: FoundryMetadata): FoundryCandidate[] {
  if (!Array.isArray(files) || files.length === 0) throw new Error("Upload at least one JSON source file.");
  if (!object(metadata) || typeof metadata.system !== "string" || typeof metadata.systemVersion !== "string" || typeof metadata.foundryVersion !== "string" || typeof metadata.namespace !== "string" || typeof metadata.remaster !== "boolean")
    throw new Error("Complete system, system version, Foundry version, Remaster declaration, and source namespace metadata are required.");
  if (metadata.system !== "pf2e") throw new Error("This parser currently supports the pf2e system only.");
  if (!metadata.namespace.trim() || metadata.namespace.length > 200) throw new Error("A source namespace of 1–200 characters is required.");
  if (!metadata.systemVersion.trim() || !metadata.foundryVersion.trim()) throw new Error("Explicit system and Foundry versions are required.");
  let totalBytes = 0;
  const docs: Array<{ doc: unknown; file: string; raw: string; index: number }> = [];
  for (const file of files) {
    if (!file || typeof file.name !== "string" || typeof file.text !== "string") throw new Error("Uploads require a filename and UTF-8 text.");
    const bytes = Buffer.byteLength(file.text, "utf8");
    totalBytes += bytes;
    if (bytes > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) throw new Error("Foundry uploads exceed the 10 MB total or per-file limit.");
    let parsed: unknown;
    try { parsed = JSON.parse(file.text); } catch { throw new Error(`“${file.name}” is not valid JSON.`); }
    const extracted = extractDocuments(parsed);
    for (let index = 0; index < extracted.length; index++) {
      const raw = JSON.stringify(extracted[index]);
      if (Buffer.byteLength(raw, "utf8") > MAX_DOCUMENT_BYTES) throw new Error(`A document in “${file.name}” exceeds the 1 MB per-document limit.`);
      docs.push({ doc: extracted[index], file: file.name.slice(0, 200), raw, index });
      if (docs.length > MAX_DOCUMENTS) throw new Error("Foundry uploads may contain at most 1,000 documents.");
    }
  }
  const candidates = docs.map(({ doc, file, raw }) => {
    const record = object(doc) ? doc : {};
    const sourceHash = hash(raw);
    const hasStableSourceId = typeof record.uuid === "string" && Boolean(record.uuid) || typeof record._id === "string" && Boolean(record._id);
    const docId = typeof record.uuid === "string" && record.uuid ? record.uuid : typeof record._id === "string" && record._id ? record._id : `content:${sourceHash}`;
    const sourceIdentity = JSON.stringify([metadata.namespace.trim(), docId]);
    const stableId = hash(sourceIdentity).slice(0, 32);
    const candidate = adaptPf2e(doc, metadata, { id: stableId, sourceHash, sourceIdentity });
    if (candidate.source === "Foundry upload") candidate.source = file;
    if (!hasStableSourceId) {
      candidate.supported = false;
      candidate.warnings.push("This document has no stable Foundry UUID or ID. Import is disabled because possible matches cannot be resolved safely in this MVP. Re-export an Item with its source ID.");
    }
    return candidate;
  });
  const identities = new Set<string>();
  for (const candidate of candidates) {
    if (identities.has(candidate.sourceIdentity)) throw new Error("The upload contains duplicate source identities. Remove duplicate documents before previewing.");
    identities.add(candidate.sourceIdentity);
  }
  return candidates;
}

export const foundryParseLimits = { maxTotalBytes: MAX_TOTAL_BYTES, maxFileBytes: MAX_FILE_BYTES, maxDocumentBytes: MAX_DOCUMENT_BYTES, maxDocuments: MAX_DOCUMENTS } as const;

export type { FoundryCandidate, FoundryMetadata } from "./types";
