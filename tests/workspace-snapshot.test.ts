import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWorldSnapshot } from "../src/lib/workspace-snapshot";

const article = (id: string) => ({
  id,
  worldId: "world-1",
  categoryId: null,
  template: "GENERIC",
  title: `Article ${id}`,
  slug: `article-${id}`,
  excerpt: null,
  publicationStatus: "DRAFT",
  visibility: "PRIVATE",
  state: "DRAFT",
  isPinned: false,
  order: 0,
  wordCount: 0,
  coverImage: null,
  coverImageAlt: null,
  portraitImage: null,
  portraitImageAlt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  category: null,
});

test("world snapshot loads all projections in parallel and validates array DTOs", async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; signal: AbortSignal | null }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), signal: init?.signal as AbortSignal ?? null });
    if (String(input).startsWith("/api/articles?")) return Response.json([article("article-1")]);
    return Response.json([]);
  }) as typeof fetch;
  const controller = new AbortController();
  try {
    const snapshot = await fetchWorldSnapshot("world-1", controller.signal);
    assert.equal(snapshot.length, 7);
    assert.equal(requests.length, 7);
    assert.deepEqual(snapshot[0], [article("article-1")]);
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

test("workspace article list follows the cursor at the 200 item page boundary", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const idFor = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  const firstPage = Array.from({ length: 200 }, (_, index) => article(idFor(index)));
  const secondPage = [article(idFor(200))];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    return Response.json(url.includes("cursor=") ? secondPage : firstPage);
  }) as typeof fetch;
  try {
    const { fetchWorkspaceArticleList } = await import("../src/lib/workspace-articles");
    const articles = await fetchWorkspaceArticleList("world-1");
    assert.equal(articles.length, 201);
    assert.equal(requests.length, 2);
    assert.match(requests[1], new RegExp(`cursor=${idFor(199)}`));
  } finally { globalThis.fetch = originalFetch; }
});

test("workspace article list does not request another page for a short first page", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return Response.json([article("article-1")]);
  }) as typeof fetch;
  try {
    const { fetchWorkspaceArticleList } = await import("../src/lib/workspace-articles");
    assert.equal((await fetchWorkspaceArticleList("world-1")).length, 1);
    assert.equal(requests, 1);
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
