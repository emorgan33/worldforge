import assert from "node:assert/strict";
import { testPrismaClient } from "./test-prisma-client";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { PrismaClient } from "@prisma/client";
import { assertIsolatedTestEnvironment, deleteTestUsers } from "./auth-fixture";
import { SESSION_COOKIE } from "../src/lib/auth-constants";

const origin = process.env.WORLDFORGE_TEST_ORIGIN;
if (origin) assertIsolatedTestEnvironment();

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

type SessionState = { role: string; disabled?: boolean; expired?: boolean };

async function createUserWithSession(db: PrismaClient, state: SessionState) {
  const stamp = randomUUID();
  const user = await db.user.create({
    data: {
      name: `Mutation fixture ${stamp.slice(0, 8)}`,
      email: `mutation-fixture-${stamp}@example.invalid`,
      role: state.role,
      disabledAt: state.disabled ? new Date() : null,
    },
  });
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: {
      userId: user.id,
      tokenHash: digest(token),
      expiresAt: state.expired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 30 * 60_000),
    },
  });
  return { user, token };
}

type SendOptions = {
  token?: string | null;
  /** `undefined` uses the configured test origin, `null` omits the header. */
  origin?: string | null;
  headers?: Record<string, string>;
};

function send(method: string, path: string, body: unknown, options: SendOptions = {}) {
  const headers: Record<string, string> = {};
  const originHeader = options.origin === undefined ? origin : options.origin;
  if (originHeader) headers.Origin = originHeader;
  if (options.token) headers.Cookie = `${SESSION_COOKIE}=${options.token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  Object.assign(headers, options.headers ?? {});

  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = typeof body === "string" ? body : JSON.stringify(body);
  return fetch(`${origin}${path}`, init);
}

const ADMIN_MUTATION_PATHS = (
  id: string,
  sessionId = "00000000-0000-0000-0000-000000000000",
  worldId = "00000000-0000-0000-0000-000000000001",
) => [
  { label: "create", method: "POST", path: "/api/admin/users", body: { email: "probe@example.invalid", name: "Probe", role: "AUTHOR" } },
  { label: "recovery", method: "POST", path: `/api/admin/users/${id}/recovery`, body: { expectedVersion: 0 } },
  { label: "status", method: "PATCH", path: `/api/admin/users/${id}/status`, body: { disabled: true, expectedVersion: 0 } },
  { label: "role", method: "PATCH", path: `/api/admin/users/${id}/role`, body: { role: "GM", expectedVersion: 0 } },
  { label: "session", method: "DELETE", path: `/api/admin/users/${id}/sessions/${sessionId}`, body: { expectedVersion: 0 } },
  { label: "revoke-all", method: "POST", path: `/api/admin/users/${id}/sessions/revoke-all`, body: { expectedVersion: 0 } },
  { label: "transfer", method: "POST", path: `/api/admin/users/${id}/worlds/${worldId}/transfer`, body: { recipientId: "recipient", expectedVersion: 0 } },
  { label: "purge", method: "POST", path: `/api/admin/users/${id}/worlds/${worldId}/purge`, body: { confirmWorldTitle: "World", backupAcknowledged: true, expectedVersion: 0 } },
  { label: "delete", method: "DELETE", path: `/api/admin/users/${id}`, body: { expectedVersion: 0, confirmEmail: "x@example.invalid", backupAcknowledged: true } },
];

async function versionOf(db: PrismaClient, id: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id }, select: { accountVersion: true } });
  return user.accountVersion;
}

test("admin mutations reject missing, wrong, and cross-site origins before reading data", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const target = await db.user.create({
    data: { name: "Origin target", email: `origin-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(target.id);
  const version = await versionOf(db, target.id);
  const stamp = randomUUID().slice(0, 8);
  const worldId = randomUUID();

  const cases = [
    { label: "create", method: "POST", path: "/api/admin/users", body: { email: `origin-probe-${stamp}@example.invalid`, name: "Origin probe", role: "AUTHOR" } },
    { label: "recovery", method: "POST", path: `/api/admin/users/${target.id}/recovery`, body: { expectedVersion: version } },
    { label: "status", method: "PATCH", path: `/api/admin/users/${target.id}/status`, body: { disabled: true, expectedVersion: version } },
    { label: "role", method: "PATCH", path: `/api/admin/users/${target.id}/role`, body: { role: "GM", expectedVersion: version } },
    { label: "session", method: "DELETE", path: `/api/admin/users/${target.id}/sessions/does-not-exist`, body: { expectedVersion: version } },
    { label: "revoke-all", method: "POST", path: `/api/admin/users/${target.id}/sessions/revoke-all`, body: { expectedVersion: version } },
    { label: "transfer", method: "POST", path: `/api/admin/users/${target.id}/worlds/${worldId}/transfer`, body: { recipientId: randomUUID(), expectedVersion: version } },
    { label: "purge", method: "POST", path: `/api/admin/users/${target.id}/worlds/${worldId}/purge`, body: { confirmWorldTitle: "World", backupAcknowledged: true, expectedVersion: version } },
    { label: "delete", method: "DELETE", path: `/api/admin/users/${target.id}`, body: { expectedVersion: version, confirmEmail: target.email, backupAcknowledged: true } },
  ];

  for (const entry of cases) {
    for (const [label, options] of [
      ["missing origin", { origin: null }],
      ["wrong origin", { origin: "https://evil.example" }],
      ["cross-site fetch", { headers: { "Sec-Fetch-Site": "cross-site" } }],
    ] as const) {
      const response = await send(entry.method, entry.path, entry.body, { token: admin.token, ...options });
      assert.equal(response.status, 403, `${entry.label} ${label}`);
      const body = await response.json();
      assert.equal(body.code, "FORBIDDEN", `${entry.label} ${label}`);
      assert.equal(body.user, undefined);
      assert.equal(body.setup, undefined);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
  }

  // Rejected origin attempts must not create the account or change the target.
  assert.equal(await db.user.findUnique({ where: { email: `origin-probe-${stamp}@example.invalid` } }), null);
  const unchanged = await db.user.findUniqueOrThrow({ where: { id: target.id }, select: { role: true, disabledAt: true, accountVersion: true } });
  assert.deepEqual(unchanged, { role: "AUTHOR", disabledAt: null, accountVersion: version });
});

