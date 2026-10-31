import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  runAdminMutation,
  _runAdminMutation,
  createAccount,
  issueRecovery,
  setAccountStatus,
  setAccountRole,
  listTargetSessions,
  revokeTargetSession,
  revokeAllTargetSessions,
  deletionPreview,
  deleteAccount,
  type AdminMutateContext,
  type AdminMutationOptions,
} from "../src/lib/admin-accounts";
import { appendInstallationAuditEvent, recordFailedAdminAttempt, sanitizeAuditDetails } from "../src/lib/admin-audit";
import { tokenHash } from "../src/lib/passwords";
import { isAdminError } from "../src/lib/admin-policy";
import {
  createAdminActor,
  createIsolatedDatabase,
  createTargetUser,
  makeBarrier,
  withTimeout,
} from "./admin-accounts-fixture";

async function successMutate(ctx: AdminMutateContext) {
  await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { name: "Mutated" } });
  return { value: { newName: "Mutated" } };
}

describe("admin-accounts mutation core", () => {
  it("commits a successful mutation, increments accountVersion, and appends a success audit", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.newName, "Mutated");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion + 1);
      assert.equal(after.name, "Mutated");

      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, "STATUS_CHANGE");
      assert.equal(audits[0].outcome, "SUCCESS");
      assert.equal(audits[0].actorType, "WEB_ADMIN");
      assert.equal(audits[0].actorIdSnapshot, actor.userId);
      const details = JSON.parse(audits[0].detailsJson);
      assert.equal(details.targetVersion, after.accountVersion);
      assert.equal(details.previousVersion, before.accountVersion);
    } finally {
      await cleanup();
    }
  });

  it("production entry ignores runtime-cast test hooks", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      let checkpointCalls = 0;
      let appendCalls = 0;
      const options = {
        beforeTransaction: async () => { checkpointCalls += 1; },
        checkpoint: async () => { checkpointCalls += 1; },
        appendAudit: async () => { appendCalls += 1; },
      } as unknown as AdminMutationOptions;

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, options);

      assert.equal(result.ok, true);
      assert.equal(checkpointCalls, 0);
      assert.equal(appendCalls, 0);
      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].outcome, "SUCCESS");
    } finally {
      await cleanup();
    }
  });

  it("rolls back the mutation when audit insertion fails and records a failure audit", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      let appendCalls = 0;
      const failingAppend = async () => {
        appendCalls += 1;
        throw new Error("audit storage unavailable");
      };

      const result = await _runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
        appendAudit: failingAppend as unknown as typeof appendInstallationAuditEvent,
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "INTERNAL_ERROR");

      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      assert.equal(after.name, before.name);

      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].outcome, "FAILED");
      assert.equal(appendCalls, 1);
    } finally {
      await cleanup();
    }
  });

  it("does not write a failure audit for an unauthorized (revoked) actor", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, sessionId } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      await db.authSession.delete({ where: { id: sessionId } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");

      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      assert.equal(after.name, before.name);

      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("rejects a disabled admin inside the transaction and leaves no audit row", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("rejects a demoted admin inside the transaction and leaves no audit row", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      await db.user.update({ where: { id: user.id }, data: { role: "AUTHOR" } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "ROLE_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("rejects an expired admin session inside the transaction and leaves no audit row", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db, { expired: true });
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("allows LOCAL_OPERATOR mutations without a session recheck", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const target = await createTargetUser(db);
      const actor = { type: "LOCAL_OPERATOR" as const, userId: "cli-operator" };

      const result = await runAdminMutation(db, actor, { userId: target.id }, "BOOTSTRAP", successMutate);

      assert.equal(result.ok, true);
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "SUCCESS");
      assert.equal(audit?.actorType, "LOCAL_OPERATOR");
      assert.equal(audit?.actorIdSnapshot, "cli-operator");
    } finally {
      await cleanup();
    }
  });

  it("returns NOT_FOUND and records a rejected audit for a missing target", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const missingId = "00000000-0000-0000-0000-000000000000";

      const result = await runAdminMutation(db, actor, { userId: missingId }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "NOT_FOUND");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: missingId } });
      assert.equal(audit?.outcome, "REJECTED");
      assert.equal(audit?.reasonCode, "NOT_FOUND");
    } finally {
      await cleanup();
    }
  });

  it("returns STALE_ACCOUNT when expectedVersion does not match and leaves target untouched", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      const result = await runAdminMutation(db, actor, { userId: target.id, expectedVersion: 999 }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "STALE_ACCOUNT");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      assert.equal(after.name, before.name);
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
      assert.equal(audit?.reasonCode, "STALE_ACCOUNT");
    } finally {
      await cleanup();
    }
  });

  it("serializes two independent clients on the singleton", async () => {
    const { db: db1, databaseUrl, cleanup: cleanup1 } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const { actor: actor1 } = await createAdminActor(db1);
      const { actor: actor2 } = await createAdminActor(db2);
      const target1 = await createTargetUser(db1);
      const target2 = await createTargetUser(db2);

      const barrier = makeBarrier();
      let firstVersion = 0;
      let secondVersion = 0;

      const first = _runAdminMutation(db1, actor1, { userId: target1.id }, "STATUS_CHANGE", async (ctx) => {
        await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { name: "First" } });
        return { value: {} };
      }, {
        checkpoint: async (ctx) => {
          firstVersion = ctx.singleton.version;
          barrier.a.enter();
          await withTimeout(barrier.a.wait(), 5000);
        },
      });

      await withTimeout(barrier.aEntered(), 5000);

      const second = _runAdminMutation(db2, actor2, { userId: target2.id }, "STATUS_CHANGE", async (ctx) => {
        await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { name: "Second" } });
        return { value: {} };
      }, {
        beforeTransaction: async () => {
          barrier.b.enter();
          await withTimeout(barrier.b.wait(), 5000);
        },
        checkpoint: async (ctx) => {
          secondVersion = ctx.singleton.version;
        },
      });

      // The second transaction is started and released toward the singleton UPDATE
      // before the first lock holder is allowed to continue.
      await withTimeout(barrier.bEntered(), 5000);
      barrier.releaseB();
      barrier.releaseA();
      const [result1, result2] = await Promise.all([first, second]);

      assert.equal(result1.ok, true);
      assert.equal(result2.ok, true);
      assert.ok(firstVersion > 0);
      assert.ok(secondVersion > 0);
      assert.equal(secondVersion, firstVersion + 1);

      const after1 = await db1.user.findUniqueOrThrow({ where: { id: target1.id } });
      const after2 = await db2.user.findUniqueOrThrow({ where: { id: target2.id } });
      assert.equal(after1.name, "First");
      assert.equal(after2.name, "Second");
    } finally {
      await db2.$disconnect();
      await cleanup1();
    }
  });

  it("rejects an actor whose session expires while the mutation holds the singleton lock", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      // Session expires 100 ms after creation.
      const { actor } = await createAdminActor(db, { expiresInMs: 100 });
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      const barrier = makeBarrier();
      const first = _runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
        checkpoint: async () => {
          barrier.a.enter();
          await withTimeout(barrier.a.wait(), 5000);
        },
      });

      await withTimeout(barrier.aEntered(), 5000);
      // Wait past the session expiry while the mutation still holds the lock.
      await new Promise((resolve) => setTimeout(resolve, 300));
      barrier.releaseA();

      const result = await first;

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      assert.equal(after.name, before.name);
      // Unauthorized attempt must not write a failure audit row.
      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 0);
    } finally {
      await cleanup();
    }
  });

  it("serializes LOCAL_OPERATOR mutations on the singleton", async () => {
    const { db: db1, databaseUrl, cleanup: cleanup1 } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const target1 = await createTargetUser(db1);
      const target2 = await createTargetUser(db2);
      const actor1 = { type: "LOCAL_OPERATOR" as const, userId: "operator-a" };
      const actor2 = { type: "LOCAL_OPERATOR" as const, userId: "operator-b" };

      const barrier = makeBarrier();
      let firstVersion = 0;
      let secondVersion = 0;

      const first = _runAdminMutation(db1, actor1, { userId: target1.id }, "BOOTSTRAP", async (ctx) => {
        await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { name: "First" } });
        return { value: {} };
      }, {
        checkpoint: async (ctx) => {
          firstVersion = ctx.singleton.version;
          barrier.a.enter();
          await withTimeout(barrier.a.wait(), 5000);
        },
      });

      await withTimeout(barrier.aEntered(), 5000);

      const second = _runAdminMutation(db2, actor2, { userId: target2.id }, "BOOTSTRAP", async (ctx) => {
        await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { name: "Second" } });
        return { value: {} };
      }, {
        beforeTransaction: async () => {
          barrier.b.enter();
          await withTimeout(barrier.b.wait(), 5000);
        },
        checkpoint: async (ctx) => {
          secondVersion = ctx.singleton.version;
        },
      });

      await withTimeout(barrier.bEntered(), 5000);
      barrier.releaseB();
      barrier.releaseA();
      const [result1, result2] = await Promise.all([first, second]);

      assert.equal(result1.ok, true);
      assert.equal(result2.ok, true);
      assert.ok(firstVersion > 0);
      assert.ok(secondVersion > 0);
      assert.equal(secondVersion, firstVersion + 1);
    } finally {
      await db2.$disconnect();
      await cleanup1();
    }
  });

  it("supports create mode without a pre-existing target row", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const newId = randomUUID();
      const email = `new-${randomUUID()}@example.invalid`;

      const result = await runAdminMutation(
        db,
        actor,
        { userId: newId },
        "ACCOUNT_CREATE",
        async (ctx) => {
          await ctx.tx.user.create({
            data: { id: ctx.target.id, name: "New", email, role: "AUTHOR" },
          });
          return { value: { id: newId }, details: { role: "AUTHOR" } };
        },
        { mode: "create" },
      );

      assert.equal(result.ok, true);
      const created = await db.user.findUniqueOrThrow({ where: { id: newId } });
      assert.equal(created.email, email);
      assert.equal(created.role, "AUTHOR");
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: newId } });
      assert.equal(audit.outcome, "SUCCESS");
      assert.equal(audit.action, "ACCOUNT_CREATE");
      const details = JSON.parse(audit.detailsJson);
      assert.equal(details.role, "AUTHOR");
      assert.equal(details.targetVersion, undefined);
    } finally {
      await cleanup();
    }
  });

  it("supports delete mode without a post-mutate version increment", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const result = await runAdminMutation(
        db,
        actor,
        { userId: target.id },
        "ACCOUNT_DELETE",
        async (ctx) => {
          await ctx.tx.user.delete({ where: { id: ctx.target.id } });
          return { value: {} };
        },
        { mode: "delete" },
      );

      assert.equal(result.ok, true);
      assert.equal(await db.user.count({ where: { id: target.id } }), 0);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit.outcome, "SUCCESS");
      assert.equal(audit.action, "ACCOUNT_DELETE");
    } finally {
      await cleanup();
    }
  });

  it("returns CONCURRENCY_CONFLICT for a transaction-conflict error", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const conflictAppend = async () => {
        const err = new Error("transaction conflict") as Error & { code: string };
        err.code = "P2034";
        throw err;
      };

      const result = await _runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
        appendAudit: conflictAppend as unknown as typeof appendInstallationAuditEvent,
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "CONCURRENCY_CONFLICT");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "FAILED");
      assert.equal(audit?.reasonCode, "CONCURRENCY_CONFLICT");
    } finally {
      await cleanup();
    }
  });

  it("returns INTERNAL_ERROR for a transaction timeout, not a retryable conflict", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const timeoutAppend = async () => {
        const err = new Error("Transaction API error: timeout") as Error & { code: string };
        err.code = "P2028";
        throw err;
      };

      const result = await _runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
        appendAudit: timeoutAppend as unknown as typeof appendInstallationAuditEvent,
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "INTERNAL_ERROR");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "FAILED");
      assert.equal(audit?.reasonCode, "INTERNAL_ERROR");
    } finally {
      await cleanup();
    }
  });

  it("returns a generic error when failure-audit persistence also fails", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const result = await _runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
        appendAudit: (() => { throw new Error("audit down"); }) as unknown as typeof appendInstallationAuditEvent,
        recordFailure: (() => { throw new Error("failure audit down"); }) as unknown as typeof recordFailedAdminAttempt,
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.ok(isAdminError(result.error));
      assert.equal(result.error.code, "INTERNAL_ERROR");
      assert.ok(!result.error.error.includes("audit down"));
      assert.ok(!result.error.error.includes("failure audit down"));
    } finally {
      await cleanup();
    }
  });

  it("returns a generic error when a rejected mutation's failure audit cannot be persisted", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const result = await _runAdminMutation(db, actor, { userId: target.id }, "ACCOUNT_DELETE", async () => ({
        error: "The account has records that prevent deletion.",
        code: "HAS_DURABLE_RECORDS",
        blockers: { revisionIds: ["retained-revision"] },
      }), {
        recordFailure: (() => { throw new Error("failure audit down"); }) as unknown as typeof recordFailedAdminAttempt,
      });
      assert.deepEqual(result, { ok: false, error: { error: "Unable to complete this request.", code: "INTERNAL_ERROR" } });
      assert.equal(await db.installationAuditEvent.count({ where: { targetIdSnapshot: target.id } }), 0);
      assert.ok(await db.user.findUnique({ where: { id: target.id } }));
    } finally {
      await cleanup();
    }
  });

  it("rejects policy violations thrown by the mutate callback and records a rejected audit", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", async () => {
        return { error: "Not allowed.", code: "SELF_CHANGE" };
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "SELF_CHANGE");
      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.accountVersion, before.accountVersion);
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
      assert.equal(audit?.reasonCode, "SELF_CHANGE");
    } finally {
      await cleanup();
    }
  });
});

