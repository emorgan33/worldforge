import assert from "node:assert/strict";
import { test } from "node:test";
import {
  articleDraftKey,
  legacyArticleDraftKey,
  parseArticleDraft,
  readArticleDraft,
  removeArticleDraft,
  type ArticleDraft,
  writeArticleDraft,
} from "../src/lib/article-drafts";
const draft: ArticleDraft = { version: 1, articleId: "saved-id", data: { worldId: "world", title: "Recovery", template: "GENERIC", categoryId: null, excerpt: "", tags: "", state: "DRAFT", contentHtml: "<p>Lore</p>", contentJson: { type: "doc", content: [{ type: "paragraph" }] }, metadata: { rulesSystem: "PF_2E" } } };
test("recovery retains structured content and the created article identity", () => {
  assert.deepEqual(parseArticleDraft(JSON.stringify(draft), "world"), draft);
});
test("recovery rejects cross-world, incompatible and malformed drafts", () => {
  assert.equal(parseArticleDraft(JSON.stringify(draft), "other-world"), null);
  for (const raw of ["{", "null", JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, data: { ...draft.data, metadata: null } }), JSON.stringify({ ...draft, data: { ...draft.data, contentJson: { type: "paragraph" } } })]) assert.equal(parseArticleDraft(raw, "world"), null);
});

test("recovery retains placement images and their descriptions", () => {
  const withPlacement: ArticleDraft = { version: 1, articleId: "saved-id", data: { ...draft.data, coverImage: "/api/assets/11111111-1111-1111-1111-111111111111/file", coverImageAlt: "A cover", portraitImage: "/api/assets/22222222-2222-2222-2222-222222222222/file", portraitImageAlt: "" } };
  assert.deepEqual(parseArticleDraft(JSON.stringify(withPlacement), "world"), withPlacement);
  // null descriptions are valid (keep the renderer default) and so is decorative "".
  const nullAlt = { ...withPlacement, data: { ...withPlacement.data, coverImageAlt: null, portraitImageAlt: null } };
  assert.deepEqual(parseArticleDraft(JSON.stringify(nullAlt), "world"), nullAlt);
  // Non-string descriptions are rejected rather than silently coerced.
  const bad = { ...withPlacement, data: { ...withPlacement.data, coverImageAlt: 42 } };
  assert.equal(parseArticleDraft(JSON.stringify(bad), "world"), null);
  const badPortrait = { ...withPlacement, data: { ...withPlacement.data, portraitImage: 42 } };
  assert.equal(parseArticleDraft(JSON.stringify(badPortrait), "world"), null);
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

test("account+world draft keys isolate actors while legacy keys stay readable", () => {
  assert.notEqual(articleDraftKey("actor-a", "world", "art"), articleDraftKey("actor-b", "world", "art"));
  assert.equal(legacyArticleDraftKey("world", "art"), "worldforge:draft:world:art");
  assert.equal(legacyArticleDraftKey("world", null), "worldforge:draft:world:new");
});

test("a valid legacy draft is migrated to the account key and retained until resolved", () => {
  const storage = memoryStorage({ [legacyArticleDraftKey("world", "art")]: JSON.stringify(draft) });
  const first = readArticleDraft(storage, "actor-a", "world", "art");
  assert.equal(first.stored?.source, "legacy");
  assert.deepEqual(first.stored?.draft, draft);
  assert.equal(first.legacyCopied, true);
  assert.equal(storage.values.has(articleDraftKey("actor-a", "world", "art")), true, "copied to the account key");
  assert.equal(storage.values.has(legacyArticleDraftKey("world", "art")), true, "legacy entry retained until resolved");
  // Legacy entries are world-scoped by design: any authorized author of this
  // world may fall back to them (authorization is the caller's contract).
  const other = readArticleDraft(storage, "actor-b", "world", "art");
  assert.equal(other.stored?.source, "legacy");
  assert.equal(storage.values.has(articleDraftKey("actor-b", "world", "art")), true, "each actor receives their own account copy");
  assert.equal(storage.values.has(legacyArticleDraftKey("world", "art")), true, "legacy still retained for both");
});

test("invalid or cross-world legacy drafts are ignored without copying", () => {
  const storage = memoryStorage({ [legacyArticleDraftKey("world", "art")]: JSON.stringify({ ...draft, data: { ...draft.data, worldId: "other" } }) });
  const result = readArticleDraft(storage, "actor-a", "world", "art");
  assert.equal(result.stored, null);
  assert.equal(result.legacyCopied, false);
  assert.equal(storage.values.has(articleDraftKey("actor-a", "world", "art")), false);
});

test("account drafts win over legacy entries and storage failures never strand recovery", () => {
  const accountDraft = { ...draft, data: { ...draft.data, title: "Account copy" } };
  const storage = memoryStorage({
    [articleDraftKey("actor-a", "world", "art")]: JSON.stringify(accountDraft),
    [legacyArticleDraftKey("world", "art")]: JSON.stringify(draft),
  });
  const result = readArticleDraft(storage, "actor-a", "world", "art");
  assert.equal(result.stored?.source, "account");
  assert.equal(result.stored?.draft.data.title, "Account copy");
  const denied = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
    removeItem: () => { throw new Error("denied"); },
  };
  assert.deepEqual(readArticleDraft(denied, "actor-a", "world", "art"), { stored: null, legacyCopied: false });
  // A failing copy still returns the legacy draft for this session.
  const quota = {
    ...memoryStorage({ [legacyArticleDraftKey("world", "art")]: JSON.stringify(draft) }),
    setItem: () => { throw new Error("quota"); },
  };
  const stranded = readArticleDraft(quota, "actor-a", "world", "art");
  assert.equal(stranded.stored?.source, "legacy");
  assert.equal(stranded.legacyCopied, false);
  assert.equal(quota.values.has(legacyArticleDraftKey("world", "art")), true, "legacy entry untouched after failed copy");
  assert.doesNotThrow(() => removeArticleDraft(denied, "actor-a", "world", "art", { legacy: true }));
});

test("resolved recoveries remove the account key, and legacy only when resolved", () => {
  const storage = memoryStorage({
    [articleDraftKey("actor-a", "world", "art")]: JSON.stringify(draft),
    [legacyArticleDraftKey("world", "art")]: JSON.stringify(draft),
  });
  removeArticleDraft(storage, "actor-a", "world", "art");
  assert.equal(storage.values.has(articleDraftKey("actor-a", "world", "art")), false);
  assert.equal(storage.values.has(legacyArticleDraftKey("world", "art")), true, "legacy survives an unresolved removal");
  removeArticleDraft(storage, "actor-a", "world", "art", { legacy: true });
  assert.equal(storage.values.has(legacyArticleDraftKey("world", "art")), false);
});

test("writing round-trips through the account key for the same actor only", () => {
  const storage = memoryStorage();
  assert.equal(writeArticleDraft(storage, "actor-a", "world", "art", draft), true);
  assert.deepEqual(readArticleDraft(storage, "actor-a", "world", "art").stored, { draft, source: "account" });
  assert.equal(readArticleDraft(storage, "actor-b", "world", "art").stored, null);
});
