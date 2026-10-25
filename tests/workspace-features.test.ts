import assert from "node:assert/strict";
import { test } from "node:test";
import { saveWorkspaceMapMutation, saveWorkspaceVariable } from "../src/lib/workspace-features";

test("workspace variable writes send typed bodies and surface API errors", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return calls.length === 1
      ? Response.json({ id: "variable-1" })
      : Response.json({ error: "Variable was revoked." }, { status: 403 });
  }) as typeof fetch;
  await saveWorkspaceVariable("variable-1", "new value", fetcher);
  await assert.rejects(saveWorkspaceVariable("variable-1", "blocked", fetcher), /Variable was revoked\./);
  assert.equal(calls[0].url, "/api/variables");
  assert.equal(calls[0].init?.method, "PATCH");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { id: "variable-1", value: "new value" });
});

test("workspace map mutation selects the route method and refreshes the same world", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return calls.length === 1 ? Response.json({ success: true }) : Response.json([{ id: "map-1" }]);
  }) as typeof fetch;
  const result = await saveWorkspaceMapMutation("world 1", { action: "deleteMap", mapId: "map-1" }, fetcher);
  assert.deepEqual(result, { result: { success: true }, maps: [{ id: "map-1" }] });
  assert.equal(calls[0].init?.method, "DELETE");
  assert.equal(calls[1].url, "/api/maps?worldId=world%201");
});
