import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";
import { PrismaClient } from "@prisma/client";
import { addMember, createPolicy, issuePreviewSession, replaceSnapshotGrants, retroactiveGrant, revokeMember, revokePolicy, revokePreviewSession } from "../src/lib/membership";
import { tokenHash } from "../src/lib/passwords";
import { authorFetch, assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

async function fixture(context: TestContext) {
  const db = new PrismaClient();
  const owner = await db.user.create({ data: { name: "R14 owner", email: `r14-owner-${randomUUID()}@example.invalid` } });
  const playerA = await db.user.create({ data: { name: "R14 player A", email: `r14-a-${randomUUID()}@example.invalid` } });
  const playerB = await db.user.create({ data: { name: "R14 player B", email: `r14-b-${randomUUID()}@example.invalid` } });
  const world = await db.world.create({ data: { ownerId: owner.id, title: "R14 access operations", slug: `r14-${randomUUID()}` } });
  context.after(async () => {
    await db.world.deleteMany({ where: { id: world.id } });
    await deleteTestUsers(db, owner.id, playerA.id, playerB.id);
    await db.$disconnect();
  });
  const article = await db.article.create({ data: { worldId: world.id, title: "R14 shared article", slug: `r14-article-${randomUUID()}` } });
  const gmFetch = await authorFetch(db, owner.id, origin!);
  return { db, owner, playerA, playerB, world, article, gmFetch };
}

async function withFailure(db: PrismaClient, sql: string, operation: () => Promise<unknown>) {
  await db.$executeRawUnsafe(sql);
  try {
    await assert.rejects(operation);
  } finally {
    await db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r14_injected_failure");
  }
}

function failureTrigger(table: string, operation: "INSERT" | "UPDATE" | "DELETE", condition: string, label: string) {
  return `CREATE TRIGGER r14_injected_failure BEFORE ${operation} ON ${table} WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'R14 injected ${label} failure'); END`;
}

async function memberState(db: PrismaClient, worldId: string, userId: string) {
  return {
    member: await db.worldMember.findUnique({ where: { worldId_userId: { worldId, userId } } }),
    grants: await db.audienceGrant.findMany({ where: { policy: { worldId } }, orderBy: { id: "asc" } }),
    previews: await db.previewSession.findMany({ where: { worldId, userId }, orderBy: { tokenHash: "asc" } }),
    events: await db.accessAuditEvent.findMany({ where: { worldId }, orderBy: { id: "asc" } }),
  };
}

test("member revocation rolls back membership, grants, previews, and audit at every write", { skip: !origin }, async context => {
  const f = await fixture(context);
  await f.db.worldMember.create({ data: { worldId: f.world.id, userId: f.playerA.id } });
  const policy = await f.db.audiencePolicy.create({ data: { worldId: f.world.id, resourceKind: "articles", resourceId: f.article.id, mode: "PLAYER_SNAPSHOT" } });
  await f.db.audienceGrant.create({ data: { policyId: policy.id, userId: f.playerA.id } });
  await f.db.previewSession.create({ data: { tokenHash: tokenHash(randomUUID()), userId: f.playerA.id, worldId: f.world.id, expiresAt: new Date(Date.now() + 60_000) } });

  const stages: Array<[string, string]> = [
    ["WorldMember", `OLD.worldId = '${f.world.id}' AND OLD.userId = '${f.playerA.id}'`],
    ["AudienceGrant", `OLD.policyId = '${policy.id}' AND OLD.userId = '${f.playerA.id}'`],
    ["PreviewSession", `OLD.worldId = '${f.world.id}' AND OLD.userId = '${f.playerA.id}'`],
  ];
  for (const [table, condition] of stages) {
    const before = await memberState(f.db, f.world.id, f.playerA.id);
    await withFailure(f.db, failureTrigger(table, "UPDATE", condition, table), () => revokeMember(f.world.id, f.playerA.id, f.owner.id));
    assert.deepEqual(await memberState(f.db, f.world.id, f.playerA.id), before, `${table} failure rolls back the operation`);
  }
  const beforeAuditFailure = await memberState(f.db, f.world.id, f.playerA.id);
  await withFailure(f.db, failureTrigger("AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'revoke_member'`, "audit"), () => revokeMember(f.world.id, f.playerA.id, f.owner.id));
  assert.deepEqual(await memberState(f.db, f.world.id, f.playerA.id), beforeAuditFailure);
});

test("preview issue and revocation roll back with their audit events", { skip: !origin }, async context => {
  const f = await fixture(context);
  await f.db.worldMember.create({ data: { worldId: f.world.id, userId: f.playerA.id } });
  for (const [table, op, condition, action] of [
    ["PreviewSession", "INSERT", `NEW.worldId = '${f.world.id}'`, "issue_preview"],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'issue_preview'`, "issue_preview"],
  ] as const) {
    const before = await memberState(f.db, f.world.id, f.playerA.id);
    await withFailure(f.db, failureTrigger(table, op, condition, action), () => issuePreviewSession(f.world.id, f.playerA.id, f.owner.id));
    assert.deepEqual(await memberState(f.db, f.world.id, f.playerA.id), before, `${action} ${table} failure rolls back`);
  }
  const issued = await issuePreviewSession(f.world.id, f.playerA.id, f.owner.id);
  const hash = tokenHash(issued.token);
  await assert.rejects(revokePreviewSession(hash, "another-world", f.owner.id), /Preview session not found/);
  assert.equal((await f.db.previewSession.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt, null);
  for (const [table, op, condition] of [
    ["PreviewSession", "UPDATE", `OLD.tokenHash = '${hash}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'revoke_preview'`],
  ] as const) {
    const before = await memberState(f.db, f.world.id, f.playerA.id);
    await withFailure(f.db, failureTrigger(table, op, condition, `revoke ${table}`), () => revokePreviewSession(hash, f.world.id, f.owner.id));
    assert.deepEqual(await memberState(f.db, f.world.id, f.playerA.id), before, `revoke ${table} failure rolls back`);
  }
  await revokePreviewSession(hash, f.world.id, f.owner.id);
  assert.ok((await f.db.previewSession.findUniqueOrThrow({ where: { tokenHash: hash } })).revokedAt);
});

test("audience create, replace, and removal roll back policy, grants, and audit together", { skip: !origin }, async context => {
  const f = await fixture(context);
  await f.db.worldMember.createMany({ data: [f.playerA.id, f.playerB.id].map(userId => ({ worldId: f.world.id, userId })) });
  const policy = await f.db.audiencePolicy.create({ data: { worldId: f.world.id, resourceKind: "articles", resourceId: f.article.id, mode: "PLAYER_SNAPSHOT" } });
  await f.db.audienceGrant.create({ data: { policyId: policy.id, userId: f.playerA.id } });
  const path = `${origin}/api/resources/articles/${f.article.id}/audience`;
  const put = () => f.gmFetch(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [f.playerB.id] }) });
  const audienceState = async () => ({
    policy: await f.db.audiencePolicy.findUnique({ where: { id: policy.id } }),
    grants: await f.db.audienceGrant.findMany({ where: { policyId: policy.id }, orderBy: { id: "asc" } }),
    events: await f.db.accessAuditEvent.findMany({ where: { worldId: f.world.id }, orderBy: { id: "asc" } }),
  });
  const updateTriggers: Array<[string, string, string]> = [
    ["AudiencePolicy", "UPDATE", `OLD.id = '${policy.id}'`],
    ["AudienceGrant", "DELETE", `OLD.policyId = '${policy.id}'`],
    ["AudienceGrant", "INSERT", `NEW.policyId = '${policy.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'set_policy'`],
  ];
  for (const [table, op, condition] of updateTriggers) {
    const before = await audienceState();
    await f.db.$executeRawUnsafe(failureTrigger(table, op as "INSERT" | "UPDATE" | "DELETE", condition, `audience ${table}`));
    try {
      const response = await put();
      assert.equal(response.status, 500, `${table}: ${await response.text()}`);
    } finally {
      await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r14_injected_failure");
    }
    assert.deepEqual(await audienceState(), before, `${table} failure rolls back audience replacement`);
  }

  const removeTriggers: Array<[string, string]> = [
    ["AudiencePolicy", `OLD.id = '${policy.id}'`],
    ["AccessAuditEvent", `NEW.worldId = '${f.world.id}' AND NEW.action = 'revoke_policy'`],
  ];
  for (const [table, condition] of removeTriggers) {
    const before = await audienceState();
    await f.db.$executeRawUnsafe(failureTrigger(table, table === "AudiencePolicy" ? "DELETE" : "INSERT", condition, `remove ${table}`));
    try {
      const response = await f.gmFetch(path, { method: "DELETE" });
      assert.equal(response.status, 500, `${table}: ${await response.text()}`);
    } finally {
      await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r14_injected_failure");
    }
    assert.deepEqual(await audienceState(), before, `${table} failure rolls back audience removal`);
  }

  const createArticle = await f.db.article.create({ data: { worldId: f.world.id, title: "R14 policy creation", slug: `r14-create-${randomUUID()}` } });
  const createPath = `${origin}/api/resources/articles/${createArticle.id}/audience`;
  for (const [table, op, condition] of [
    ["AudiencePolicy", "INSERT", `NEW.worldId = '${f.world.id}'`],
    ["AudienceGrant", "INSERT", `NEW.userId = '${f.playerA.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'set_policy'`],
  ] as const) {
    await f.db.$executeRawUnsafe(failureTrigger(table, op, condition, `audience create ${table}`));
    try {
      const response = await f.gmFetch(createPath, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "PLAYER_SNAPSHOT", userIds: [f.playerA.id] }) });
      assert.equal(response.status, 500, `${table}: ${await response.text()}`);
    } finally {
      await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r14_injected_failure");
    }
    assert.equal(await f.db.audiencePolicy.count({ where: { worldId: f.world.id, resourceId: createArticle.id } }), 0, `${table} failure leaves no policy`);
    assert.equal(await f.db.audienceGrant.count({ where: { policy: { worldId: f.world.id, resourceId: createArticle.id } } }), 0, `${table} failure leaves no grants`);
    assert.equal(await f.db.accessAuditEvent.count({ where: { worldId: f.world.id } }), 0, `${table} failure leaves no audit event`);
  }
});