describe("admin account lifecycle services", () => {
  it("creates an AUTHOR account with a setup link and audits without leaking the token", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const email = `new-author-${randomUUID()}@example.invalid`;

      const result = await createAccount(db, actor, { name: "New Author", email, role: "AUTHOR" });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.ok(result.value.token.length > 0);
      const created = await db.user.findUniqueOrThrow({ where: { id: result.value.userId } });
      assert.equal(created.email, email);
      assert.equal(created.role, "AUTHOR");
      assert.equal(created.passwordHash, null);

      const setup = await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: tokenHash(result.value.token) } });
      assert.equal(setup.userId, created.id);
      assert.ok(setup.expiresAt > new Date(Date.now() + 23 * 60 * 60 * 1000));
      assert.equal(setup.usedAt, null);

      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: created.id } });
      assert.equal(audit.action, "ACCOUNT_CREATE");
      assert.equal(audit.outcome, "SUCCESS");
      assert.ok(!audit.detailsJson.includes(result.value.token));
      assert.ok(!audit.detailsJson.includes(tokenHash(result.value.token)));
      const details = JSON.parse(audit.detailsJson);
      assert.equal(details.role, "AUTHOR");
      assert.equal(details.emailDomain, undefined);
    } finally {
      await cleanup();
    }
  });

  it("creates a PLAYER account with no worlds, memberships, or grants", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const email = `new-player-${randomUUID()}@example.invalid`;

      const result = await createAccount(db, actor, { name: "New Player", email, role: "PLAYER" });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      const created = await db.user.findUniqueOrThrow({ where: { id: result.value.userId } });
      assert.equal(created.role, "PLAYER");
      assert.equal(created.passwordHash, null);

      assert.equal(await db.world.count({ where: { ownerId: created.id } }), 0);
      assert.equal(await db.worldMember.count({ where: { userId: created.id } }), 0);
      assert.equal(await db.audienceGrant.count({ where: { userId: created.id } }), 0);
    } finally {
      await cleanup();
    }
  });

  it("rejects a duplicate normalized email with DUPLICATE_EMAIL", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const email = `dupe-${randomUUID()}@example.invalid`;

      const first = await createAccount(db, actor, { name: "First", email, role: "AUTHOR" });
      assert.equal(first.ok, true);

      const second = await createAccount(db, actor, { name: "Second", email: email.toUpperCase(), role: "AUTHOR" });
      assert.equal(second.ok, false);
      if (second.ok) return;
      assert.equal(second.error.code, "DUPLICATE_EMAIL");

      assert.equal(await db.user.count({ where: { email } }), 1);
      const audit = await db.installationAuditEvent.findFirst({
        where: { action: "ACCOUNT_CREATE", outcome: "REJECTED", reasonCode: "DUPLICATE_EMAIL" },
      });
      assert.equal(audit?.outcome, "REJECTED");
    } finally {
      await cleanup();
    }
  });

  it("rejects invalid creation input before touching the mutation core", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);

      const result = await createAccount(db, actor, { name: "", email: "not-an-email", role: "ADMIN" });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "INVALID_INPUT");
      assert.equal(await db.installationAuditEvent.count({ where: { action: "ACCOUNT_CREATE" } }), 0);
    } finally {
      await cleanup();
    }
  });

  it("issues a recovery link, invalidates earlier unused links, and leaves sessions intact", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const session = await db.authSession.create({
        data: { userId: target.id, tokenHash: tokenHash("session-token"), expiresAt: new Date(Date.now() + 60_000) },
      });

      const old1 = await db.accountSetup.create({
        data: { tokenHash: tokenHash("old-1"), userId: target.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      const old2 = await db.accountSetup.create({
        data: { tokenHash: tokenHash("old-2"), userId: target.id, expiresAt: new Date(Date.now() + 60_000) },
      });
      const expired = await db.accountSetup.create({
        data: { tokenHash: tokenHash("expired"), userId: target.id, expiresAt: new Date(Date.now() - 60_000) },
      });

      const result = await issueRecovery(db, actor, { userId: target.id });

      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.ok(result.value.token.length > 0);

      const refreshedOld1 = await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: old1.tokenHash } });
      const refreshedOld2 = await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: old2.tokenHash } });
      assert.ok(refreshedOld1.usedAt !== null);
      assert.ok(refreshedOld2.usedAt !== null);
      assert.ok((await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: expired.tokenHash } })).usedAt !== null);

      const fresh = await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: tokenHash(result.value.token) } });
      assert.equal(fresh.userId, target.id);
      assert.equal(fresh.usedAt, null);

      const remainingSession = await db.authSession.findUnique({ where: { id: session.id } });
      assert.ok(remainingSession);

      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id, action: "ACCOUNT_RECOVERY" } });
      assert.equal(audit.outcome, "SUCCESS");
      assert.ok(!audit.detailsJson.includes(result.value.token));
      assert.ok(!audit.detailsJson.includes(tokenHash(result.value.token)));
    } finally {
      await cleanup();
    }
  });

  it("rejects recovery for a disabled account with ACCOUNT_DISABLED", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db, { disabled: true });
      const old = await db.accountSetup.create({
        data: { tokenHash: tokenHash("old"), userId: target.id, expiresAt: new Date(Date.now() + 60_000) },
      });

      const result = await issueRecovery(db, actor, { userId: target.id });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "ACCOUNT_DISABLED");

      const refreshed = await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: old.tokenHash } });
      assert.equal(refreshed.usedAt, null);
      const audit = await db.installationAuditEvent.findFirstOrThrow({
        where: { targetIdSnapshot: target.id, action: "ACCOUNT_RECOVERY" },
      });
      assert.equal(audit.outcome, "REJECTED");
      assert.equal(audit.reasonCode, "ACCOUNT_DISABLED");
    } finally {
      await cleanup();
    }
  });

  it("returns NOT_FOUND when recovering a missing account", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const missingId = "00000000-0000-0000-0000-000000000000";

      const result = await issueRecovery(db, actor, { userId: missingId });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "NOT_FOUND");
    } finally {
      await cleanup();
    }
  });

  it("returns STALE_ACCOUNT for recovery when expectedVersion does not match", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const result = await issueRecovery(db, actor, { userId: target.id, expectedVersion: 999 });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "STALE_ACCOUNT");
      assert.equal(await db.accountSetup.count({ where: { userId: target.id } }), 0);
    } finally {
      await cleanup();
    }
  });

  it("rejects creation and recovery after the admin session is revoked", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, sessionId } = await createAdminActor(db);
      const target = await createTargetUser(db);
      await db.authSession.delete({ where: { id: sessionId } });
      const email = `revoked-${randomUUID()}@example.invalid`;
      const created = await createAccount(db, actor, { name: "New", email, role: "AUTHOR" });
      const recovered = await issueRecovery(db, actor, { userId: target.id });
      assert.equal(created.ok, false);
      assert.equal(recovered.ok, false);
      if (!created.ok) assert.equal(created.error.code, "UNAUTHORIZED");
      if (!recovered.ok) assert.equal(recovered.error.code, "UNAUTHORIZED");
      assert.equal(await db.user.count({ where: { email } }), 0);
      assert.equal(await db.accountSetup.count({ where: { userId: target.id } }), 0);
      assert.equal(await db.installationAuditEvent.count(), 0);
    } finally {
      await cleanup();
    }
  });
});

