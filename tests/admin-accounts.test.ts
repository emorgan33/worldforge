import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import {
  runAdminMutation,
  _runAdminMutation,
  createAccount,
  issueRecovery,
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
