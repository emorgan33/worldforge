import assert from "node:assert/strict";
import { test } from "node:test";
import { isRecord, readWorkspaceJson, WorkspaceHttpError } from "../src/lib/workspace-client";

test("workspace response decoding retains structured HTTP errors and validates success values", async () => {
  await assert.rejects(
    readWorkspaceJson(Response.json({ error: "No access", code: "FORBIDDEN" }, { status: 403 }), isRecord, "Request failed."),
    (error: unknown) => error instanceof WorkspaceHttpError && error.status === 403 && error.code === "FORBIDDEN" && error.message === "No access",
  );
  assert.deepEqual(await readWorkspaceJson(Response.json({ value: 3 }), isRecord, "Request failed."), { value: 3 });
  await assert.rejects(readWorkspaceJson(Response.json({ value: 3 }), (value): value is string => typeof value === "string", "Request failed."), /invalid shape/);
});