describe("admin account status", () => {
  it("disables credentials without changing world, publication, membership, or grants and does not restore them on enable", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const other = await createTargetUser(db);
      const world = await db.world.create({ data: { title: "Preserved", slug: `status-${randomUUID()}`, ownerId: target.id, isPublic: true } });
      const member = await db.worldMember.create({ data: { worldId: world.id, userId: target.id } });
      const policy = await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "ARTICLE", resourceId: randomUUID(), mode: "PUBLIC" } });
      const grant = await db.audienceGrant.create({ data: { policyId: policy.id, userId: target.id } });
      const expiresAt = new Date(Date.now() + 60_000);
      await db.authSession.create({ data: { userId: target.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const setupHash = tokenHash(randomUUID());
      await db.accountSetup.create({ data: { userId: target.id, tokenHash: setupHash, expiresAt } });
      const subjectHash = tokenHash(randomUUID());
      const issuerHash = tokenHash(randomUUID());
      const otherHash = tokenHash(randomUUID());
      await db.previewSession.createMany({ data: [
        { tokenHash: subjectHash, userId: target.id, issuedById: other.id, worldId: world.id, expiresAt },
        { tokenHash: issuerHash, userId: other.id, issuedById: target.id, worldId: world.id, expiresAt },
        { tokenHash: otherHash, userId: other.id, issuedById: other.id, worldId: world.id, expiresAt },
      ] });
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      const disabled = await setAccountStatus(db, actor, { userId: target.id, expectedVersion: before.accountVersion }, { disabled: true });
      assert.equal(disabled.ok, true);
      const afterDisable = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.ok(afterDisable.disabledAt);
      assert.equal(afterDisable.accountVersion, before.accountVersion + 1);
      assert.equal(await db.authSession.count({ where: { userId: target.id } }), 0);
      assert.ok((await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: setupHash } })).usedAt);
      assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: subjectHash } })).revokedAt);
      assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: issuerHash } })).revokedAt);
      assert.equal((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: otherHash } })).revokedAt, null);
      assert.deepEqual(await db.world.findUniqueOrThrow({ where: { id: world.id } }), world);
      assert.deepEqual(await db.worldMember.findUniqueOrThrow({ where: { id: member.id } }), member);
      assert.deepEqual(await db.audiencePolicy.findUniqueOrThrow({ where: { id: policy.id } }), policy);
      assert.deepEqual(await db.audienceGrant.findUniqueOrThrow({ where: { id: grant.id } }), grant);
      const enabled = await setAccountStatus(db, actor, { userId: target.id, expectedVersion: afterDisable.accountVersion }, { disabled: false });
      assert.equal(enabled.ok, true);
      const afterEnable = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(afterEnable.disabledAt, null);
      assert.equal(afterEnable.accountVersion, before.accountVersion + 2);
      assert.equal(await db.authSession.count({ where: { userId: target.id } }), 0);
      assert.ok((await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: setupHash } })).usedAt);
      assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: subjectHash } })).revokedAt);
      assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: issuerHash } })).revokedAt);
      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id }, orderBy: { createdAt: "asc" } });
      assert.equal(audits.length, 2);
      assert.deepEqual(audits.map((a) => a.reasonCode).sort(), ["DISABLED", "ENABLED"]);
      assert.ok(audits.every((a) => a.action === "STATUS_CHANGE" && a.outcome === "SUCCESS"));
    } finally { await cleanup(); }
  });

  it("rejects self-disable, last-admin disable, invalid input and stale versions", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user } = await createAdminActor(db);
      const self = await setAccountStatus(db, actor, { userId: user.id }, { disabled: true });
      assert.equal(self.ok, false);
      if (!self.ok) assert.equal(self.error.code, "SELF_CHANGE");
      const last = await setAccountStatus(db, { type: "LOCAL_OPERATOR" }, { userId: user.id }, { disabled: true });
      assert.equal(last.ok, false);
      if (!last.ok) assert.equal(last.error.code, "LAST_ADMIN");
      const invalid = await setAccountStatus(db, actor, { userId: user.id }, { disabled: "yes" });
      assert.equal(invalid.ok, false);
      if (!invalid.ok) assert.equal(invalid.error.code, "INVALID_INPUT");
      const target = await createTargetUser(db);
      const stale = await setAccountStatus(db, actor, { userId: target.id, expectedVersion: 99 }, { disabled: true });
      assert.equal(stale.ok, false);
      if (!stale.ok) assert.equal(stale.error.code, "STALE_ACCOUNT");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).disabledAt, null);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).disabledAt, null);
    } finally { await cleanup(); }
  });

  it("serializes opposing admin disables and leaves an active administrator", async () => {
    const { db, databaseUrl, cleanup } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const a = await createAdminActor(db);
      const b = await createAdminActor(db2);
      const barrier = makeBarrier();
      const first = (async () => { barrier.a.enter(); await barrier.a.wait(); return setAccountStatus(db, a.actor, { userId: b.user.id }, { disabled: true }); })();
      const second = (async () => { barrier.b.enter(); await barrier.b.wait(); return setAccountStatus(db2, b.actor, { userId: a.user.id }, { disabled: true }); })();
      await withTimeout(Promise.all([barrier.aEntered(), barrier.bEntered()]), 5000);
      barrier.releaseA();
      barrier.releaseB();
      const results = await Promise.all([first, second]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      assert.equal(await db.user.count({ where: { role: "ADMIN", disabledAt: null } }), 1);
      const rejected = results.find((r) => !r.ok);
      assert.ok(rejected && !rejected.ok);
      assert.equal(rejected.error.code, "UNAUTHORIZED");
    } finally { await db2.$disconnect(); await cleanup(); }
  });

  it("serializes competing local disables and rejects removal of the last admin", async () => {
    const { db, databaseUrl, cleanup } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const a = await createAdminActor(db);
      const b = await createAdminActor(db2);
      const barrier = makeBarrier();
      const actor = { type: "LOCAL_OPERATOR" as const };
      const first = (async () => { barrier.a.enter(); await barrier.a.wait(); return setAccountStatus(db, actor, { userId: a.user.id }, { disabled: true }); })();
      const second = (async () => { barrier.b.enter(); await barrier.b.wait(); return setAccountStatus(db2, actor, { userId: b.user.id }, { disabled: true }); })();
      await withTimeout(Promise.all([barrier.aEntered(), barrier.bEntered()]), 5000);
      barrier.releaseA();
      barrier.releaseB();
      const results = await Promise.all([first, second]);
      assert.equal(results.filter((r) => r.ok).length, 1);
      const rejected = results.find((r) => !r.ok);
      assert.ok(rejected && !rejected.ok);
      assert.equal(rejected.error.code, "LAST_ADMIN");
      assert.equal(await db.user.count({ where: { role: "ADMIN", disabledAt: null } }), 1);
    } finally { await db2.$disconnect(); await cleanup(); }
  });

  it("rechecks an actor disabled by an earlier serialized mutation", async () => {
    const { db, databaseUrl, cleanup } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const { actor, user } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const barrier = makeBarrier();
      const first = _runAdminMutation(db, { type: "LOCAL_OPERATOR" }, { userId: user.id }, "STATUS_CHANGE", async ({ tx }) => {
        await tx.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
        return { value: {} };
      }, { checkpoint: async () => { barrier.a.enter(); await withTimeout(barrier.a.wait(), 5000); } });
      await withTimeout(barrier.aEntered(), 5000);
      const second = setAccountStatus(db2, actor, { userId: target.id }, { disabled: true });
      barrier.releaseA();
      assert.equal((await first).ok, true);
      const result = await second;
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "UNAUTHORIZED");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).disabledAt, null);
      assert.equal(await db.installationAuditEvent.count({ where: { targetIdSnapshot: target.id } }), 0);
    } finally { await db2.$disconnect(); await cleanup(); }
  });
});

