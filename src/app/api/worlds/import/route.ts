import { withAuthor } from "@/lib/auth";
import { AccessError } from "@/lib/auth";
import { NextResponse } from "next/server";
import { importWorldTransfer } from "@/lib/world-transfer-execution";
import { readWorldTransferJson } from "@/lib/world-transfer-adapters";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

const activeImports = new Set<string>();

function requestKey(request: Request) {
  const value = request.headers.get("Idempotency-Key");
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function hashPayload(body: unknown) {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
  return createHash("sha256").update(JSON.stringify(stable(body))).digest("hex");
}

export const POST = withAuthor({ target: "account" }, async (request: Request, _context, { user }) => {
  let activeRecordId: string | undefined;
  const ownerId = user.id;
  let leaseTimer: ReturnType<typeof setInterval> | undefined;
  let executionSucceeded = false;
  let executionResult: Awaited<ReturnType<typeof importWorldTransfer>> | undefined;
  let recoveryAttempt = false;
  try {
    const suppliedKey = requestKey(request);
    if (request.headers.has("Idempotency-Key") && !suppliedKey) return NextResponse.json({ error: "Idempotency-Key must be a UUID." }, { status: 400 });
    const key = suppliedKey ?? randomUUID();

    let body: unknown;
    try { body = await readWorldTransferJson(request); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid JSON file" }, { status: 400 }); }
    const payloadJson = JSON.stringify(body);
    const payloadHash = hashPayload(body);
    let record = await prisma.worldTransferImport.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey: key } } });
    if (record && record.payloadHash !== payloadHash) return NextResponse.json({ error: "This idempotency key was already used for different import content." }, { status: 409 });
    if (record?.status === "COMPLETED" && record.resultJson) return NextResponse.json(JSON.parse(record.resultJson));
    if (record && activeImports.has(record.id)) return NextResponse.json({ error: "This import request is still running. Check its status shortly." }, { status: 409, headers: { "Retry-After": "2" } });
    let recovering = false;
    if (!record) {
      try {
        record = await prisma.worldTransferImport.create({ data: { id: randomUUID(), ownerId, requestKey: key, payloadHash, payloadJson, status: "PENDING" } });
      } catch {
        record = await prisma.worldTransferImport.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey: key } } });
      }
    }
    if (!record) throw new Error("Could not establish durable import request");
    if (record.payloadHash !== payloadHash) return NextResponse.json({ error: "This idempotency key was already used for different import content." }, { status: 409 });
    if (record.status === "COMPLETED" && record.resultJson) return NextResponse.json(JSON.parse(record.resultJson));
    if (activeImports.has(record.id)) return NextResponse.json({ error: "This import request is still running. Check its status shortly." }, { status: 409, headers: { "Retry-After": "2" } });
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
    if (record.status === "RECOVERY_REQUIRED") {
      const claim = await prisma.worldTransferImport.updateMany({ where: { id: record.id, status: "RECOVERY_REQUIRED" }, data: { status: "RECOVERING" } });
      if (claim.count !== 1) return NextResponse.json({ error: "This import request is being recovered. Check its status shortly." }, { status: 409, headers: { "Retry-After": "2" } });
      recovering = true;
      recoveryAttempt = true;
    } else if (record.status === "RUNNING" || record.status === "RECOVERING") {
      if (record.updatedAt > staleBefore) return NextResponse.json({ error: "This import request is still running. Retry after its recovery lease expires." }, { status: 409, headers: { "Retry-After": "60" } });
      const claim = await prisma.worldTransferImport.updateMany({ where: { id: record.id, status: record.status, updatedAt: record.updatedAt }, data: { status: "RECOVERING" } });
      if (claim.count !== 1) return NextResponse.json({ error: "This import request is being recovered. Check its status shortly." }, { status: 409, headers: { "Retry-After": "2" } });
      recovering = true;
      recoveryAttempt = true;
    } else {
      const claim = await prisma.worldTransferImport.updateMany({ where: { id: record.id, status: record.status }, data: { status: "RUNNING", error: null, payloadJson } });
      if (claim.count !== 1) return NextResponse.json({ error: "This import request is already being processed." }, { status: 409, headers: { "Retry-After": "2" } });
    }
    activeImports.add(record.id);
    activeRecordId = record.id;
    const runningStatus = recovering ? "RECOVERING" : "RUNNING";
    leaseTimer = setInterval(() => { void prisma.worldTransferImport.update({ where: { id: record!.id }, data: { status: runningStatus } }).catch(() => {}); }, 30_000);
    const result = await importWorldTransfer(body, ownerId, { requestId: record.id, payloadHash, recover: !!recovering });
    if (!result.success) {
      clearInterval(leaseTimer);
      await prisma.worldTransferImport.update({ where: { id: record.id }, data: { status: "FAILED", error: result.error } });
      activeImports.delete(record.id);
      activeRecordId = undefined;
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    executionSucceeded = true;
    executionResult = result;
    clearInterval(leaseTimer);
    await prisma.worldTransferImport.update({ where: { id: record.id }, data: { status: "COMPLETED", resultJson: JSON.stringify(result) } });
    activeImports.delete(record.id);
    activeRecordId = undefined;
    return NextResponse.json(result);
  } catch (error) {
    if (leaseTimer) clearInterval(leaseTimer);
    if (activeRecordId) {
      const recoveryRequired = recoveryAttempt || executionSucceeded || (error instanceof AggregateError && /rollback cleanup was incomplete/i.test(error.message));
      await prisma.worldTransferImport.updateMany({
        where: { id: activeRecordId, status: { in: ["RUNNING", "RECOVERING"] } },
        data: executionSucceeded && executionResult?.success
          ? { status: "COMPLETED", resultJson: JSON.stringify(executionResult), error: null }
          : { status: recoveryRequired ? "RECOVERY_REQUIRED" : "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Import failed" },
      }).catch(() => {});
      activeImports.delete(activeRecordId);
    }
    const key = requestKey(request);
    if (key) {
      const record = await prisma.worldTransferImport.findUnique({ where: { ownerId_requestKey: { ownerId, requestKey: key } } }).catch(() => null);
      if (record) activeImports.delete(record.id);
    }
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("Failed to import world:", error);
    return NextResponse.json({ error: "Failed to import world" }, { status: 500 });
  }
});

export const GET = withAuthor({ target: "account" }, async (request: Request, _context, { user }) => {
  try {
    const key = requestKey(request);
    if (!key) return NextResponse.json({ error: "A valid Idempotency-Key UUID is required." }, { status: 400 });
    const record = await prisma.worldTransferImport.findUnique({ where: { ownerId_requestKey: { ownerId: user.id, requestKey: key } } });
    if (!record) return NextResponse.json({ error: "Import request not found." }, { status: 404 });
    return NextResponse.json({ status: record.status, ...(record.resultJson ? { result: JSON.parse(record.resultJson) } : {}), ...(record.error ? { error: record.error } : {}) });
  } catch (error) {
    if (error instanceof AccessError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Could not load import status." }, { status: 500 });
  }
});
