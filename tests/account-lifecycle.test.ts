import assert from "node:assert/strict";
import { test } from "node:test";
import { AccountLifecycleConflictError, withAccountLifecycleLock } from "../src/lib/account-lifecycle";
import type { PrismaClient } from "@prisma/client";

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
