import assert from "node:assert/strict";
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
      name: `Admin fixture ${stamp.slice(0, 8)}`,
      email: `admin-fixture-${stamp}@example.invalid`,
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

function fetchAs(token: string | null, path: string) {
  const headers: Record<string, string> = { Origin: origin! };
  if (token) headers.Cookie = `${SESSION_COOKIE}=${token}`;
  return fetch(`${origin}${path}`, { headers });
}

const ADMIN_READ_PATHS = [
  "/api/admin/users",
  "/api/admin/audit",
];

test("admin read APIs reject anonymous, non-admin, expired, and disabled callers", { skip: !origin }, async context => {
  const db = new PrismaClient();
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
  const expiredAdmin = await createUserWithSession(db, { role: "ADMIN", expired: true });
  createdUserIds.push(expiredAdmin.user.id);
  const disabledAdmin = await createUserWithSession(db, { role: "ADMIN", disabled: true });
  createdUserIds.push(disabledAdmin.user.id);

  const targetPaths = (id: string) => [
    `/api/admin/users/${id}`,
    `/api/admin/users/${id}/sessions`,
    `/api/admin/users/${id}/deletion-preview`,
  ];

  // Anonymous callers receive 401 with no account detail.
  for (const path of [...ADMIN_READ_PATHS, ...targetPaths(admin.user.id)]) {
    const response = await fetchAs(null, path);
    assert.equal(response.status, 401, `anonymous ${path}`);
    const body = await response.json();
    assert.equal(body.code, "UNAUTHORIZED");
    assert.equal(body.users, undefined);
    assert.equal(body.account, undefined);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }

  // Signed-in non-admins receive 403.
  for (const [label, session] of [["AUTHOR", author], ["GM", gm], ["PLAYER", player]] as const) {
    for (const path of [...ADMIN_READ_PATHS, ...targetPaths(admin.user.id)]) {
      const response = await fetchAs(session.token, path);
      assert.equal(response.status, 403, `${label} ${path}`);
      const body = await response.json();
      assert.equal(body.code, "FORBIDDEN");
      assert.equal(body.users, undefined);
      assert.equal(body.account, undefined);
    }
  }

  // Expired, disabled, and revoked admin sessions are not authorized on any
  // of the five routes, not just the list routes.
  const revokedAdmin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(revokedAdmin.user.id);
  await db.authSession.deleteMany({ where: { userId: revokedAdmin.user.id } });

  for (const [label, session] of [["expired", expiredAdmin], ["disabled", disabledAdmin], ["revoked", revokedAdmin]] as const) {
    for (const path of [...ADMIN_READ_PATHS, ...targetPaths(admin.user.id)]) {
      const response = await fetchAs(session.token, path);
      assert.equal(response.status, 401, `${label} ${path}`);
      const body = await response.json();
      assert.equal(body.code, "UNAUTHORIZED", `${label} ${path}`);
      assert.equal(body.users, undefined);
      assert.equal(body.account, undefined);
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    }
  }
});