test("rejoining does not restore revoked snapshot grants or preview sessions", { skip: !origin }, async context => {
  const f = await fixture(context);
  await f.db.worldMember.create({ data: { worldId: f.world.id, userId: f.playerA.id } });
  const policy = await f.db.audiencePolicy.create({ data: { worldId: f.world.id, resourceKind: "articles", resourceId: f.article.id, mode: "PLAYER_SNAPSHOT" } });
  await f.db.audienceGrant.create({ data: { policyId: policy.id, userId: f.playerA.id } });
  const session = await f.db.previewSession.create({ data: { tokenHash: tokenHash(randomUUID()), userId: f.playerA.id, worldId: f.world.id, expiresAt: new Date(Date.now() + 60_000) } });
  await revokeMember(f.world.id, f.playerA.id, f.owner.id);
  await addMember(f.world.id, f.playerA.id, f.owner.id);
  const grant = await f.db.audienceGrant.findUniqueOrThrow({ where: { policyId_userId: { policyId: policy.id, userId: f.playerA.id } } });
  const preview = await f.db.previewSession.findUniqueOrThrow({ where: { tokenHash: session.tokenHash } });
  assert.ok(grant.revokedAt);
  assert.ok(preview.revokedAt);
  const member = await f.db.worldMember.findUniqueOrThrow({ where: { worldId_userId: { worldId: f.world.id, userId: f.playerA.id } } });
  assert.equal(member.status, "ACTIVE");
});