describe("admin account roles", () => {
  it("accepts every known source and destination role and increments account versions", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const roles = ["ADMIN", "AUTHOR", "GM", "PLAYER"] as const;
      for (const source of roles) {
        for (const destination of roles) {
          const target = await createTargetUser(db, { role: source });
          const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
          const result = await setAccountRole(db, actor, { userId: target.id, expectedVersion: before.accountVersion }, { role: destination });
          assert.equal(result.ok, true, `${source} → ${destination}`);
          const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
          assert.equal(after.role, destination);
          assert.equal(after.accountVersion, before.accountVersion + 1);
          const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id, action: "ROLE_CHANGE" } });
          assert.equal(audit.outcome, "SUCCESS");
          assert.deepEqual(JSON.parse(audit.detailsJson), { role: destination, previousRole: source, previousVersion: before.accountVersion, targetVersion: after.accountVersion });
        }
      }
    } finally { await cleanup(); }
  });

  it("blocks PLAYER changes for owners of active or archived worlds", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      for (const archived of [false, true]) {
        const target = await createTargetUser(db);
        const world = await db.world.create({ data: { ownerId: target.id, title: "Owned", slug: `role-${randomUUID()}`, deletedAt: archived ? new Date() : null, isPublic: true } });
        const result = await setAccountRole(db, actor, { userId: target.id }, { role: "PLAYER" });
        assert.equal(result.ok, false);
        if (!result.ok) assert.equal(result.error.code, "OWNS_WORLDS");
        assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).role, "AUTHOR");
        assert.deepEqual(await db.world.findUniqueOrThrow({ where: { id: world.id } }), world);
      }
    } finally { await cleanup(); }
  });

  it("invalidates old credentials on promotion, including subject and issuer previews", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const other = await createTargetUser(db);
      const world = await db.world.create({ data: { ownerId: other.id, title: "World", slug: `role-${randomUUID()}` } });
      const recovery = await issueRecovery(db, actor, { userId: target.id });
      assert.ok(recovery.ok);
      const expiresAt = new Date(Date.now() + 60_000);
      await db.authSession.create({ data: { userId: target.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const subject = tokenHash(randomUUID());
      const issuer = tokenHash(randomUUID());
      const unrelated = tokenHash(randomUUID());
      await db.previewSession.createMany({ data: [
        { tokenHash: subject, userId: target.id, issuedById: other.id, worldId: world.id, expiresAt },
        { tokenHash: issuer, userId: other.id, issuedById: target.id, worldId: world.id, expiresAt },
        { tokenHash: unrelated, userId: other.id, issuedById: other.id, worldId: world.id, expiresAt },
      ] });
      const result = await setAccountRole(db, actor, { userId: target.id }, { role: "ADMIN" });
      assert.equal(result.ok, true);
      assert.equal(await db.authSession.count({ where: { userId: target.id } }), 0);
      const oldLink = await db.accountSetup.findUniqueOrThrow({ where: { tokenHash: tokenHash(recovery.value.token) } });
      assert.ok(oldLink.usedAt);
      assert.equal(await db.accountSetup.count({ where: { tokenHash: oldLink.tokenHash, usedAt: null, expiresAt: { gt: new Date() } } }), 0);
      assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: subject } })).revokedAt);
      assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: issuer } })).revokedAt);
      assert.equal((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: unrelated } })).revokedAt, null);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id, action: "ROLE_CHANGE" } });
      assert.ok(!audit.detailsJson.includes(recovery.value.token));
      assert.ok(!audit.detailsJson.includes(oldLink.tokenHash));
    } finally { await cleanup(); }
  });

  it("rejects self-demotion, last-admin demotion, unknown roles and stale versions", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user } = await createAdminActor(db);
      const self = await setAccountRole(db, actor, { userId: user.id }, { role: "GM" });
      assert.ok(!self.ok);
      assert.equal(self.error.code, "SELF_CHANGE");
      const last = await setAccountRole(db, { type: "LOCAL_OPERATOR" }, { userId: user.id }, { role: "GM" });
      assert.ok(!last.ok);
      assert.equal(last.error.code, "LAST_ADMIN");
      const invalid = await setAccountRole(db, actor, { userId: user.id }, { role: "UNKNOWN" });
      assert.ok(!invalid.ok);
      assert.equal(invalid.error.code, "INVALID_ROLE");
      const target = await createTargetUser(db);
      const stale = await setAccountRole(db, actor, { userId: target.id, expectedVersion: 999 }, { role: "GM" });
      assert.ok(!stale.ok);
      assert.equal(stale.error.code, "STALE_ACCOUNT");
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: target.id } })).role, "AUTHOR");
    } finally { await cleanup(); }
  });

  it("serializes a demotion racing a disable and preserves an active admin", async () => {
    const { db, databaseUrl, cleanup } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const a = await createAdminActor(db);
      const b = await createAdminActor(db2);
      const actor = { type: "LOCAL_OPERATOR" as const };
      const barrier = makeBarrier();
      const demote = (async () => { barrier.a.enter(); await barrier.a.wait(); return setAccountRole(db, actor, { userId: a.user.id }, { role: "AUTHOR" }); })();
      const disable = (async () => { barrier.b.enter(); await barrier.b.wait(); return setAccountStatus(db2, actor, { userId: b.user.id }, { disabled: true }); })();
      await withTimeout(Promise.all([barrier.aEntered(), barrier.bEntered()]), 5000);
      barrier.releaseA();
      barrier.releaseB();
      const results = await Promise.all([demote, disable]);
      assert.equal(results.filter((result) => result.ok).length, 1);
      const rejected = results.find((result) => !result.ok);
      assert.ok(rejected && !rejected.ok);
      assert.equal(rejected.error.code, "LAST_ADMIN");
      assert.equal(await db.user.count({ where: { role: "ADMIN", disabledAt: null } }), 1);
    } finally { await db2.$disconnect(); await cleanup(); }
  });
});

