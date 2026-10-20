import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { validateBlockInput } from "@/lib/rpg";
import type { FoundryCandidate, FoundryMetadata } from "./types";

export const FOUNDRY_PREVIEW_TTL_MS = 30 * 60 * 1000;
export const FOUNDRY_MAX_BODY_BYTES = 12 * 1024 * 1024;
export const FOUNDRY_MAX_CANDIDATES = 1000;
export const FOUNDRY_MAX_SELECTION = 250;

export async function boundedFoundryJson(request: Request, maxBytes = FOUNDRY_MAX_BODY_BYTES): Promise<unknown> {
  const claimed = Number(request.headers.get("content-length") || 0);
  if (claimed > maxBytes) throw Object.assign(new Error("Request is too large."), { status: 413 });
  if (!request.body) throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw Object.assign(new Error("Request is too large."), { status: 413 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try {
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
}

export type { FoundryCandidate, FoundryMetadata };

export function destinationHash(name: string, system: string, category: string, stats: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ name, system, category, stats })).digest("hex");
}

function outcomeResult(outcome: { candidateId: string; status: string; blockId: string | null; reason: string | null }) {
  return {
    candidateId: outcome.candidateId,
    status: outcome.status as "created" | "skipped" | "failed",
    ...(outcome.blockId ? { blockId: outcome.blockId } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

async function requireDurableOutcome(runId: string, candidateId: string) {
  // A competing request may still be committing its outcome. Give that write a
  // short window to become visible, then fail the request instead of reporting
  // a completed run with a missing entry.
  for (let attempt = 0; attempt < 3; attempt++) {
    const outcome = await prisma.foundryImportOutcome.findUnique({ where: { runId_candidateId: { runId, candidateId } } });
    if (outcome) return outcomeResult(outcome);
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
  }
  throw new Error(`Import outcome was not saved for ${candidateId}.`);
}

export function publicCandidate(candidate: FoundryCandidate, existing?: { sourceHash: string; destinationHash: string; block?: { name: string; system: string; category: string; statsJson: string } }) {
  const safe: Omit<FoundryCandidate, "sourceDocument"> = {
    id: candidate.id, name: candidate.name, type: candidate.type, source: candidate.source,
    sourceIdentity: candidate.sourceIdentity, sourceHash: candidate.sourceHash,
    systemVersion: candidate.systemVersion, foundryVersion: candidate.foundryVersion,
    supported: candidate.supported, warnings: candidate.warnings, category: candidate.category,
    stats: candidate.stats, ...(candidate.level === undefined ? {} : { level: candidate.level }),
    ...(candidate.rarity === undefined ? {} : { rarity: candidate.rarity }),
  };
  const status = !candidate.supported ? "unsupported" : !existing ? "new" : existing.sourceHash === candidate.sourceHash ? "already-imported" : "changed";
  const current = existing?.block ? destinationHash(existing.block.name, existing.block.system, existing.block.category, JSON.parse(existing.block.statsJson)) : null;
  const destinationEdited = existing ? current !== existing.destinationHash : undefined;
  return { ...safe, status, ...(existing ? { destinationEdited, localEdit: destinationEdited } : {}) };
}

export async function storePreview(input: { worldId: string; authorId: string; metadata: FoundryMetadata; candidates: FoundryCandidate[] }) {
  if (input.candidates.length > FOUNDRY_MAX_CANDIDATES) throw new Error("Too many Foundry items in one preview.");
  const expiresAt = new Date(Date.now() + FOUNDRY_PREVIEW_TTL_MS);
  await prisma.foundryPreview.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  const authorPreviews = await prisma.foundryPreview.findMany({ where: { worldId: input.worldId, authorId: input.authorId }, orderBy: { createdAt: "desc" }, select: { id: true }, skip: 4 });
  if (authorPreviews.length) await prisma.foundryPreview.deleteMany({ where: { id: { in: authorPreviews.map(row => row.id) } } });
  const preview = await prisma.foundryPreview.create({ data: {
    worldId: input.worldId, authorId: input.authorId, metadataJson: JSON.stringify(input.metadata),
    candidatesJson: JSON.stringify(input.candidates), expiresAt,
  } });
  const namespace = input.metadata.namespace;
  const known = await prisma.foundryProvenance.findMany({ where: { worldId: input.worldId, namespace, sourceIdentity: { in: input.candidates.map(c => c.sourceIdentity) } }, include: { block: true } });
  const byIdentity = new Map(known.map(record => [record.sourceIdentity, record]));
  return { id: preview.id, expiresAt: expiresAt.toISOString(), items: input.candidates.map(c => publicCandidate(c, byIdentity.get(c.sourceIdentity))) };
}

export async function getPreviewItems(worldId: string, authorId: string, previewId: string) {
  const preview = await prisma.foundryPreview.findFirst({ where: { id: previewId, worldId, authorId, expiresAt: { gt: new Date() } } });
  if (!preview) return null;
  const candidates = JSON.parse(preview.candidatesJson) as FoundryCandidate[];
  const existing = await prisma.foundryProvenance.findMany({ where: { worldId, namespace: JSON.parse(preview.metadataJson).namespace, sourceIdentity: { in: candidates.map(c => c.sourceIdentity) } }, include: { block: true } });
  const byIdentity = new Map(existing.map(record => [record.sourceIdentity, record]));
  return { id: preview.id, expiresAt: preview.expiresAt.toISOString(), items: candidates.map(candidate => publicCandidate(candidate, byIdentity.get(candidate.sourceIdentity))) };
}

export async function createSelectedImport(input: { worldId: string; authorId: string; previewId: string; candidateIds: string[]; idempotencyKey: string }) {
  if (!Array.isArray(input.candidateIds) || input.candidateIds.length < 1 || input.candidateIds.length > FOUNDRY_MAX_SELECTION || input.candidateIds.some(id => typeof id !== "string") || new Set(input.candidateIds).size !== input.candidateIds.length) {
    return { error: "Choose between 1 and 250 unique entries." as const, status: 400 };
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) return { error: "Invalid idempotency key." as const, status: 400 };
  const requestHash = createHash("sha256").update(JSON.stringify({ previewId: input.previewId, candidateIds: input.candidateIds })).digest("hex");
  const priorRun = await prisma.foundryImportRun.findUnique({ where: { worldId_authorId_idempotencyKey: { worldId: input.worldId, authorId: input.authorId, idempotencyKey: input.idempotencyKey } } });
  if (priorRun && priorRun.requestHash !== requestHash) return { error: "Idempotency key was already used for a different selection." as const, status: 409 };
  if (priorRun?.status === "COMPLETED") {
    const durable = await prisma.foundryImportOutcome.findMany({ where: { runId: priorRun.id }, orderBy: { createdAt: "asc" } });
    return { run: { id: priorRun.id, status: "completed", outcomes: durable.map(outcomeResult) } };
  }

  const preview = await prisma.foundryPreview.findFirst({ where: { id: input.previewId, worldId: input.worldId, authorId: input.authorId, expiresAt: { gt: new Date() } } });
  if (!preview) return { error: "Preview not found or expired." as const, status: 404 };
  const world = await prisma.world.findFirst({ where: { id: input.worldId }, select: { system: true } });
  if (world?.system !== "PF_2E") return { error: "Pathfinder 2e imports require a Pathfinder 2e world." as const, status: 400 };
  const metadata = JSON.parse(preview.metadataJson) as FoundryMetadata;
  if (metadata.system !== "pf2e") return { error: "Unsupported Foundry system mapping." as const, status: 400 };
  const candidates = JSON.parse(preview.candidatesJson) as FoundryCandidate[];
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  // Reject the entire request if a client alters or adds IDs; never partially honor a forged selection.
  if (input.candidateIds.some(id => !byId.has(id))) return { error: "Selection contains an item outside this preview." as const, status: 400 };
  const selected = input.candidateIds.map(id => byId.get(id)!);
  if (selected.some(candidate => !candidate.supported || !candidate.sourceIdentity || !candidate.sourceHash || !candidate.category || !candidate.stats || typeof candidate.stats !== "object")) {
    return { error: "Selection contains an unsupported or invalid item." as const, status: 400 };
  }
  if (selected.some(candidate => validateBlockInput({ worldId: input.worldId, system: "PF_2E", category: candidate.category, name: candidate.name, stats: candidate.stats }) !== null)) return { error: "Selection contains an invalid WorldForge item mapping." as const, status: 400 };
  const runId = priorRun?.id || randomUUID();
  let run;
  if (priorRun) run = priorRun;
  else {
    try {
      run = await prisma.foundryImportRun.create({ data: { id: runId, worldId: input.worldId, authorId: input.authorId, previewId: input.previewId, idempotencyKey: input.idempotencyKey, requestHash, outcomesJson: "[]", status: "RUNNING" } });
    } catch {
      const raced = await prisma.foundryImportRun.findUnique({ where: { worldId_authorId_idempotencyKey: { worldId: input.worldId, authorId: input.authorId, idempotencyKey: input.idempotencyKey } } });
      if (raced && raced.requestHash === requestHash) run = raced;
      else if (raced) return { error: "Idempotency key was already used for a different selection." as const, status: 409 };
      else throw new Error("Unable to start import run.");
    }
  }
  const outcomes: { candidateId: string; status: "created" | "skipped" | "failed"; blockId?: string; reason?: string }[] = [];
  for (const candidate of selected) {
    const priorOutcome = await prisma.foundryImportOutcome.findUnique({ where: { runId_candidateId: { runId: run.id, candidateId: candidate.id } } });
    if (priorOutcome) { outcomes.push({ candidateId: priorOutcome.candidateId, status: priorOutcome.status as "created" | "skipped" | "failed", ...(priorOutcome.blockId ? { blockId: priorOutcome.blockId } : {}), ...(priorOutcome.reason ? { reason: priorOutcome.reason } : {}) }); continue; }
    try {
      const existing = await prisma.foundryProvenance.findUnique({ where: { worldId_namespace_sourceIdentity: { worldId: input.worldId, namespace: metadata.namespace, sourceIdentity: candidate.sourceIdentity } }, include: { block: true } });
      if (existing) {
        const skipped = { candidateId: candidate.id, status: "skipped" as const, blockId: existing.blockId, reason: existing.sourceHash === candidate.sourceHash ? "Already imported." : "Source changed; updates are not enabled." };
        try { await prisma.foundryImportOutcome.create({ data: { runId: run.id, ...skipped } }); }
        catch { /* A concurrent request may have recorded the result first. */ }
        outcomes.push(await requireDurableOutcome(run.id, candidate.id));
        continue;
      }
      const blockId = randomUUID();
      const destHash = destinationHash(candidate.name, "PF_2E", candidate.category, candidate.stats);
      await prisma.$transaction(async tx => {
        await tx.rpgBlock.create({ data: { id: blockId, worldId: input.worldId, system: "PF_2E", category: candidate.category, name: candidate.name, statsJson: JSON.stringify(candidate.stats) } });
        await tx.foundryProvenance.create({ data: {
          blockId, worldId: input.worldId, namespace: metadata.namespace, sourceIdentity: candidate.sourceIdentity, sourceHash: candidate.sourceHash,
          destinationHash: destHash, sourceSystem: metadata.system, sourceSystemVersion: candidate.systemVersion, foundryVersion: candidate.foundryVersion,
          sourceDocumentJson: JSON.stringify(candidate.sourceDocument),
        } });
        await tx.foundryImportOutcome.create({ data: { runId: run.id, candidateId: candidate.id, status: "created", blockId } });
      });
      outcomes.push({ candidateId: candidate.id, status: "created", blockId });
    } catch {
      const durable = await prisma.foundryImportOutcome.findUnique({ where: { runId_candidateId: { runId: run.id, candidateId: candidate.id } } }).catch(() => null);
      if (durable) outcomes.push({ candidateId: durable.candidateId, status: durable.status as "created" | "skipped" | "failed", ...(durable.blockId ? { blockId: durable.blockId } : {}), ...(durable.reason ? { reason: durable.reason } : {}) });
      else {
        const raced = await prisma.foundryProvenance.findUnique({ where: { worldId_namespace_sourceIdentity: { worldId: input.worldId, namespace: metadata.namespace, sourceIdentity: candidate.sourceIdentity } }, select: { blockId: true } }).catch(() => null);
        const outcome = raced ? { candidateId: candidate.id, status: "skipped" as const, blockId: raced.blockId, reason: "Already imported." } : { candidateId: candidate.id, status: "failed" as const, reason: "Unable to create this item." };
        try { await prisma.foundryImportOutcome.create({ data: { runId: run.id, ...outcome } }); } catch { /* Concurrent result is already durable. */ }
        outcomes.push(await requireDurableOutcome(run.id, candidate.id));
      }
    }
  }
  const durableOutcomes = await prisma.foundryImportOutcome.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } });
  const savedOutcomes = durableOutcomes.map(outcomeResult);
  const complete = selected.every(candidate => durableOutcomes.some(outcome => outcome.candidateId === candidate.id));
  if (!complete) throw new Error("One or more import outcomes were not saved.");
  await prisma.foundryImportRun.update({ where: { id: run.id }, data: { outcomesJson: JSON.stringify(savedOutcomes), status: complete ? "COMPLETED" : "RUNNING" } });
  return { run: { id: run.id, status: complete ? "completed" : "running", outcomes: savedOutcomes } };
}

export async function getImportRun(worldId: string, authorId: string, runId: string) {
  const run = await prisma.foundryImportRun.findFirst({ where: { id: runId, worldId, authorId } });
  if (!run) return null;
  const outcomes = await prisma.foundryImportOutcome.findMany({ where: { runId: run.id }, orderBy: { createdAt: "asc" } });
  return { id: run.id, status: run.status.toLowerCase(), outcomes: outcomes.map(outcome => ({ candidateId: outcome.candidateId, status: outcome.status, ...(outcome.blockId ? { blockId: outcome.blockId } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) })) };
}