test("membership policy helpers roll back grant and audit writes together", { skip: !origin }, async context => {
  const f = await fixture(context);
  const state = async () => ({
    members: await f.db.worldMember.findMany({ where: { worldId: f.world.id }, orderBy: { id: "asc" } }),
    policies: await f.db.audiencePolicy.findMany({ where: { worldId: f.world.id }, orderBy: { id: "asc" } }),
    grants: await f.db.audienceGrant.findMany({ where: { policy: { worldId: f.world.id } }, orderBy: { id: "asc" } }),
    events: await f.db.accessAuditEvent.findMany({ where: { worldId: f.world.id }, orderBy: { id: "asc" } }),
  });

  for (const [table, op, condition] of [
    ["WorldMember", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.userId = '${f.playerA.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'add_member'`],
  ] as const) {
    const before = await state();
    await withFailure(f.db, failureTrigger(table, op, condition, `add member ${table}`), () => addMember(f.world.id, f.playerA.id, f.owner.id));
    assert.deepEqual(await state(), before, `addMember ${table} failure rolls back`);
  }

  for (const [table, op, condition] of [
    ["AudiencePolicy", "INSERT", `NEW.worldId = '${f.world.id}'`],
    ["AudienceGrant", "INSERT", `NEW.userId = '${f.playerA.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'create_policy'`],
  ] as const) {
    const before = await state();
    await withFailure(f.db, failureTrigger(table, op, condition, `create policy ${table}`), () => createPolicy(f.world.id, "articles", f.article.id, "PLAYER_SNAPSHOT", f.owner.id, [f.playerA.id]));
    assert.deepEqual(await state(), before, `createPolicy ${table} failure rolls back`);
  }

  const policy = await createPolicy(f.world.id, "articles", f.article.id, "PLAYER_SNAPSHOT", f.owner.id, [f.playerA.id]);
  for (const [table, op, condition] of [
    ["AudienceGrant", "UPDATE", `OLD.policyId = '${policy.id}'`],
    ["AudienceGrant", "INSERT", `NEW.policyId = '${policy.id}' AND NEW.userId = '${f.playerB.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'retroactive_grant'`],
  ] as const) {
    const before = await state();
    await withFailure(f.db, failureTrigger(table, op, condition, `replace grants ${table}`), () => replaceSnapshotGrants(policy.id, [f.playerB.id], f.owner.id));
    assert.deepEqual(await state(), before, `replaceSnapshotGrants ${table} failure rolls back`);
  }
  await replaceSnapshotGrants(policy.id, [f.playerB.id], f.owner.id);
  const replaced = await f.db.audienceGrant.findMany({ where: { policyId: policy.id } });
  assert.equal(replaced.find(grant => grant.userId === f.playerA.id)?.revokedAt !== null, true);
  assert.equal(replaced.find(grant => grant.userId === f.playerB.id)?.revokedAt, null);

  for (const [table, op, condition] of [
    ["AudienceGrant", "INSERT", `NEW.policyId = '${policy.id}' AND NEW.userId = '${f.playerB.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'retroactive_grant'`],
  ] as const) {
    const before = await state();
    await withFailure(f.db, failureTrigger(table, op, condition, `retroactive grant ${table}`), () => retroactiveGrant(f.world.id, "articles", f.article.id, [f.playerB.id], f.owner.id));
    assert.deepEqual(await state(), before, `retroactiveGrant ${table} failure rolls back`);
  }
  await retroactiveGrant(f.world.id, "articles", f.article.id, [f.playerB.id], f.owner.id);

  for (const [table, op, condition] of [
    ["AudiencePolicy", "DELETE", `OLD.id = '${policy.id}'`],
    ["AccessAuditEvent", "INSERT", `NEW.worldId = '${f.world.id}' AND NEW.action = 'revoke_policy'`],
  ] as const) {
    const before = await state();
    await withFailure(f.db, failureTrigger(table, op, condition, `revoke policy ${table}`), () => revokePolicy(f.world.id, "articles", f.article.id, f.owner.id));
    assert.deepEqual(await state(), before, `revokePolicy ${table} failure rolls back`);
  }
  await revokePolicy(f.world.id, "articles", f.article.id, f.owner.id);
  assert.equal(await f.db.audiencePolicy.count({ where: { id: policy.id } }), 0);
});

test("concurrent session next reassignment succeeds and leaves one selected session", { skip: !origin }, async context => {
  const f = await fixture(context);
  const first = await f.db.campaignSession.create({ data: { worldId: f.world.id, title: "R14 first" } });
  const second = await f.db.campaignSession.create({ data: { worldId: f.world.id, title: "R14 second" } });
  await f.db.campaignSession.update({ where: { id: first.id }, data: { isNext: true } });
  const send = f.gmFetch;
  const assign = (id: string) => send(`${origin}/api/sessions/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isNext: true }) });
  for (const [condition, label] of [
    [`OLD.id = '${first.id}' AND NEW.isNext = 0`, "clear previous session"],
    [`OLD.id = '${second.id}' AND NEW.isNext = 1`, "set target session"],
  ]) {
    await f.db.$executeRawUnsafe(failureTrigger("CampaignSession", "UPDATE", condition, label));
    try {
      const response = await assign(second.id);
      assert.equal(response.status, 500, await response.text());
    } finally {
      await f.db.$executeRawUnsafe("DROP TRIGGER IF EXISTS r14_injected_failure");
    }
    const selectedState = await f.db.campaignSession.findMany({ where: { worldId: f.world.id }, select: { id: true, isNext: true } });
    assert.equal(selectedState.find(session => session.id === first.id)?.isNext, true);
    assert.equal(selectedState.find(session => session.id === second.id)?.isNext, false);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const responses = await Promise.all([assign(first.id), assign(second.id)]);
    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    const selected = await f.db.campaignSession.findMany({ where: { worldId: f.world.id, isNext: true }, select: { id: true } });
    assert.equal(selected.length, 1, `pair ${attempt + 1} leaves exactly one next session`);
    assert.ok([first.id, second.id].includes(selected[0].id));
  }
});