describe("admin session services", () => {
  it("lists unexpired sessions and active preview counts without exposing hashes", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user, sessionId } = await createAdminActor(db);
      const other = await createTargetUser(db);
      const world = await db.world.create({ data: { ownerId: other.id, title: "World", slug: `sessions-${randomUUID()}` } });
      const expiresAt = new Date(Date.now() + 60_000);
      const hash = tokenHash(randomUUID());
      await db.authSession.create({ data: { userId: user.id, tokenHash: hash, expiresAt: new Date(Date.now() - 60_000) } });
      await db.previewSession.createMany({ data: [
        { tokenHash: tokenHash(randomUUID()), userId: user.id, issuedById: other.id, worldId: world.id, expiresAt },
        { tokenHash: tokenHash(randomUUID()), userId: other.id, issuedById: user.id, worldId: world.id, expiresAt },
        { tokenHash: tokenHash(randomUUID()), userId: user.id, issuedById: user.id, worldId: world.id, expiresAt },
        { tokenHash: tokenHash(randomUUID()), userId: user.id, worldId: world.id, expiresAt: new Date(Date.now() - 60_000) },
        { tokenHash: tokenHash(randomUUID()), userId: user.id, worldId: world.id, expiresAt, revokedAt: new Date() },
      ] });
      const result = await listTargetSessions(db, actor, user.id);
      assert.ok(result.ok);
      assert.equal(result.value.sessions.length, 1);
      assert.equal(result.value.sessions[0].id, sessionId);
      assert.equal(result.value.sessions[0].current, true);
      assert.equal(result.value.previewSubjectCount, 2);
      assert.equal(result.value.previewIssuerCount, 2);
      assert.ok(!JSON.stringify(result.value).includes(hash));
      assert.ok(!JSON.stringify(result.value).includes("tokenHash"));
      const foreign = await listTargetSessions(db, actor, other.id);
      assert.ok(foreign.ok);
      assert.equal(foreign.value.sessions.length, 0);
      const missing = await listTargetSessions(db, actor, randomUUID());
      assert.ok(!missing.ok);
      assert.equal(missing.error.code, "NOT_FOUND");
      await db.authSession.delete({ where: { id: sessionId } });
      const unauthorized = await listTargetSessions(db, actor, other.id);
      assert.ok(!unauthorized.ok);
      assert.equal(unauthorized.error.code, "UNAUTHORIZED");
    } finally { await cleanup(); }
  });

  it("does not disclose target existence to invalid actors in either read service", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user: admin } = await createAdminActor(db);
      assert.equal(actor.type, "WEB_ADMIN");
      const target = await createTargetUser(db, { disabled: true });
      const otherAdmin = await createTargetUser(db, { role: "ADMIN" });
      const expired = new Date(Date.now() - 60_000);
      const invalidActors = [
        { label: "disabled", change: () => db.user.update({ where: { id: admin.id }, data: { disabledAt: new Date() } }), restore: () => db.user.update({ where: { id: admin.id }, data: { disabledAt: null } }), actor },
        { label: "demoted", change: () => db.user.update({ where: { id: admin.id }, data: { role: "AUTHOR" } }), restore: () => db.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } }), actor },
        { label: "expired", change: () => db.authSession.update({ where: { id: actor.sessionId }, data: { expiresAt: expired } }), restore: () => db.authSession.update({ where: { id: actor.sessionId }, data: { expiresAt: new Date(Date.now() + 60_000) } }), actor },
        { label: "identity mismatch", change: async () => {}, restore: async () => {}, actor: { ...actor, userId: otherAdmin.id } },
        { label: "missing session", change: () => db.authSession.delete({ where: { id: actor.sessionId } }), restore: async () => {}, actor: { ...actor, sessionId: randomUUID() } },
      ];
      for (const invalid of invalidActors) {
        await invalid.change();
        for (const targetId of [target.id, randomUUID()]) {
          const sessions = await listTargetSessions(db, invalid.actor, targetId);
          const preview = await deletionPreview(db, invalid.actor, targetId);
          assert.ok(!sessions.ok, `${invalid.label}: sessions must reject`);
          assert.ok(!preview.ok, `${invalid.label}: preview must reject`);
          assert.equal(sessions.error.code, "UNAUTHORIZED");
          assert.equal(preview.error.code, "UNAUTHORIZED");
          assert.equal("value" in sessions, false);
          assert.equal("value" in preview, false);
        }
        await invalid.restore();
      }
    } finally { await cleanup(); }
  });

  it("single revoke checks ownership and version while preserving other credentials", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const other = await createTargetUser(db);
      const world = await db.world.create({ data: { ownerId: other.id, title: "World", slug: `sessions-${randomUUID()}` } });
      const expiresAt = new Date(Date.now() + 60_000);
      const own = await db.authSession.create({ data: { userId: target.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const remaining = await db.authSession.create({ data: { userId: target.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const foreign = await db.authSession.create({ data: { userId: other.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const preview = await db.previewSession.create({ data: { tokenHash: tokenHash(randomUUID()), userId: target.id, worldId: world.id, expiresAt } });
      const mismatch = await revokeTargetSession(db, actor, { userId: target.id }, foreign.id);
      assert.ok(!mismatch.ok);
      assert.equal(mismatch.error.code, "NOT_FOUND");
      const stale = await revokeTargetSession(db, actor, { userId: target.id, expectedVersion: 999 }, own.id);
      assert.ok(!stale.ok);
      assert.equal(stale.error.code, "STALE_ACCOUNT");
      const result = await revokeTargetSession(db, actor, { userId: target.id, expectedVersion: 0 }, own.id);
      assert.ok(result.ok);
      assert.equal(result.value.revoked, 1);
      assert.equal(await db.authSession.findUnique({ where: { id: own.id } }), null);
      assert.ok(await db.authSession.findUnique({ where: { id: remaining.id } }));
      assert.ok(await db.authSession.findUnique({ where: { id: foreign.id } }));
      assert.deepEqual(await db.previewSession.findUniqueOrThrow({ where: { tokenHash: preview.tokenHash } }), preview);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id, action: "SESSION_REVOKE", outcome: "SUCCESS" } });
      assert.ok(!audit.detailsJson.includes(own.tokenHash));
      assert.ok(!JSON.stringify(result.value).includes(own.tokenHash));
    } finally { await cleanup(); }
  });

  it("revoke-all counts each affected preview once and permits self revocation", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user, sessionId } = await createAdminActor(db);
      const other = await createTargetUser(db);
      const world = await db.world.create({ data: { ownerId: other.id, title: "World", slug: `sessions-${randomUUID()}` } });
      const expiresAt = new Date(Date.now() + 60_000);
      const extra = await db.authSession.create({ data: { userId: user.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const subject = tokenHash(randomUUID());
      const issuer = tokenHash(randomUUID());
      const both = tokenHash(randomUUID());
      const unrelated = tokenHash(randomUUID());
      await db.previewSession.createMany({ data: [
        { tokenHash: subject, userId: user.id, issuedById: other.id, worldId: world.id, expiresAt },
        { tokenHash: issuer, userId: other.id, issuedById: user.id, worldId: world.id, expiresAt },
        { tokenHash: both, userId: user.id, issuedById: user.id, worldId: world.id, expiresAt },
        { tokenHash: unrelated, userId: other.id, issuedById: other.id, worldId: world.id, expiresAt },
      ] });
      const result = await revokeAllTargetSessions(db, actor, { userId: user.id, expectedVersion: 0 });
      assert.ok(result.ok);
      assert.deepEqual(result.value, { sessionCount: 2, previewCount: 3 });
      assert.equal(await db.authSession.findUnique({ where: { id: sessionId } }), null);
      assert.equal(await db.authSession.findUnique({ where: { id: extra.id } }), null);
      for (const hash of [subject, issuer, both]) assert.ok((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt);
      assert.equal((await db.previewSession.findUniqueOrThrow({ where: { tokenHash: unrelated } })).revokedAt, null);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: user.id, action: "SESSION_REVOKE_ALL" } });
      assert.equal(audit.outcome, "SUCCESS");
      assert.equal(JSON.parse(audit.detailsJson).previewCount, 3);
      assert.ok(!audit.detailsJson.includes(extra.tokenHash));
      assert.ok(!JSON.stringify(result.value).includes(extra.tokenHash));
    } finally { await cleanup(); }
  });

  it("permits revoking the current session and rejects stale revoke-all", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user, sessionId } = await createAdminActor(db);
      const stale = await revokeAllTargetSessions(db, actor, { userId: user.id, expectedVersion: 999 });
      assert.ok(!stale.ok);
      assert.equal(stale.error.code, "STALE_ACCOUNT");
      assert.ok(await db.authSession.findUnique({ where: { id: sessionId } }));
      const result = await revokeTargetSession(db, actor, { userId: user.id, expectedVersion: 0 }, sessionId);
      assert.ok(result.ok);
      assert.equal(await db.authSession.findUnique({ where: { id: sessionId } }), null);
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).accountVersion, 1);
    } finally { await cleanup(); }
  });
});

