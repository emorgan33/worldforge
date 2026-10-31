import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaClient } from "@prisma/client";
import { bootstrapAdmin, localRecoverAccount } from "../src/lib/admin-accounts";
import { tokenHash } from "../src/lib/passwords";
import { createIsolatedDatabase, createAdminActor, createTargetUser } from "./admin-accounts-fixture";



describe("bootstrapAdmin", () => {
  it("promotes an active non-admin to ADMIN when no active admin exists", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const target = await createTargetUser(db, { role: "AUTHOR" });
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(before.role, "AUTHOR");

      const result = await bootstrapAdmin(db, target.email);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.role, "ADMIN");

      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.role, "ADMIN");
      assert.equal(after.accountVersion, before.accountVersion + 1);

      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id, action: "BOOTSTRAP" } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].outcome, "SUCCESS");
      assert.equal(audits[0].actorType, "LOCAL_OPERATOR");
      const details = JSON.parse(audits[0].detailsJson);
      assert.equal(details.token, undefined);
      assert.equal(details.passwordHash, undefined);
    } finally {
      await cleanup();
    }
  });

  it("rejects bootstrap when an active admin already exists", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      await createAdminActor(db);
      const target = await createTargetUser(db, { role: "AUTHOR" });
      const result = await bootstrapAdmin(db, target.email);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "LAST_ADMIN");
      const user = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(user.role, "AUTHOR");
    } finally {
      await cleanup();
    }
  });

  it("rejects bootstrap of a disabled account", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const target = await createTargetUser(db, { role: "AUTHOR", disabled: true });
      const result = await bootstrapAdmin(db, target.email);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "ACCOUNT_DISABLED");
      const user = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(user.role, "AUTHOR");
    } finally {
      await cleanup();
    }
  });

  it("leaves exactly one active admin when two bootstraps race", async () => {
    const { db, databaseUrl, cleanup } = await createIsolatedDatabase();
    const db2 = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      const a = await createTargetUser(db, { role: "AUTHOR" });
      const b = await createTargetUser(db, { role: "AUTHOR" });

      const first = bootstrapAdmin(db, a.email);
      const second = bootstrapAdmin(db2, b.email);

      const [r1, r2] = await Promise.all([first, second]);
      const successes = [r1, r2].filter((r) => r.ok);
      assert.equal(successes.length, 1, "exactly one bootstrap may succeed");

      const activeAdmins = await db.user.count({ where: { role: "ADMIN", disabledAt: null } });
      assert.equal(activeAdmins, 1);
    } finally {
      await db2.$disconnect();
      await cleanup();
    }
  });

  it("invalidates target sessions, setup links, and preview capabilities", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const target = await createTargetUser(db, { role: "AUTHOR" });
      const other = await createTargetUser(db, { role: "AUTHOR" });
      const world = await db.world.create({
        data: { ownerId: other.id, title: "Preview world", slug: `preview-world-${other.id}` },
      });
      const token = "test-session-token-1234567890123456789012345";
      await db.authSession.create({ data: { userId: target.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + 60_000) } });
      await db.accountSetup.create({ data: { userId: target.id, tokenHash: tokenHash("setup-token-1"), expiresAt: new Date(Date.now() + 60_000) } });
      await db.previewSession.create({
        data: { userId: target.id, worldId: world.id, issuedById: other.id, tokenHash: tokenHash("preview-1"), expiresAt: new Date(Date.now() + 60_000) },
      });

      const result = await bootstrapAdmin(db, target.email);
      assert.equal(result.ok, true);

      assert.equal(await db.authSession.count({ where: { userId: target.id } }), 0);
      assert.equal(await db.accountSetup.count({ where: { userId: target.id, usedAt: null } }), 0);
      assert.equal(await db.previewSession.count({ where: { userId: target.id, revokedAt: null } }), 0);
    } finally {
      await cleanup();
    }
  });
});

describe("localRecoverAccount", () => {
  it("re-enables a disabled account and revokes credentials", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const target = await createTargetUser(db, { role: "PLAYER", disabled: true });
      const before = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.notEqual(before.disabledAt, null);
      await db.authSession.create({
        data: { userId: target.id, tokenHash: tokenHash("session-2"), expiresAt: new Date(Date.now() + 60_000) },
      });

      const result = await localRecoverAccount(db, target.email);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.value.disabled, false);

      const after = await db.user.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(after.disabledAt, null);
      assert.equal(after.accountVersion, before.accountVersion + 1);
      assert.equal(await db.authSession.count({ where: { userId: target.id } }), 0);

      const audits = await db.installationAuditEvent.findMany({ where: { targetIdSnapshot: target.id, action: "LOCAL_RECOVERY" } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].outcome, "SUCCESS");
      const details = JSON.parse(audits[0].detailsJson);
      assert.equal(details.reason, "RECOVERED");
      assert.equal(details.token, undefined);
    } finally {
      await cleanup();
    }
  });

  it("rejects recovery of an active account", async () => {
    const { db, cleanup } = await createIsolatedDatabase();
    try {
      const target = await createTargetUser(db, { role: "AUTHOR" });
      const result = await localRecoverAccount(db, target.email);
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.error.code, "INVALID_INPUT");
    } finally {
      await cleanup();
    }
  });
});
