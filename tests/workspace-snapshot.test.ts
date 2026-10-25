import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWorldSnapshot } from "../src/lib/workspace-snapshot";

test("world snapshot loads all projections in parallel and validates array DTOs", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; signal: AbortSignal | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), signal: init?.signal as AbortSignal ?? null });
    return Response.json([{ id: String(requests.length) }]);
  }) as typeof fetch;
  const controller = new AbortController();
  try {
    const snapshot = await fetchWorldSnapshot("world-1", controller.signal);
    assert.equal(snapshot.length, 7);
    assert.equal(requests.length, 7);
    assert.ok(requests.every(request => request.signal === controller.signal));
    assert.deepEqual(requests.map(request => request.url), [
      "/api/articles?worldId=world-1",
      "/api/variables?worldId=world-1",
      "/api/maps?worldId=world-1",
      "/api/timelines?worldId=world-1",
      "/api/secrets?worldId=world-1",
      "/api/statblocks?worldId=world-1",
      "/api/worlds/world-1/sessions",
    ]);
  } finally { globalThis.fetch = originalFetch; }
});

test("world snapshot rejects the entire load when any projection fails or is malformed", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/maps?")
      ? Response.json({ error: "Map access failed." }, { status: 403 })
      : Response.json([])) as typeof fetch;
    await assert.rejects(fetchWorldSnapshot("world-2", new AbortController().signal), /Map access failed\./);

    globalThis.fetch = (async (input: RequestInfo | URL) => String(input).includes("/maps?")
      ? Response.json({ unexpected: true })
      : Response.json([])) as typeof fetch;
    await assert.rejects(fetchWorldSnapshot("world-2", new AbortController().signal), /invalid shape/);
  } finally { globalThis.fetch = originalFetch; }
});
