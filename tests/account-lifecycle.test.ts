import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountLifecycleConflictError, withAccountLifecycleLock } from "../src/lib/account-lifecycle";
import type { PrismaClient } from "@prisma/client";
import { createLogoutPost } from "../src/lib/logout-route";
import { createDurableImportRequest } from "../src/lib/world-import-request";

test("lifecycle transactions expose known database conflicts as retryable without replaying work", async () => {
  let transactionCalls = 0;
  const db = {
    $transaction: async () => {
      transactionCalls++;
      throw Object.assign(new Error("transaction conflict"), { code: "P2034" });
    },
  } as unknown as PrismaClient;

  await assert.rejects(
    withAccountLifecycleLock(db, async () => "must not run"),
    error => error instanceof AccountLifecycleConflictError,
  );
  assert.equal(transactionCalls, 1, "the helper reports a retryable conflict but never retries the operation itself");
});

test("logout route returns a retryable response for lifecycle conflicts", async () => {
  const post = createLogoutPost(async () => { throw new AccountLifecycleConflictError(); });
  const previousOrigin = process.env.WORLDFORGE_ORIGIN;
  process.env.WORLDFORGE_ORIGIN = "http://localhost";
  try {
    const response = await post(new Request("http://localhost/api/auth/logout", {
      method: "POST",
      headers: { Host: "localhost", Origin: "http://localhost" },
    }));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "2");
  } finally {
    if (previousOrigin === undefined) delete process.env.WORLDFORGE_ORIGIN;
    else process.env.WORLDFORGE_ORIGIN = previousOrigin;
  }
});

test("durable import creation does not hide lifecycle conflicts behind recovery lookup", async () => {
  let lookedUp = false;
  await assert.rejects(
    createDurableImportRequest(
      async () => { throw new AccountLifecycleConflictError(); },
      async () => { lookedUp = true; return null; },
    ),
    error => error instanceof AccountLifecycleConflictError,
  );
  assert.equal(lookedUp, false);
});