describe("admin account deletion", () => {
  it("blocks active and archived owned worlds with preview identifiers", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      for (const archived of [false, true]) {
        const user = await createTargetUser(db, { disabled: true });
        const world = await db.world.create({ data: { ownerId: user.id, title: "Owned", slug: `delete-${randomUUID()}`, deletedAt: archived ? new Date() : null } });
        const preview = await deletionPreview(db, actor, user.id);
        assert.ok(preview.ok);
        assert.equal(preview.value.allowed, false);
        assert.equal(preview.value.worlds[0].id, world.id);
        const result = await deleteAccount(db, actor, { userId: user.id, expectedVersion: 0 }, { confirmEmail: user.email, backupAcknowledged: true });
        assert.ok(!result.ok);
        assert.equal(result.error.code, "OWNS_WORLDS");
        assert.ok(await db.world.findUnique({ where: { id: world.id } }));
      }
    } finally { await cleanup(); }
  });

  it("blocks durable revisions, foundry history and every nonterminal or unknown import state", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user: owner } = await createAdminActor(db);
      const user = await createTargetUser(db, { disabled: true });
      const world = await db.world.create({ data: { ownerId: owner.id, title: "Other", slug: `delete-${randomUUID()}` } });
      const article = await db.article.create({ data: { worldId: world.id, title: "Article", slug: "article" } });
      const revision = await db.articleRevision.create({ data: { articleId: article.id, userId: user.id, title: "Article", slug: "article", publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT", articleVersionAtSave: 1 } });
      const run = await db.foundryImportRun.create({ data: { worldId: world.id, authorId: user.id, previewId: randomUUID(), idempotencyKey: randomUUID(), requestHash: "hash", outcomesJson: "[]" } });
      const imports = await Promise.all(["PENDING", "RUNNING", "RECOVERING", "UNKNOWN_FUTURE_STATE"].map((status) => db.worldTransferImport.create({ data: { ownerId: user.id, requestKey: randomUUID(), payloadHash: "hash", payloadJson: "{}", status } })));
      const preview = await deletionPreview(db, actor, user.id);
      assert.ok(preview.ok);
      assert.deepEqual(preview.value.revisionIds, [revision.id]);
      assert.deepEqual(preview.value.foundryImportIds, [run.id]);
      assert.deepEqual(preview.value.pendingImportIds, imports.map(({ id }) => id).sort());
      for (const remove of [async () => db.articleRevision.delete({ where: { id: revision.id } }), async () => db.foundryImportRun.delete({ where: { id: run.id } }), ...imports.map(({ id }) => async () => db.worldTransferImport.delete({ where: { id } }))]) {
        const result = await deleteAccount(db, actor, { userId: user.id, expectedVersion: 0 }, { confirmEmail: user.email, backupAcknowledged: true });
        assert.ok(!result.ok);
        assert.equal(result.error.code, "HAS_DURABLE_RECORDS");
        await remove();
      }
      assert.deepEqual(await db.article.findUniqueOrThrow({ where: { id: article.id } }), article);
    } finally { await cleanup(); }
  });

  it("deletes a disabled player, cascades credentials and retains unrelated content and audit", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user: admin } = await createAdminActor(db);
      const user = await createTargetUser(db, { role: "PLAYER", disabled: true });
      const world = await db.world.create({ data: { ownerId: admin.id, title: "Other", slug: `delete-${randomUUID()}`, isPublic: true } });
      const member = await db.worldMember.create({ data: { worldId: world.id, userId: user.id } });
      const policy = await db.audiencePolicy.create({ data: { worldId: world.id, resourceKind: "ARTICLE", resourceId: randomUUID(), createdById: user.id } });
      const grant = await db.audienceGrant.create({ data: { policyId: policy.id, userId: admin.id, grantedById: user.id } });
      const invitation = await db.playerInvitation.create({ data: { worldId: world.id, email: user.email, tokenHash: tokenHash(randomUUID()), expiresAt: new Date(Date.now() + 60_000), issuedById: user.id } });
      const accessAudit = await db.accessAuditEvent.create({ data: { worldId: world.id, actorId: user.id, action: "TEST" } });
      const issuedPreviewHash = tokenHash(randomUUID());
      await db.previewSession.create({ data: { tokenHash: issuedPreviewHash, userId: admin.id, issuedById: user.id, worldId: world.id, expiresAt: new Date(Date.now() + 60_000) } });
      const foundryPreview = await db.foundryPreview.create({ data: { worldId: world.id, authorId: user.id, metadataJson: "{}", candidatesJson: "[]", expiresAt: new Date(Date.now() + 60_000) } });
      const terminalImports = await Promise.all(["COMPLETED", "FAILED"].map((status) => db.worldTransferImport.create({ data: { ownerId: user.id, requestKey: randomUUID(), payloadHash: "hash", payloadJson: "{}", status } })));
      const expiresAt = new Date(Date.now() + 60_000);
      await db.authSession.create({ data: { userId: user.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      await db.accountSetup.create({ data: { userId: user.id, tokenHash: tokenHash(randomUUID()), expiresAt } });
      const preview = await deletionPreview(db, actor, user.id);
      assert.ok(preview.ok && preview.value.allowed);
      const result = await deleteAccount(db, actor, { userId: user.id, expectedVersion: 0 }, { confirmEmail: user.email, backupAcknowledged: true });
      assert.ok(result.ok);
      assert.equal(await db.user.findUnique({ where: { id: user.id } }), null);
      assert.equal(await db.worldMember.findUnique({ where: { id: member.id } }), null);
      assert.ok(await db.audienceGrant.findUnique({ where: { id: grant.id } }));
      assert.equal(await db.authSession.count({ where: { userId: user.id } }), 0);
      assert.equal(await db.accountSetup.count({ where: { userId: user.id } }), 0);
      assert.equal((await db.audiencePolicy.findUniqueOrThrow({ where: { id: policy.id } })).createdById, null);
      const survivingGrant = await db.audienceGrant.findFirstOrThrow({ where: { policyId: policy.id } });
      assert.equal(survivingGrant.grantedById, null);
      assert.equal((await db.playerInvitation.findUniqueOrThrow({ where: { id: invitation.id } })).issuedById, null);
      assert.equal((await db.accessAuditEvent.findUniqueOrThrow({ where: { id: accessAudit.id } })).actorId, null);
      const survivingPreview = await db.previewSession.findUniqueOrThrow({ where: { tokenHash: issuedPreviewHash } });
      assert.equal(survivingPreview.issuedById, null);
      assert.ok(survivingPreview.revokedAt);
      assert.equal(await db.foundryPreview.findUnique({ where: { id: foundryPreview.id } }), null);
      for (const record of terminalImports) assert.equal(await db.worldTransferImport.findUnique({ where: { id: record.id } }), null);
      assert.deepEqual(await db.world.findUniqueOrThrow({ where: { id: world.id } }), world);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: user.id, action: "ACCOUNT_DELETE" } });
      assert.equal(audit.actorIdSnapshot, admin.id);
      assert.equal(audit.outcome, "SUCCESS");
    } finally { await cleanup(); }
  });

  it("requires disabled status, current version, exact email and acknowledgement", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const user = await createTargetUser(db);
      for (const [target, body, code] of [
        [{ userId: user.id, expectedVersion: 0 }, { confirmEmail: user.email, backupAcknowledged: true }, "INVALID_INPUT"],
        [{ userId: user.id, expectedVersion: 0 }, { confirmEmail: user.email, backupAcknowledged: false }, "INVALID_INPUT"],
        [{ userId: user.id, expectedVersion: 999 }, { confirmEmail: user.email, backupAcknowledged: true }, "STALE_ACCOUNT"],
      ] as const) {
        const result = await deleteAccount(db, actor, target, body);
        assert.ok(!result.ok);
        assert.equal(result.error.code, code);
      }
      await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });
      const mismatch = await deleteAccount(db, actor, { userId: user.id, expectedVersion: 0 }, { confirmEmail: "wrong@example.invalid", backupAcknowledged: true });
      assert.ok(!mismatch.ok);
      assert.equal(mismatch.error.code, "INVALID_INPUT");
      assert.ok(await db.user.findUnique({ where: { id: user.id } }));
    } finally { await cleanup(); }
  });

  it("recomputes ownership blockers after an independent world writer without a version bump", async () => {
    const { db, databaseUrl, cleanup } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const { actor } = await createAdminActor(db);
      const user = await createTargetUser(db, { disabled: true });
      const before = await deletionPreview(db, actor, user.id);
      assert.ok(before.ok);
      const version = before.value.accountVersion;
      const created = await db2.world.create({ data: { ownerId: user.id, title: "Independent writer", slug: `delete-${randomUUID()}` } });
      assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).accountVersion, version);
      const result = await deleteAccount(db, actor, { userId: user.id, expectedVersion: version }, { confirmEmail: user.email, backupAcknowledged: true });
      assert.ok(!result.ok);
      assert.equal(result.error.code, "OWNS_WORLDS");
      assert.ok(await db.user.findUnique({ where: { id: user.id } }));
      assert.ok(await db.world.findUnique({ where: { id: created.id } }));
      const after = await deletionPreview(db, actor, user.id);
      assert.ok(after.ok);
      assert.equal(after.value.accountVersion, version);
      assert.deepEqual(after.value.worlds.map(({ id }) => id), [created.id]);
    } finally { await db2.$disconnect(); await cleanup(); }
  });
});