test("admin account list returns safe DTOs only and supports filters and stable cursors", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const stamp = randomUUID().slice(0, 8);
  const listed = await db.user.create({
    data: { name: `Listed ${stamp}`, email: `listed-${stamp}@example.invalid`, role: "PLAYER" },
  });
  createdUserIds.push(listed.id);
  const hidden = await db.user.create({
    data: { name: `Hidden ${stamp}`, email: `hidden-${stamp}@example.invalid`, role: "GM" },
  });
  createdUserIds.push(hidden.id);
  const disabled = await db.user.create({
    data: { name: `Listed ${stamp}`, email: `disabled-${stamp}@example.invalid`, role: "PLAYER", disabledAt: new Date() },
  });
  createdUserIds.push(disabled.id);

  const response = await fetchAs(admin.token, "/api/admin/users");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  const page = await response.json();
  assert.ok(Array.isArray(page.users));
  assert.ok("nextCursor" in page);

  const serialised = JSON.stringify(page);
  assert.equal(serialised.includes("passwordHash"), false);
  assert.equal(serialised.includes("tokenHash"), false);
  assert.equal(serialised.includes(admin.token), false);

  for (const user of page.users) {
    assert.deepEqual(Object.keys(user).sort(), [
      "accountVersion", "createdAt", "disabledAt", "email", "id", "lastSignInAt", "name", "role", "setupPending",
    ]);
  }

  // Name/email search narrows the result set.
  const searched = await (await fetchAs(admin.token, `/api/admin/users?search=${encodeURIComponent(stamp)}`)).json();
  assert.ok(searched.users.length >= 2);
  assert.ok(searched.users.every((user: { email: string; name: string }) => user.email.includes(stamp) || user.name.includes(stamp)));

  // Search is ASCII case-insensitive on SQLite (LIKE). Emails are stored
  // lowercase, so an uppercase query still has to find them. If this fails on
  // another database, see the portability note in admin-read.ts.
  const caseToken = `CaseProbe${stamp}`;
  const caseUser = await db.user.create({ data: { name: "Case probe", email: `${caseToken.toLowerCase()}@example.invalid`, role: "PLAYER" } });
  createdUserIds.push(caseUser.id);
  const upperCased = await (await fetchAs(admin.token, `/api/admin/users?search=${caseToken.toUpperCase()}`)).json();
  assert.equal(
    upperCased.users.some((user: { id: string }) => user.id === caseUser.id),
    true,
    "uppercase search must match the normalized lowercase email",
  );

  // The undocumented `q` alias is not read; `search` is the only search field.
  // An ignored `q` must leave the result set identical to an unfiltered list,
  // not narrow it to the matching account.
  const unfiltered = await (await fetchAs(admin.token, "/api/admin/users")).json();
  const aliasOnly = await (await fetchAs(admin.token, `/api/admin/users?q=${encodeURIComponent(caseToken)}`)).json();
  assert.deepEqual(
    aliasOnly.users.map((user: { id: string }) => user.id),
    unfiltered.users.map((user: { id: string }) => user.id),
    "an undocumented `q` parameter must not silently act as a search",
  );

  // Role filter.
  const roleFiltered = await (await fetchAs(admin.token, "/api/admin/users?role=GM")).json();
  assert.ok(roleFiltered.users.every((user: { role: string }) => user.role === "GM"));

  // Status filter.
  const disabledFiltered = await (await fetchAs(admin.token, "/api/admin/users?status=disabled")).json();
  assert.ok(disabledFiltered.users.every((user: { disabledAt: string | null }) => user.disabledAt !== null));
  assert.ok(disabledFiltered.users.some((user: { id: string }) => user.id === disabled.id));

  // Bounded page size and stable cursor pagination with no duplicates or gaps.
  const firstPage = await (await fetchAs(admin.token, "/api/admin/users?limit=2")).json();
  assert.equal(firstPage.users.length, 2);
  assert.ok(firstPage.nextCursor);

  const secondPage = await (await fetchAs(admin.token, `/api/admin/users?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).json();
  const firstIds = firstPage.users.map((user: { id: string }) => user.id);
  const secondIds = secondPage.users.map((user: { id: string }) => user.id);
  assert.equal(firstIds.some((id: string) => secondIds.includes(id)), false, "cursor pages must not overlap");

  // A cursor must not widen the active search filter. A non-matching account
  // created between two matching accounts must never leak onto a later page.
  const filterToken = `FilterToken${stamp}`;
  const matchOne = await db.user.create({ data: { name: `${filterToken} one`, email: `match1-${stamp}@example.invalid`, role: "AUTHOR" } });
  createdUserIds.push(matchOne.id);
  const nonMatch = await db.user.create({ data: { name: `Unrelated ${stamp}`, email: `unrelated-${stamp}@example.invalid`, role: "AUTHOR" } });
  createdUserIds.push(nonMatch.id);
  const matchTwo = await db.user.create({ data: { name: `${filterToken} two`, email: `match2-${stamp}@example.invalid`, role: "AUTHOR" } });
  createdUserIds.push(matchTwo.id);

  const filteredFirst = await (await fetchAs(admin.token, `/api/admin/users?limit=1&search=${filterToken}`)).json();
  assert.equal(filteredFirst.users.length, 1);
  assert.ok(filteredFirst.nextCursor);
  const filteredSecond = await (await fetchAs(
    admin.token,
    `/api/admin/users?limit=10&search=${filterToken}&cursor=${encodeURIComponent(filteredFirst.nextCursor)}`,
  )).json();
  assert.ok(filteredSecond.users.length >= 1, "the second filtered page still has the remaining match");
  for (const user of filteredSecond.users) {
    assert.ok(
      user.name.includes(filterToken) || user.email.includes(filterToken),
      `page 2 row ${user.id} must match the search filter`,
    );
  }
  assert.equal(filteredSecond.users.some((user: { id: string }) => user.id === nonMatch.id), false, "a non-matching account must not leak through the cursor");

  // Invalid inputs are rejected with a stable code.
  for (const query of ["role=WIZARD", "status=unknown", "limit=0", "limit=abc", "search=" + "x".repeat(300)]) {
    const invalid = await fetchAs(admin.token, `/api/admin/users?${query}`);
    assert.equal(invalid.status, 400, query);
    const body = await invalid.json();
    assert.equal(body.code, "INVALID_INPUT");
  }

  const badCursor = await fetchAs(admin.token, "/api/admin/users?cursor=not-a-cursor");
  assert.equal(badCursor.status, 400);
  assert.equal((await badCursor.json()).code, "INVALID_INPUT");

  // Unknown targets are 404, not an empty success.
  const missing = await fetchAs(admin.token, "/api/admin/users/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "NOT_FOUND");
});

test("admin account detail exposes counts and summaries without content bodies", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const target = await db.user.create({
    data: { name: "Detail target", email: `detail-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(target.id);

  const world = await db.world.create({
    data: { ownerId: target.id, title: "Owned world title", slug: `detail-${randomUUID()}` },
  });
  await db.worldMember.create({
    data: { worldId: world.id, userId: target.id, role: "PLAYER", status: "ACTIVE" },
  });

  const response = await fetchAs(admin.token, `/api/admin/users/${target.id}`);
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.account.id, target.id);
  assert.equal(detail.membershipCount, 1);
  assert.ok(Array.isArray(detail.worlds));
  assert.equal(detail.worlds[0].title, "Owned world title");
  assert.equal("contentHtml" in (detail.worlds[0] ?? {}), false);
  assert.equal("description" in (detail.worlds[0] ?? {}), false);
  assert.equal(JSON.stringify(detail).includes("passwordHash"), false);
  assert.equal(JSON.stringify(detail).includes("tokenHash"), false);
  assert.equal(detail.account.passwordHash, undefined);

  // Session listing returns opaque IDs and never token hashes.
  await db.authSession.create({
    data: { userId: target.id, tokenHash: digest("target-secret"), expiresAt: new Date(Date.now() + 60_000) },
  });
  await db.authSession.create({
    data: { userId: target.id, tokenHash: digest("expired-secret"), expiresAt: new Date(Date.now() - 60_000) },
  });
  const sessions = await (await fetchAs(admin.token, `/api/admin/users/${target.id}/sessions`)).json();
  assert.equal(sessions.sessions.length, 1, "expired sessions are excluded");
  assert.equal(sessions.sessions[0].id.length > 0, true);
  assert.equal(JSON.stringify(sessions).includes("target-secret"), false);
  assert.equal(JSON.stringify(sessions).includes("expired-secret"), false);
  assert.equal(JSON.stringify(sessions).includes("tokenHash"), false);
  assert.equal(typeof sessions.previewSubjectCount, "number");
  assert.equal(typeof sessions.previewIssuerCount, "number");

  // The admin's own session is flagged as current.
  const ownSessions = await (await fetchAs(admin.token, `/api/admin/users/${admin.user.id}/sessions`)).json();
  assert.equal(ownSessions.sessions.some((session: { current: boolean }) => session.current), true);
});

