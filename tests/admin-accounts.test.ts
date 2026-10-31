import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { runAdminMutation, type AdminMutateContext } from "../src/lib/admin-accounts";
import { appendInstallationAuditEvent, recordFailedAdminAttempt, sanitizeAuditDetails } from "../src/lib/admin-audit";
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

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
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

  it("records a rejected audit when the actor session is revoked before the transaction", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, sessionId } = await createAdminActor(db);
      const target = await createTargetUser(db);
      await db.authSession.delete({ where: { id: sessionId } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");

      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].outcome, "REJECTED");
      assert.equal(audits[0].reasonCode, "UNAUTHORIZED");
      assert.equal(audits[0].actorIdSnapshot, actor.userId);
    } finally {
      await cleanup();
    }
  });

  it("rejects a disabled admin inside the transaction", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user } = await createAdminActor(db);
      const target = await createTargetUser(db);
      await db.user.update({ where: { id: user.id }, data: { disabledAt: new Date() } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
    } finally {
      await cleanup();
    }
  });

  it("rejects a demoted admin inside the transaction", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor, user } = await createAdminActor(db);
      const target = await createTargetUser(db);
      await db.user.update({ where: { id: user.id }, data: { role: "AUTHOR" } });

      const result = await runAdminMutation(db, actor, { userId: target.id }, "ROLE_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
    } finally {
      await cleanup();
    }
  });

  it("rejects an expired admin session inside the transaction", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db, { expired: true });
      const target = await createTargetUser(db);

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "UNAUTHORIZED");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
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

  it("returns STALE_ACCOUNT when expectedVersion does not match", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const result = await runAdminMutation(db, actor, { userId: target.id, expectedVersion: 999 }, "STATUS_CHANGE", successMutate);

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "STALE_ACCOUNT");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
      assert.equal(audit?.reasonCode, "STALE_ACCOUNT");
    } finally {
      await cleanup();
    }
  });

  it("serializes two independent clients on the singleton", async () => {
    const { db: db1, databaseUrl, cleanup: cleanup1 } = await createIsolatedDatabase();
    const db2 = new (await import("@prisma/client")).PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const { actor: actor1 } = await createAdminActor(db1);
      const { actor: actor2 } = await createAdminActor(db2);
      const target1 = await createTargetUser(db1);
      const target2 = await createTargetUser(db2);

      const barrier = makeBarrier();
      let firstVersion: number | null = null;
      let secondVersion: number | null = null;

      const first = runAdminMutation(db1, actor1, { userId: target1.id }, "STATUS_CHANGE", async (ctx) => {
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

      const second = runAdminMutation(db2, actor2, { userId: target2.id }, "STATUS_CHANGE", async (ctx) => {
        await ctx.tx.user.update({ where: { id: ctx.target.id }, data: { name: "Second" } });
        return { value: {} };
      }, {
        checkpoint: async (ctx) => {
          secondVersion = ctx.singleton.version;
          barrier.b.enter();
          await withTimeout(barrier.b.wait(), 5000);
        },
      });

      barrier.releaseA();
      await withTimeout(barrier.bEntered(), 5000);
      barrier.releaseB();

      const [result1, result2] = await Promise.all([first, second]);

      assert.equal(result1.ok, true);
      assert.equal(result2.ok, true);
      assert.equal(typeof firstVersion, "number");
      assert.equal(typeof secondVersion, "number");
      assert.equal(secondVersion, (firstVersion as number) + 1);

      const after1 = await db1.user.findUniqueOrThrow({ where: { id: target1.id } });
      const after2 = await db2.user.findUniqueOrThrow({ where: { id: target2.id } });
      assert.equal(after1.name, "First");
      assert.equal(after2.name, "Second");
    } finally {
      await db2.$disconnect();
      await cleanup1();
    }
  });

  it("returns a generic error when failure-audit persistence also fails", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", successMutate, {
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

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", async () => {
        return { error: "Not allowed.", code: "SELF_CHANGE" };
      });

      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "SELF_CHANGE");
      const audit = await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: target.id } });
      assert.equal(audit?.outcome, "REJECTED");
      assert.equal(audit?.reasonCode, "SELF_CHANGE");
    } finally {
      await cleanup();
    }
  });
});

describe("admin-audit sanitization", () => {
  it("removes sensitive keys and redacts token-like strings from audit details", async () => {
    const { cleanup } = await createIsolatedDatabase();
    try {
      const sensitive = {
        token: "abc123",
        body: "request body text",
        hash: "x".repeat(64),
        password: "secret",
        safeKey: "visible",
        nested: { tokenHash: "yyy", bearer: "Bearer abc" },
        tokenUrl: "https://example.com/setup#token=abc",
      };
      const sanitized = sanitizeAuditDetails(sensitive);
      assert.equal((sanitized as Record<string, unknown>).token, undefined);
      assert.equal((sanitized as Record<string, unknown>).body, undefined);
      assert.equal((sanitized as Record<string, unknown>).hash, undefined);
      assert.equal((sanitized as Record<string, unknown>).password, undefined);
      assert.equal((sanitized as Record<string, unknown>).safeKey, "visible");
      assert.equal((sanitized.nested as Record<string, unknown>).tokenHash, undefined);
      assert.equal((sanitized.nested as Record<string, unknown>).bearer, "[REDACTED]");
      assert.equal(sanitized.tokenUrl, "[REDACTED]");
    } finally {
      await cleanup();
    }
  });

  it("stores only sanitized details in audit rows", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const { actor } = await createAdminActor(db);
      const target = await createTargetUser(db);
      const tokenLike = randomBytes(32).toString("base64url");

      const result = await runAdminMutation(db, actor, { userId: target.id }, "STATUS_CHANGE", async () => {
        return { value: {}, details: { note: "ok", leaked: tokenLike, hash: "h".repeat(64) } };
      });

      assert.equal(result.ok, true);
      const audit = await db.installationAuditEvent.findFirstOrThrow({ where: { targetIdSnapshot: target.id } });
      const stored = JSON.parse(audit.detailsJson);
      assert.equal(stored.note, "ok");
      assert.equal(stored.leaked, "[REDACTED]");
      assert.equal(stored.hash, undefined);
    } finally {
      await cleanup();
    }
  });
});