test("admin mutations reject anonymous, non-admin, expired, disabled, and revoked admins", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const author = await createUserWithSession(db, { role: "AUTHOR" });
  createdUserIds.push(author.user.id);
  const gm = await createUserWithSession(db, { role: "GM" });
  createdUserIds.push(gm.user.id);
  const player = await createUserWithSession(db, { role: "PLAYER" });
  createdUserIds.push(player.user.id);
  const expired = await createUserWithSession(db, { role: "ADMIN", expired: true });
  createdUserIds.push(expired.user.id);
  const disabled = await createUserWithSession(db, { role: "ADMIN", disabled: true });
  createdUserIds.push(disabled.user.id);
  const revoked = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(revoked.user.id);
  await db.authSession.deleteMany({ where: { userId: revoked.user.id } });

  const target = await db.user.create({
    data: { name: "Matrix target", email: `matrix-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(target.id);
  const version = await versionOf(db, target.id);
  const cases = ADMIN_MUTATION_PATHS(target.id).map((entry) => ({
    ...entry,
    body: entry.label === "create" ? entry.body : { ...(entry.body as Record<string, unknown>), expectedVersion: version },
  }));

  for (const entry of cases) {
    const anonymous = await send(entry.method, entry.path, entry.body);
    assert.equal(anonymous.status, 401, `anonymous ${entry.label}`);
    assert.equal((await anonymous.json()).code, "UNAUTHORIZED", `anonymous ${entry.label}`);
    assert.equal(anonymous.headers.get("Cache-Control"), "private, no-store");
  }

  for (const [label, session] of [["AUTHOR", author], ["GM", gm], ["PLAYER", player]] as const) {
    for (const entry of cases) {
      const response = await send(entry.method, entry.path, entry.body, { token: session.token });
      assert.equal(response.status, 403, `${label} ${entry.label}`);
      const body = await response.json();
      assert.equal(body.code, "FORBIDDEN", `${label} ${entry.label}`);
      assert.equal(body.user, undefined);
    }
  }

  for (const [label, session] of [["expired", expired], ["disabled", disabled], ["revoked", revoked]] as const) {
    for (const entry of cases) {
      const response = await send(entry.method, entry.path, entry.body, { token: session.token });
      assert.equal(response.status, 401, `${label} ${entry.label}`);
      assert.equal((await response.json()).code, "UNAUTHORIZED", `${label} ${entry.label}`);
    }
  }
});

test("create returns a safe DTO and one-time setup link and rejects injected fields", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const stamp = randomUUID().slice(0, 8);
  const email = `new-${stamp}@example.invalid`;

  const response = await send("POST", "/api/admin/users", {
    email: email.toUpperCase(),
    name: "  New Person  ",
    role: "AUTHOR",
  }, { token: admin.token });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const body = await response.json();
  createdUserIds.push(body.user.id);

  assert.deepEqual(Object.keys(body.user).sort(), [
    "accountVersion", "createdAt", "disabledAt", "email", "id", "lastSignInAt", "name", "role", "setupPending",
  ]);
  assert.equal(body.user.email, email, "email is normalized");
  assert.equal(body.user.name, "New Person", "name is trimmed");
  assert.equal(body.user.role, "AUTHOR");
  assert.equal(body.user.setupPending, true);
  assert.equal(JSON.stringify(body).includes("passwordHash"), false);
  assert.equal(JSON.stringify(body).includes("tokenHash"), false);

  const token = body.setup.url.slice(body.setup.url.indexOf("#token=") + "#token=".length);
  assert.equal(body.setup.url, `${origin}/setup#token=${token}`);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(new Date(body.setup.expiresAt).getTime() > Date.now() + 23 * 60 * 60 * 1000);

  const stored = await db.user.findUniqueOrThrow({ where: { id: body.user.id }, select: { passwordHash: true } });
  assert.equal(stored.passwordHash, null);
  const setup = await db.accountSetup.findMany({ where: { userId: body.user.id } });
  assert.equal(setup.length, 1);
  assert.equal(setup[0].tokenHash, digest(token), "only the hash is stored");
  assert.equal(setup[0].tokenHash === token, false);

  const audit = await db.installationAuditEvent.findFirst({
    where: { targetIdSnapshot: body.user.id, action: "ACCOUNT_CREATE" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(audit?.outcome, "SUCCESS");
  assert.equal(audit?.actorType, "WEB_ADMIN");
  assert.equal(audit?.detailsJson.includes(token), false, "setup tokens never reach the audit log");

  // Duplicate email is a conflict, not a second account.
  const duplicate = await send("POST", "/api/admin/users", { email, name: "Other", role: "AUTHOR" }, { token: admin.token });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).code, "DUPLICATE_EMAIL");
  assert.equal(await db.user.count({ where: { email } }), 1);

  // Privileged roles and injected credential/ownership fields are rejected.
  for (const [label, payload] of [
    ["ADMIN role", { email: `admin-${stamp}@example.invalid`, name: "Admin", role: "ADMIN" }],
    ["GM role", { email: `gm-${stamp}@example.invalid`, name: "GM", role: "GM" }],
    ["passwordHash injection", { email: `hash-${stamp}@example.invalid`, name: "Hash", role: "AUTHOR", passwordHash: "scrypt-v1:x:y" }],
    ["tokenHash injection", { email: `token-${stamp}@example.invalid`, name: "Token", role: "AUTHOR", tokenHash: "abc" }],
    ["ownerId injection", { email: `owner-${stamp}@example.invalid`, name: "Owner", role: "AUTHOR", ownerId: "world-1" }],
    ["id injection", { email: `id-${stamp}@example.invalid`, name: "Id", role: "AUTHOR", id: "fixed-id" }],
    ["short name", { email: `short-${stamp}@example.invalid`, name: "   ", role: "AUTHOR" }],
    ["long name", { email: `long-${stamp}@example.invalid`, name: "x".repeat(121), role: "AUTHOR" }],
    ["invalid email", { email: "not-an-email", name: "Bad", role: "AUTHOR" }],
  ] as const) {
    const rejected = await send("POST", "/api/admin/users", payload, { token: admin.token });
    assert.equal(rejected.status, 400, label);
    const error = await rejected.json();
    assert.ok(["INVALID_INPUT", "INVALID_ROLE"].includes(error.code), `${label}: ${error.code}`);
  }
  assert.equal(await db.user.count({ where: { email: { contains: `hash-${stamp}` } } }), 0);
  assert.equal(await db.user.count({ where: { email: { contains: `token-${stamp}` } } }), 0);

  // A valid JSON body with a non-JSON content type is rejected before parsing.
  const wrongContentTypeEmail = `wrong-content-type-${stamp}@example.invalid`;
  const wrongContentType = await send(
    "POST",
    "/api/admin/users",
    { email: wrongContentTypeEmail, name: "Wrong content type", role: "AUTHOR" },
    { token: admin.token, headers: { "Content-Type": "text/plain" } },
  );
  assert.equal(wrongContentType.status, 400);
  assert.equal((await wrongContentType.json()).code, "INVALID_INPUT");
  assert.equal(await db.user.count({ where: { email: wrongContentTypeEmail } }), 0);

  // A created PLAYER has no author rights.
  const playerEmail = `player-${stamp}@example.invalid`;
  const playerCreated = await send("POST", "/api/admin/users", { email: playerEmail, name: "Player", role: "PLAYER" }, { token: admin.token });
  assert.equal(playerCreated.status, 201);
  const player = await playerCreated.json();
  createdUserIds.push(player.user.id);
  const playerToken = randomBytes(32).toString("base64url");
  await db.authSession.create({
    data: { userId: player.user.id, tokenHash: digest(playerToken), expiresAt: new Date(Date.now() + 60_000) },
  });
  const playerWorlds = await send("GET", "/api/player/worlds", undefined, { token: playerToken });
  assert.equal(playerWorlds.status, 200);
  assert.deepEqual((await playerWorlds.json()).worlds, [], "a new player has no campaigns");
  const authorWorlds = await send("GET", "/api/worlds", undefined, { token: playerToken });
  assert.equal(authorWorlds.status, 403, "player accounts cannot use author APIs");
  const playerCreate = await send("POST", "/api/worlds", { title: "Nope" }, { token: playerToken });
  assert.equal(playerCreate.status, 403);
});

test("recovery reissues a one-time link, invalidates the old one, and honours disabled and stale guards", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const stamp = randomUUID().slice(0, 8);

  const created = await send("POST", "/api/admin/users", {
    email: `recovery-${stamp}@example.invalid`,
    name: "Recovery target",
    role: "AUTHOR",
  }, { token: admin.token });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  createdUserIds.push(createdBody.user.id);
  const firstToken = createdBody.setup.url.slice(createdBody.setup.url.indexOf("#token=") + "#token=".length);

  const recovery = await send("POST", `/api/admin/users/${createdBody.user.id}/recovery`, {
    expectedVersion: createdBody.user.accountVersion,
  }, { token: admin.token });
  assert.equal(recovery.status, 200);
  const recoveryBody = await recovery.json();
  const secondToken = recoveryBody.setup.url.slice(recoveryBody.setup.url.indexOf("#token=") + "#token=".length);
  assert.notEqual(secondToken, firstToken);
  assert.equal(recoveryBody.user.accountVersion, createdBody.user.accountVersion + 1);

  const setups = await db.accountSetup.findMany({
    where: { userId: createdBody.user.id },
    orderBy: { expiresAt: "asc" },
  });
  assert.equal(setups.length, 2);
  const oldRow = setups.find((row) => row.tokenHash === digest(firstToken));
  const newRow = setups.find((row) => row.tokenHash === digest(secondToken));
  assert.ok(oldRow?.usedAt, "the previous link is invalidated");
  assert.equal(newRow?.usedAt, null);

  // A disabled target cannot be recovered.
  const disabled = await send("PATCH", `/api/admin/users/${createdBody.user.id}/status`, {
    disabled: true,
    expectedVersion: recoveryBody.user.accountVersion,
  }, { token: admin.token });
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  const blocked = await send("POST", `/api/admin/users/${createdBody.user.id}/recovery`, {
    expectedVersion: disabledBody.user.accountVersion,
  }, { token: admin.token });
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "ACCOUNT_DISABLED");

  // A stale version is a conflict.
  const stale = await send("POST", `/api/admin/users/${createdBody.user.id}/recovery`, {
    expectedVersion: disabledBody.user.accountVersion - 1,
  }, { token: admin.token });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "STALE_ACCOUNT");
});

