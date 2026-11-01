import assert from "node:assert/strict";
import { test } from "node:test";
import { ArticleSaveError, type ArticleSaveInput } from "../src/lib/article-save";
import { loadWorkspaceArticle, saveWorkspaceArticle } from "../src/lib/workspace-articles";
import type { ArticleDetail } from "../src/types";

const savedArticle = {
  id: "article-1", worldId: "world-1", template: "GENERIC", title: "Lore", slug: "lore",
  state: "DRAFT", isPinned: false, order: 0, wordCount: 1, createdAt: "2026-10-24", updatedAt: "2026-10-24", version: 1,
};
const detail = { ...savedArticle, children: [], outboundMentions: [], inboundMentions: [], secrets: [] } as ArticleDetail;
const input: ArticleSaveInput = {
  worldId: "world-1", template: "GENERIC", title: "Lore", categoryId: null, excerpt: "", tags: "",
  state: "DRAFT", contentHtml: "<p>Lore</p>", metadata: {}, expectedVersion: 1,
};

test("article detail loads commit only while the request is live and its world epoch is current", async () => {
  let resolveResponse: ((response: Response) => void) | undefined;
  let committed: ArticleDetail | undefined;
  const controller = loadWorkspaceArticle({
    articleId: "article-1", worldId: "world-1", epoch: 3,
    isCurrent: () => true,
    setCurrentArticle: article => { committed = article; },
    fetcher: (() => new Promise<Response>(resolve => { resolveResponse = resolve; })) as typeof fetch,
  });
  controller.abort();
  resolveResponse!(Response.json(detail));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(committed, undefined);
});

test("article save conflicts retain their typed code and reset saving state", async () => {
  const saving: boolean[] = [];
  const deps = {
    input, currentArticle: detail, options: undefined, worldId: "world-1", epoch: 3,
    canStart: () => true, isCurrent: () => true,
    setSaving: (value: boolean) => saving.push(value),
    setArticles: () => undefined,
    setCurrentArticle: () => undefined,
    setEditorDirty: () => undefined,
    setSelectedArticleId: () => undefined,
    setActiveView: () => undefined,
    fetcher: (async () => Response.json({ code: "ARTICLE_CONFLICT", error: "Changed elsewhere." }, { status: 409 })) as typeof fetch,
  };
  await assert.rejects(saveWorkspaceArticle(deps), (error: unknown) => error instanceof ArticleSaveError && error.code === "ARTICLE_CONFLICT");
  assert.deepEqual(saving, [true, false]);
});

test("a committed article write does not update state after its world epoch becomes stale", async () => {
  let calls = 0;
  let stateUpdates = 0;
  const fetcher = (async (url: RequestInfo | URL) => {
    calls++;
    if (calls === 1) return Response.json(savedArticle);
    return String(url).includes("?worldId=") ? Response.json([savedArticle]) : Response.json({ ...detail, version: 2 });
  }) as typeof fetch;
  const result = await saveWorkspaceArticle({
    input, currentArticle: detail, worldId: "world-1", epoch: 4,
    canStart: () => true, isCurrent: () => false,
    setSaving: () => undefined,
    setArticles: () => { stateUpdates++; },
    setCurrentArticle: () => { stateUpdates++; },
    setEditorDirty: () => { stateUpdates++; },
    setSelectedArticleId: () => { stateUpdates++; },
    setActiveView: () => { stateUpdates++; },
    fetcher,
  });
  assert.deepEqual(result, { id: "article-1", version: 1 });
  assert.equal(calls, 3);
  assert.equal(stateUpdates, 0);
});