test("admin deletion preview reports blockers without enabling deletion", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const owner = await db.user.create({
    data: { name: "Owner with world", email: `owner-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(owner.id);
  await db.world.create({ data: { ownerId: owner.id, title: "Blocking world", slug: `blocking-${randomUUID()}` } });

  const response = await fetchAs(admin.token, `/api/admin/users/${owner.id}/deletion-preview`);
  assert.equal(response.status, 200);
  const preview = await response.json();
  assert.equal(preview.allowed, false);
  assert.equal(preview.worlds.length, 1);
  assert.equal(preview.worlds[0].title, "Blocking world");
  assert.equal(typeof preview.accountVersion, "number");
  assert.equal(typeof preview.membershipCount, "number");
  assert.equal(typeof preview.grantCount, "number");
  assert.equal(JSON.stringify(preview).includes("passwordHash"), false);

  // A missing target is a 404 rather than an empty preview.
  const missing = await fetchAs(admin.token, "/api/admin/users/nobody/deletion-preview");
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).code, "NOT_FOUND");
});

test("admin audit read returns sanitized entries with stable pagination and filters", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const target = await db.user.create({
    data: { name: "Audit target", email: `audit-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(target.id);

  await db.installationAuditEvent.create({
    data: {
      actorIdSnapshot: admin.user.id,
      targetIdSnapshot: target.id,
      action: "ROLE_CHANGE",
      outcome: "SUCCESS",
      detailsJson: JSON.stringify({ role: "GM", previousRole: "AUTHOR" }),
      actorType: "WEB_ADMIN",
    },
  });
  await db.installationAuditEvent.create({
    data: {
      actorIdSnapshot: null,
      targetIdSnapshot: target.id,
      action: "ACCOUNT_RECOVERY",
      outcome: "SUCCESS",
      detailsJson: JSON.stringify({}),
      actorType: "LOCAL_OPERATOR",
    },
  });

  const response = await fetchAs(admin.token, "/api/admin/audit");
  assert.equal(response.status, 200);
  const page = await response.json();
  assert.ok(Array.isArray(page.entries));

  const serialised = JSON.stringify(page);
  assert.equal(serialised.includes("passwordHash"), false);
  assert.equal(serialised.includes("tokenHash"), false);

  for (const entry of page.entries) {
    assert.ok("id" in entry);
    assert.ok("action" in entry);
    assert.ok("outcome" in entry);
    assert.ok("actorType" in entry);
    assert.ok("createdAt" in entry);
    assert.equal("actorId" in entry, false);
  }

  // Target filter.
  const byTarget = await (await fetchAs(admin.token, `/api/admin/audit?targetId=${target.id}`)).json();
  assert.ok(byTarget.entries.length >= 2);
  assert.ok(byTarget.entries.every((entry: { targetIdSnapshot: string }) => entry.targetIdSnapshot === target.id));

  // Action filter.
  const byAction = await (await fetchAs(admin.token, "/api/admin/audit?action=ROLE_CHANGE")).json();
  assert.ok(byAction.entries.every((entry: { action: string }) => entry.action === "ROLE_CHANGE"));

  // Unknown action is rejected.
  const unknownAction = await fetchAs(admin.token, "/api/admin/audit?action=NOT_AN_ACTION");
  assert.equal(unknownAction.status, 400);
  assert.equal((await unknownAction.json()).code, "INVALID_INPUT");

  // A malformed cursor is a 400 on this endpoint too, not an empty page.
  const badCursor = await fetchAs(admin.token, "/api/admin/audit?cursor=not-a-cursor");
  assert.equal(badCursor.status, 400);
  assert.equal((await badCursor.json()).code, "INVALID_INPUT");

  // Cursor pagination does not overlap.
  const firstPage = await (await fetchAs(admin.token, "/api/admin/audit?limit=1")).json();
  assert.equal(firstPage.entries.length, 1);
  assert.ok(firstPage.nextCursor);
  const secondPage = await (await fetchAs(admin.token, `/api/admin/audit?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`)).json();
  assert.equal(firstPage.entries[0].id === secondPage.entries[0]?.id, false);
});

test("an administrator cannot read another owner's private world through author endpoints", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);
  const owner = await db.user.create({
    data: { name: "Private owner", email: `private-${randomUUID()}@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(owner.id);
  const world = await db.world.create({
    data: { ownerId: owner.id, title: "Private world", slug: `private-${randomUUID()}` },
  });
  await db.article.create({
    data: { worldId: world.id, title: "PRIVATE_ARTICLE_SENTINEL", slug: "private-article", publicationStatus: "DRAFT", visibility: "PRIVATE" },
  });

  const articles = await fetchAs(admin.token, `/api/articles?worldId=${world.id}`);
  assert.equal(articles.status, 404, "installation admin status does not grant author access to another owner's world");
  const worlds = await (await fetchAs(admin.token, "/api/worlds")).json();
  assert.equal(worlds.some((entry: { id: string }) => entry.id === world.id), false);
});

test("cursor pagination is stable when rows share a createdAt timestamp", { skip: !origin }, async context => {
  const db = new PrismaClient();
  const createdUserIds: string[] = [];
  context.after(async () => {
    await deleteTestUsers(db, ...createdUserIds);
    await db.$disconnect();
  });

  const admin = await createUserWithSession(db, { role: "ADMIN" });
  createdUserIds.push(admin.user.id);

  const stamp = randomUUID().slice(0, 8);
  const tieToken = `TieToken${stamp}`;
  const tiedAt = new Date("2026-02-01T12:00:00.000Z");

  for (const suffix of ["a", "b", "c"]) {
    const user = await db.user.create({
      data: {
        name: `${tieToken} ${suffix}`,
        email: `${tieToken.toLowerCase()}-${suffix}@example.invalid`,
        role: "AUTHOR",
        createdAt: tiedAt,
      },
    });
    createdUserIds.push(user.id);
  }

  const userIds: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ search: tieToken, limit: "1" });
    if (cursor) query.set("cursor", cursor);
    const body = await (await fetchAs(admin.token, `/api/admin/users?${query}`)).json();
    for (const user of body.users) userIds.push(user.id);
    cursor = body.nextCursor;
    if (!cursor) break;
  }

  assert.equal(userIds.length, 3, "every equal-timestamp row is returned exactly once");
  assert.equal(new Set(userIds).size, 3, "no row repeats across pages");

  // The same tiebreaker has to hold for the audit list.
  const target = await db.user.create({
    data: { name: `${tieToken} target`, email: `${tieToken.toLowerCase()}-target@example.invalid`, role: "AUTHOR" },
  });
  createdUserIds.push(target.id);

  for (const suffix of ["x", "y", "z"]) {
    await db.installationAuditEvent.create({
      data: {
        actorIdSnapshot: admin.user.id,
        targetIdSnapshot: target.id,
        action: "ROLE_CHANGE",
        outcome: "SUCCESS",
        reasonCode: suffix,
        detailsJson: JSON.stringify({ suffix }),
        actorType: "WEB_ADMIN",
        createdAt: tiedAt,
      },
    });
  }

  const eventIds: string[] = [];
  cursor = null;
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ targetId: target.id, limit: "1" });
    if (cursor) query.set("cursor", cursor);
    const body = await (await fetchAs(admin.token, `/api/admin/audit?${query}`)).json();
    for (const entry of body.entries) eventIds.push(entry.id);
    cursor = body.nextCursor;
    if (!cursor) break;
  }

  assert.equal(eventIds.length, 3, "every equal-timestamp audit event is returned exactly once");
  assert.equal(new Set(eventIds).size, 3, "no audit event repeats across pages");
});