test("status changes revoke credentials atomically and enforce self and stale guards", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const target = await createUserWithSession(db, { role: "AUTHOR" });
  createdUserIds.push(target.user.id);
  const targetSessionIds = (await db.authSession.findMany({ where: { userId: target.user.id } })).map((row) => row.id);
  assert.ok(targetSessionIds.length >= 1);

  const world = await db.world.create({
    data: { ownerId: admin.user.id, title: "Preview world", slug: `preview-${randomUUID()}` },
  });
  await db.previewSession.create({
    data: {
      tokenHash: digest(randomUUID()),
      userId: target.user.id,
      worldId: world.id,
      issuedById: admin.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await db.accountSetup.create({
    data: { tokenHash: digest(randomUUID()), userId: target.user.id, expiresAt: new Date(Date.now() + 60_000) },
  });

  const disabled = await send("PATCH", `/api/admin/users/${target.user.id}/status`, {
    disabled: true,
    expectedVersion: target.user.accountVersion,
  }, { token: admin.token });
  assert.equal(disabled.status, 200);
  const disabledBody = await disabled.json();
  assert.notEqual(disabledBody.user.disabledAt, null);
  assert.equal(disabledBody.user.accountVersion, target.user.accountVersion + 1);

  assert.equal(await db.authSession.count({ where: { userId: target.user.id } }), 0, "normal sessions are revoked");
  assert.equal(await db.accountSetup.count({ where: { userId: target.user.id, usedAt: null } }), 0, "setup links are invalidated");
  assert.equal(await db.previewSession.count({ where: { userId: target.user.id, revokedAt: null } }), 0, "preview capabilities are revoked");

  const enabled = await send("PATCH", `/api/admin/users/${target.user.id}/status`, {
    disabled: false,
    expectedVersion: disabledBody.user.accountVersion,
  }, { token: admin.token });
  assert.equal(enabled.status, 200);
  assert.equal((await enabled.json()).user.disabledAt, null);

  // Self-disable and stale versions are rejected.
  const self = await send("PATCH", `/api/admin/users/${admin.user.id}/status`, {
    disabled: true,
    expectedVersion: admin.user.accountVersion,
  }, { token: admin.token });
  assert.equal(self.status, 409);
  assert.equal((await self.json()).code, "SELF_CHANGE");

  const stale = await send("PATCH", `/api/admin/users/${target.user.id}/status`, {
    disabled: true,
    expectedVersion: 0,
  }, { token: admin.token });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "STALE_ACCOUNT");

  const missingVersion = await send("PATCH", `/api/admin/users/${target.user.id}/status`, { disabled: true }, { token: admin.token });
  assert.equal(missingVersion.status, 400);
  assert.equal((await missingVersion.json()).code, "INVALID_INPUT");
});

test("role changes enforce ownership, self, validation, and stale guards", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const owner = await db.user.create({
    data: { name: "Role owner", email: `role-owner-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(owner.id);
  await db.world.create({ data: { ownerId: owner.id, title: "Owned", slug: `owned-${randomUUID()}` } });

  const toPlayer = await send("PATCH", `/api/admin/users/${owner.id}/role`, {
    role: "PLAYER",
    expectedVersion: owner.accountVersion,
  }, { token: admin.token });
  assert.equal(toPlayer.status, 409);
  assert.equal((await toPlayer.json()).code, "OWNS_WORLDS");

  const free = await db.user.create({
    data: { name: "Role free", email: `role-free-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(free.id);
  const toGm = await send("PATCH", `/api/admin/users/${free.id}/role`, {
    role: "GM",
    expectedVersion: free.accountVersion,
  }, { token: admin.token });
  assert.equal(toGm.status, 200);
  const toGmBody = await toGm.json();
  assert.equal(toGmBody.user.role, "GM");
  assert.equal(toGmBody.user.accountVersion, free.accountVersion + 1);

  const invalid = await send("PATCH", `/api/admin/users/${free.id}/role`, {
    role: "GOD",
    expectedVersion: toGmBody.user.accountVersion,
  }, { token: admin.token });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, "INVALID_ROLE");

  const injected = await send("PATCH", `/api/admin/users/${free.id}/role`, {
    role: "AUTHOR",
    expectedVersion: toGmBody.user.accountVersion,
    ownerId: "world-1",
  }, { token: admin.token });
  assert.equal(injected.status, 400);

  const self = await send("PATCH", `/api/admin/users/${admin.user.id}/role`, {
    role: "AUTHOR",
    expectedVersion: admin.user.accountVersion,
  }, { token: admin.token });
  assert.equal(self.status, 409);
  assert.equal((await self.json()).code, "SELF_CHANGE");

  const stale = await send("PATCH", `/api/admin/users/${free.id}/role`, {
    role: "AUTHOR",
    expectedVersion: free.accountVersion,
  }, { token: admin.token });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "STALE_ACCOUNT");
});

test("session revocation is scoped to the target and revoke-all clears preview capabilities", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const target = await createUserWithSession(db, { role: "AUTHOR" });
  createdUserIds.push(target.user.id);
  const other = await createUserWithSession(db, { role: "AUTHOR" });
  createdUserIds.push(other.user.id);

  const targetSessions = await db.authSession.findMany({ where: { userId: target.user.id } });
  const otherSessions = await db.authSession.findMany({ where: { userId: other.user.id } });
  assert.equal(targetSessions.length, 1);
  assert.equal(otherSessions.length, 1);

  // A session belonging to another account is not revocable through this target.
  const crossTarget = await send(
    "DELETE",
    `/api/admin/users/${target.user.id}/sessions/${otherSessions[0].id}`,
    { expectedVersion: target.user.accountVersion },
    { token: admin.token },
  );
  assert.equal(crossTarget.status, 404);
  assert.equal((await crossTarget.json()).code, "NOT_FOUND");
  assert.equal(await db.authSession.count({ where: { id: otherSessions[0].id } }), 1, "the other account's session survives");

  const revoked = await send(
    "DELETE",
    `/api/admin/users/${target.user.id}/sessions/${targetSessions[0].id}`,
    { expectedVersion: target.user.accountVersion },
    { token: admin.token },
  );
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { revoked: 1 });
  assert.equal(await db.authSession.count({ where: { userId: target.user.id } }), 0);

  // revoke-all removes sessions and previews issued to or by the target.
  await db.authSession.create({
    data: { userId: target.user.id, tokenHash: digest(randomUUID()), expiresAt: new Date(Date.now() + 60_000) },
  });
  const world = await db.world.create({
    data: { ownerId: admin.user.id, title: "Revoke world", slug: `revoke-${randomUUID()}` },
  });
  await db.previewSession.create({
    data: {
      tokenHash: digest(randomUUID()),
      userId: target.user.id,
      worldId: world.id,
      issuedById: admin.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await db.previewSession.create({
    data: {
      tokenHash: digest(randomUUID()),
      userId: admin.user.id,
      worldId: world.id,
      issuedById: target.user.id,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const version = await versionOf(db, target.user.id);
  const revokeAll = await send(
    "POST",
    `/api/admin/users/${target.user.id}/sessions/revoke-all`,
    { expectedVersion: version },
    { token: admin.token },
  );
  assert.equal(revokeAll.status, 200);
  const counts = await revokeAll.json();
  assert.equal(counts.sessionCount, 1);
  assert.equal(counts.previewCount, 2);
  assert.equal(await db.authSession.count({ where: { userId: target.user.id } }), 0);
  assert.equal(await db.previewSession.count({ where: { revokedAt: null, OR: [{ userId: target.user.id }, { issuedById: target.user.id }] } }), 0);

  // Revoking all of the actor's own sessions ends that session immediately.
  const selfVersion = await versionOf(db, admin.user.id);
  const selfRevoke = await send(
    "POST",
    `/api/admin/users/${admin.user.id}/sessions/revoke-all`,
    { expectedVersion: selfVersion },
    { token: admin.token },
  );
  assert.equal(selfRevoke.status, 200);
  const afterRevoke = await send("GET", "/api/admin/users", undefined, { token: admin.token });
  assert.equal(afterRevoke.status, 401);
});

test("an administrator can revoke a single own session without revoking the acting session", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const secondToken = randomBytes(32).toString("base64url");
  const secondSession = await db.authSession.create({
    data: {
      userId: admin.user.id,
      tokenHash: digest(secondToken),
      expiresAt: new Date(Date.now() + 60_000),
    },
  });

  const revoked = await send(
    "DELETE",
    `/api/admin/users/${admin.user.id}/sessions/${secondSession.id}`,
    { expectedVersion: admin.user.accountVersion },
    { token: admin.token },
  );
  assert.equal(revoked.status, 200);
  assert.deepEqual(await revoked.json(), { revoked: 1 });
  assert.equal(await db.authSession.count({ where: { id: secondSession.id } }), 0);

  const revokedToken = await send("GET", "/api/admin/users", undefined, { token: secondToken });
  assert.equal(revokedToken.status, 401, "only the revoked self session stops working");

  const acting = await send("GET", "/api/admin/users", undefined, { token: admin.token });
  assert.equal(acting.status, 200, "the acting session remains valid");
});

test("owned-world remediation transfers or purges worlds before deletion", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const source = await db.user.create({
    data: { name: "Remediation source", email: `remediation-${randomUUID()}@example.invalid`, role: "GM", disabledAt: new Date() },
  });
  createdUserIds.push(source.id);
  const recipient = await db.user.create({
    data: { name: "Remediation recipient", email: `recipient-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(recipient.id);
  const player = await db.user.create({
    data: { name: "Remediation player", email: `player-recipient-${randomUUID()}@example.invalid`, role: "PLAYER" },
  });
  createdUserIds.push(player.id);

  const activeWorld = await db.world.create({ data: { ownerId: source.id, title: "Transferred world", slug: `transferred-${randomUUID()}` } });
  const archivedWorld = await db.world.create({ data: { ownerId: source.id, title: "Purged world", slug: `purged-${randomUUID()}`, deletedAt: new Date() } });
  const article = await db.article.create({ data: { worldId: activeWorld.id, title: "Preserved article", slug: `preserved-${randomUUID()}` } });
  const archivedArticle = await db.article.create({ data: { worldId: archivedWorld.id, title: "Removed article", slug: `removed-${randomUUID()}` } });

  const targets = await send("GET", `/api/admin/users/${source.id}/world-transfer-targets`, undefined, { token: admin.token });
  assert.equal(targets.status, 200);
  const targetBody = await targets.json();
  assert.ok(targetBody.targets.some((target: { id: string }) => target.id === recipient.id));
  assert.equal(targetBody.targets.some((target: { id: string }) => target.id === player.id), false);
  assert.equal(targetBody.targets.some((target: { id: string }) => target.id === source.id), false);
  assert.equal(JSON.stringify(targetBody).includes("tokenHash"), false);
  assert.equal(JSON.stringify(targetBody).includes("passwordHash"), false);

  const playerAttempt = await send("POST", `/api/admin/users/${source.id}/worlds/${activeWorld.id}/transfer`, {
    recipientId: player.id,
    expectedVersion: source.accountVersion,
  }, { token: admin.token });
  assert.equal(playerAttempt.status, 400);
  assert.equal((await playerAttempt.json()).code, "INVALID_ROLE");

  const transfer = await send("POST", `/api/admin/users/${source.id}/worlds/${activeWorld.id}/transfer`, {
    recipientId: recipient.id,
    expectedVersion: source.accountVersion,
  }, { token: admin.token });
  assert.equal(transfer.status, 200);
  const transferBody = await transfer.json();
  assert.equal(transferBody.world.id, activeWorld.id);
  assert.equal(transferBody.user.accountVersion, source.accountVersion + 1);
  assert.equal((await db.world.findUniqueOrThrow({ where: { id: activeWorld.id } })).ownerId, recipient.id);

  const titleMismatch = await send("POST", `/api/admin/users/${source.id}/worlds/${archivedWorld.id}/purge`, {
    confirmWorldTitle: "Wrong title",
    backupAcknowledged: true,
    expectedVersion: source.accountVersion + 1,
  }, { token: admin.token });
  assert.equal(titleMismatch.status, 400);
  assert.equal((await titleMismatch.json()).code, "INVALID_INPUT");

  const purge = await send("POST", `/api/admin/users/${source.id}/worlds/${archivedWorld.id}/purge`, {
    confirmWorldTitle: archivedWorld.title,
    backupAcknowledged: true,
    expectedVersion: source.accountVersion + 1,
  }, { token: admin.token });
  assert.equal(purge.status, 200);
  const purgeBody = await purge.json();
  assert.equal(purgeBody.world.id, archivedWorld.id);
  assert.equal(purgeBody.user.accountVersion, source.accountVersion + 2);
  assert.equal(await db.world.findUnique({ where: { id: archivedWorld.id } }), null);
  assert.equal(await db.article.findUnique({ where: { id: archivedArticle.id } }), null);
  assert.ok(await db.article.findUnique({ where: { id: article.id } }));

  const preview = await send("GET", `/api/admin/users/${source.id}/deletion-preview`, undefined, { token: admin.token });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).allowed, true);

  const deleted = await send("DELETE", `/api/admin/users/${source.id}`, {
    expectedVersion: source.accountVersion + 2,
    confirmEmail: source.email,
    backupAcknowledged: true,
  }, { token: admin.token });
  assert.equal(deleted.status, 200);
  assert.equal(await db.user.findUnique({ where: { id: source.id } }), null);
  assert.equal((await db.world.findUniqueOrThrow({ where: { id: activeWorld.id } })).ownerId, recipient.id);
  assert.ok(await db.article.findUnique({ where: { id: article.id } }));
  assert.ok(await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: source.id, action: "WORLD_TRANSFER", outcome: "SUCCESS" } }));
  assert.ok(await db.installationAuditEvent.findFirst({ where: { targetIdSnapshot: source.id, action: "WORLD_PURGE", outcome: "SUCCESS" } }));
});

test("deletion requires a disabled account, matching email, and no durable blockers", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const active = await db.user.create({
    data: { name: "Active delete", email: `active-${randomUUID()}@example.invalid`, role: "PLAYER" },
  });
  createdUserIds.push(active.id);
  const activeAttempt = await send("DELETE", `/api/admin/users/${active.id}`, {
    expectedVersion: active.accountVersion,
    confirmEmail: active.email,
    backupAcknowledged: true,
  }, { token: admin.token });
  assert.equal(activeAttempt.status, 400);
  assert.equal((await activeAttempt.json()).code, "INVALID_INPUT");
  assert.ok(await db.user.findUnique({ where: { id: active.id } }), "an active account is not deleted");

  const owner = await db.user.create({
    data: { name: "Delete owner", email: `delete-owner-${randomUUID()}@example.invalid`, role: "AUTHOR", disabledAt: new Date() },
  });
  createdUserIds.push(owner.id);
  const ownedWorld = await db.world.create({ data: { ownerId: owner.id, title: "Blocking", slug: `blocking-${randomUUID()}` } });
  const worldAttempt = await send("DELETE", `/api/admin/users/${owner.id}`, {
    expectedVersion: owner.accountVersion,
    confirmEmail: owner.email,
    backupAcknowledged: true,
  }, { token: admin.token });
  assert.equal(worldAttempt.status, 409);
  const worldBody = await worldAttempt.json();
  assert.equal(worldBody.code, "OWNS_WORLDS");
  assert.equal(worldBody.blockers.worlds[0].id, ownedWorld.id);

  const otherOwner = await db.user.create({
    data: { name: "Other owner", email: `other-owner-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(otherOwner.id);
  const otherWorld = await db.world.create({ data: { ownerId: otherOwner.id, title: "Other", slug: `other-${randomUUID()}` } });
  const article = await db.article.create({
    data: { worldId: otherWorld.id, title: "Article", slug: `article-${randomUUID()}` },
  });
  const reviser = await db.user.create({
    data: { name: "Reviser", email: `reviser-${randomUUID()}@example.invalid`, role: "AUTHOR", disabledAt: new Date() },
  });
  createdUserIds.push(reviser.id);
  const revision = await db.articleRevision.create({
    data: {
      articleId: article.id,
      userId: reviser.id,
      title: "Article",
      slug: "article",
      contentHtml: "<p>x</p>",
      publicationStatus: "DRAFT",
      visibility: "PRIVATE",
      state: "DRAFT",
      articleVersionAtSave: 1,
    },
  });
  const revisionAttempt = await send("DELETE", `/api/admin/users/${reviser.id}`, {
    expectedVersion: reviser.accountVersion,
    confirmEmail: reviser.email,
    backupAcknowledged: true,
  }, { token: admin.token });
  assert.equal(revisionAttempt.status, 409);
  const revisionBody = await revisionAttempt.json();
  assert.equal(revisionBody.code, "HAS_DURABLE_RECORDS");
  assert.deepEqual(revisionBody.blockers.revisionIds, [revision.id]);

  const wrongEmail = await send("DELETE", `/api/admin/users/${reviser.id}`, {
    expectedVersion: reviser.accountVersion,
    confirmEmail: "someone-else@example.invalid",
    backupAcknowledged: true,
  }, { token: admin.token });
  assert.equal(wrongEmail.status, 400);
  assert.equal((await wrongEmail.json()).code, "INVALID_INPUT");

  const noBackup = await send("DELETE", `/api/admin/users/${reviser.id}`, {
    expectedVersion: reviser.accountVersion,
    confirmEmail: reviser.email,
    backupAcknowledged: false,
  }, { token: admin.token });
  assert.equal(noBackup.status, 400);

  const removable = await db.user.create({
    data: { name: "Removable", email: `removable-${randomUUID()}@example.invalid`, role: "PLAYER", disabledAt: new Date() },
  });
  createdUserIds.push(removable.id);
  const deleted = await send("DELETE", `/api/admin/users/${removable.id}`, {
    expectedVersion: removable.accountVersion,
    confirmEmail: removable.email,
    backupAcknowledged: true,
  }, { token: admin.token });
  assert.equal(deleted.status, 200);
  assert.deepEqual(await deleted.json(), { deleted: true, userId: removable.id });
  assert.equal(await db.user.findUnique({ where: { id: removable.id } }), null);

  const audit = await db.installationAuditEvent.findFirst({
    where: { targetIdSnapshot: removable.id, action: "ACCOUNT_DELETE" },
    orderBy: { createdAt: "desc" },
  });
  assert.equal(audit?.outcome, "SUCCESS");
  assert.equal(audit?.actorIdSnapshot, admin.user.id, "the audit snapshot survives deletion");
});

test("concurrent opposing disables leave at least one active administrator", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const first = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(first.user.id);
  const second = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(second.user.id);

  const [firstAttempt, secondAttempt] = await Promise.all([
    send("PATCH", `/api/admin/users/${second.user.id}/status`, {
      disabled: true,
      expectedVersion: second.user.accountVersion,
    }, { token: first.token }),
    send("PATCH", `/api/admin/users/${first.user.id}/status`, {
      disabled: true,
      expectedVersion: first.user.accountVersion,
    }, { token: second.token }),
  ]);

  const statuses = [firstAttempt.status, secondAttempt.status];
  assert.ok(statuses.includes(200), `at least one disable succeeds (got ${statuses.join(", ")})`);
  for (const status of statuses) {
    assert.ok([200, 401, 409, 503].includes(status), `unexpected status ${status}`);
  }

  const activeAdmins = await db.user.count({
    where: { id: { in: [first.user.id, second.user.id] }, role: "ADMIN", disabledAt: null },
  });
  assert.ok(activeAdmins >= 1, "the installation always keeps an active administrator");

  // The losing request is rejected either because its own session was revoked
  // by the winner (401) or because it would remove the last active admin (409).
  const rejected = firstAttempt.status === 200 ? secondAttempt : firstAttempt;
  if (rejected.status === 401) {
    assert.equal((await rejected.json()).code, "UNAUTHORIZED");
  } else if (rejected.status === 409) {
    assert.equal((await rejected.json()).code, "LAST_ADMIN");
  }
});

test("an administrator cannot mutate another owner's private world through author endpoints", { skip: !origin }, async context => {
  const db = testPrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const owner = await db.user.create({
    data: { name: "Private owner", email: `private-owner-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(owner.id);
  const world = await db.world.create({
    data: { ownerId: owner.id, title: "Private world", slug: `private-${randomUUID()}` },
  });
  const article = await db.article.create({
    data: { worldId: world.id, title: "Original title", slug: `private-article-${randomUUID()}`, publicationStatus: "DRAFT", visibility: "PRIVATE" },
  });

  const attempt = await send("PATCH", `/api/articles/${article.id}`, { title: "Hijacked" }, { token: admin.token });
  assert.equal(attempt.status, 404, "installation admin status does not grant author access");
  const stored = await db.article.findUniqueOrThrow({ where: { id: article.id }, select: { title: true } });
  assert.equal(stored.title, "Original title");
});
