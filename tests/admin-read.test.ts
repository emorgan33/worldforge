import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  DEFAULT_ADMIN_PAGE_SIZE,
  MAX_ADMIN_PAGE_SIZE,
  decodeAdminCursor,
  encodeAdminCursor,
  listAdminAuditEvents,
  parseAdminAuditQuery,
  parseAdminUserQuery,
} from "../src/lib/admin-read";
import { adminErrorStatus } from "../src/lib/admin-policy";

test("admin user query parsing applies bounds and rejects unknown filters", () => {
  const parsed = parseAdminUserQuery(new URLSearchParams());
  assert.deepEqual(parsed, {});

  const filtered = parseAdminUserQuery(new URLSearchParams({ role: "ADMIN", status: "disabled", search: "  ada  " }));
  assert.deepEqual(filtered, { role: "ADMIN", status: "disabled", search: "ada" });

  const overlongSearch = parseAdminUserQuery(new URLSearchParams({ search: "x".repeat(255) }));
  assert.equal("code" in overlongSearch && overlongSearch.code, "INVALID_INPUT");

  const unknownRole = parseAdminUserQuery(new URLSearchParams({ role: "SUPERUSER" }));
  assert.equal("code" in unknownRole && unknownRole.code, "INVALID_INPUT");

  const unknownStatus = parseAdminUserQuery(new URLSearchParams({ status: "archived" }));
  assert.equal("code" in unknownStatus && unknownStatus.code, "INVALID_INPUT");

  const zeroLimit = parseAdminUserQuery(new URLSearchParams({ limit: "0" }));
  assert.equal("code" in zeroLimit && zeroLimit.code, "INVALID_INPUT");

  const negativeLimit = parseAdminUserQuery(new URLSearchParams({ limit: "-5" }));
  assert.equal("code" in negativeLimit && negativeLimit.code, "INVALID_INPUT");
});

test("admin user query clamps the page size to the documented maximum", () => {
  const parsed = parseAdminUserQuery(new URLSearchParams({ limit: "5000" }));
  assert.equal("code" in parsed, false);
  if ("code" in parsed) return;
  assert.equal(parsed.limit, MAX_ADMIN_PAGE_SIZE);

  const defaulted = parseAdminUserQuery(new URLSearchParams());
  assert.equal("code" in defaulted, false);
  if ("code" in defaulted) return;
  assert.equal(defaulted.limit, undefined);
  assert.equal(DEFAULT_ADMIN_PAGE_SIZE, 25);
});

test("admin audit query accepts known actions and rejects unknown ones", () => {
  const parsed = parseAdminAuditQuery(new URLSearchParams({ action: "ROLE_CHANGE", targetId: "user-1" }));
  assert.deepEqual(parsed, { action: "ROLE_CHANGE", targetId: "user-1" });

  const unknown = parseAdminAuditQuery(new URLSearchParams({ action: "NOT_A_REAL_ACTION" }));
  assert.equal("code" in unknown && unknown.code, "INVALID_INPUT");
});

test("admin cursors round-trip and reject malformed payloads", () => {
  const payload = { createdAt: "2026-01-01T00:00:00.000Z", id: "abc" };
  const cursor = encodeAdminCursor(payload);
  assert.deepEqual(decodeAdminCursor(cursor), payload);

  assert.equal(decodeAdminCursor("not-base64-json"), null);
  assert.equal(decodeAdminCursor(Buffer.from('{"createdAt":123,"id":"a"}', "utf-8").toString("base64url")), null);
  assert.equal(decodeAdminCursor(Buffer.from('{"createdAt":"nope","id":"a"}', "utf-8").toString("base64url")), null);
  assert.equal(decodeAdminCursor(Buffer.from('{"createdAt":"2026-01-01T00:00:00.000Z"}', "utf-8").toString("base64url")), null);
});

test("a cursor emitted by the encoder is accepted by every admin query parser", () => {
  const cursor = encodeAdminCursor({
    createdAt: "2026-10-31T20:52:26.816Z",
    id: "f0460d6e-4600-47cb-9c29-ee63fa3dc539",
  });

  const users = parseAdminUserQuery(new URLSearchParams({ cursor }));
  assert.equal("code" in users, false, "the users endpoint must accept its own cursor");
  if ("code" in users) return;
  assert.equal(users.cursor, cursor);

  const audit = parseAdminAuditQuery(new URLSearchParams({ cursor }));
  assert.equal("code" in audit, false, "the audit endpoint must accept its own cursor");
  if ("code" in audit) return;
  assert.equal(audit.cursor, cursor);
});

test("admin error codes map onto the documented HTTP statuses", () => {
  assert.equal(adminErrorStatus("UNAUTHORIZED"), 401);
  assert.equal(adminErrorStatus("FORBIDDEN"), 403);
  assert.equal(adminErrorStatus("NOT_FOUND"), 404);
  assert.equal(adminErrorStatus("INVALID_INPUT"), 400);
  assert.equal(adminErrorStatus("INVALID_ROLE"), 400);
  assert.equal(adminErrorStatus("LAST_ADMIN"), 409);
  assert.equal(adminErrorStatus("SELF_CHANGE"), 409);
  assert.equal(adminErrorStatus("ACCOUNT_DISABLED"), 409);
  assert.equal(adminErrorStatus("OWNS_WORLDS"), 409);
  assert.equal(adminErrorStatus("HAS_DURABLE_RECORDS"), 409);
  assert.equal(adminErrorStatus("STALE_ACCOUNT"), 409);
  assert.equal(adminErrorStatus("STALE_WORLD"), 409);
  assert.equal(adminErrorStatus("DUPLICATE_EMAIL"), 409);
  assert.equal(adminErrorStatus("CONCURRENCY_CONFLICT"), 503);
  assert.equal(adminErrorStatus("INTERNAL_ERROR"), 500);
});

test("audit read projection drops credential-shaped detail keys", async () => {
  const rows = [
    {
      id: "event-1",
      actorIdSnapshot: "actor-1",
      targetIdSnapshot: "target-1",
      action: "ROLE_CHANGE",
      outcome: "SUCCESS",
      reasonCode: null,
      detailsJson: JSON.stringify({
        role: "GM",
        previousRole: "AUTHOR",
        passwordHash: "scrypt-v1:leak",
        tokenHash: "leak",
        nested: { setupToken: "leak", count: 2 },
        list: [{ secretValue: "leak", label: "kept" }],
      }),
      actorType: "WEB_ADMIN",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: "event-2",
      actorIdSnapshot: null,
      targetIdSnapshot: null,
      action: "BOOTSTRAP",
      outcome: "SUCCESS",
      reasonCode: null,
      detailsJson: "not json",
      actorType: "LOCAL_OPERATOR",
      createdAt: new Date("2026-01-01T00:00:01.000Z"),
    },
  ];

  const db = {
    installationAuditEvent: { findMany: async () => rows },
  } as unknown as PrismaClient;

  const page = await listAdminAuditEvents(db, {});
  assert.deepEqual(page.entries[0].details, {
    role: "GM",
    previousRole: "AUTHOR",
    nested: { count: 2 },
    list: [{ label: "kept" }],
  });
  assert.deepEqual(page.entries[1].details, {});
  assert.equal(JSON.stringify(page).includes("leak"), false);
});