describe("admin-audit sanitization", () => {
  it("drops disallowed keys from audit details", async () => {
    const { cleanup } = await createIsolatedDatabase();
    try {
      const adversarial = {
        exception: "TypeError: Cannot read properties of undefined (reading 'tokenHash')",
        sessionId: "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0",
        cookieValue: "wf_session=eyJhbGciOi",
        requestBody: "email=admin@example.com&password=hunter2",
        stack: "at runAdminMutation (src/lib/admin-accounts.ts:85:5)",
        tokenHash: "a".repeat(64),
        setupUrl: "https://example.com/setup#token=secret",
      };
      const sanitized = sanitizeAuditDetails("STATUS_CHANGE", adversarial);
      for (const key of Object.keys(adversarial)) {
        assert.equal((sanitized as Record<string, unknown>)[key], undefined, `key ${key} must be dropped`);
      }
    } finally {
      await cleanup();
    }
  });

  it("keeps only action-allowlisted detail keys", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const tokenLike = randomBytes(32).toString("base64url");

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", async () => {
        return {
          value: {},
          details: {
            reason: "reviewed",
            note: "ok",
            leaked: tokenLike,
          },
        };
      });

      assert.equal(result.ok, true);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id } });
      const stored = JSON.parse(audit.detailsJson);
      assert.equal(stored.reason, "reviewed");
      assert.equal(stored.note, undefined);
      assert.equal(stored.leaked, undefined);
    } finally {
      await cleanup();
    }
  });
});
