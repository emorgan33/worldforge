import type { ArticleSaveInput } from "@/components/article/ArticleEditorForm";
import { ARTICLE_TEMPLATES } from "./templates";

export interface ArticleDraft { version: 1; articleId?: string; data: ArticleSaveInput }

/** Ignore damaged or incompatible browser drafts rather than breaking the editor. */
export function parseArticleDraft(raw: string, worldId: string): ArticleDraft | null {
  try {
    const draft = JSON.parse(raw);
    const data = draft?.data;
    if (draft?.version !== 1 || !data || data.worldId !== worldId ||
      !["title", "excerpt", "tags", "contentHtml"].every(key => typeof data[key] === "string") ||
      typeof data.template !== "string" || !(data.template in ARTICLE_TEMPLATES) ||
      !["DRAFT", "WIP", "PUBLISHED", "PRIVATE"].includes(data.state) ||
      (data.publicationStatus !== undefined && !["DRAFT", "WIP", "PUBLISHED"].includes(data.publicationStatus)) ||
      (data.visibility !== undefined && !["PRIVATE", "PUBLIC"].includes(data.visibility)) ||
      !(data.categoryId === null || typeof data.categoryId === "string") ||
      (data.coverImage !== undefined && typeof data.coverImage !== "string") ||
      (data.portraitImage !== undefined && typeof data.portraitImage !== "string") ||
      (data.coverImageAlt !== undefined && data.coverImageAlt !== null && typeof data.coverImageAlt !== "string") ||
      (data.portraitImageAlt !== undefined && data.portraitImageAlt !== null && typeof data.portraitImageAlt !== "string") ||
      !data.metadata || Array.isArray(data.metadata) || typeof data.metadata !== "object" ||
      !Object.values(data.metadata).every(value => typeof value === "string") ||
      (data.contentJson !== undefined && (data.contentJson?.type !== "doc" || !Array.isArray(data.contentJson.content))) ||
      (draft.articleId !== undefined && typeof draft.articleId !== "string")) return null;
    return draft;
  } catch { return null; }
}

// Account+world-scoped draft storage with a compatibility reader for the
// legacy world-only key `worldforge:draft:<worldId>:<articleId-or-new>`.
// Legacy entries are only inspected for the authorized selected world (the
// caller is the mounted workspace form), validated by the existing parser,
// copied to the new key when safe, and retained until recovery, save or an
// explicit discard resolves them.

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function articleDraftKey(actorId: string, worldId: string, articleId?: string | null): string {
  return `worldforge:draft:${actorId}:${worldId}:${articleId || "new"}`;
}

export function legacyArticleDraftKey(worldId: string, articleId?: string | null): string {
  return `worldforge:draft:${worldId}:${articleId || "new"}`;
}

export interface StoredArticleDraft { draft: ArticleDraft; source: "account" | "legacy" }

export function readArticleDraft(
  storage: DraftStorage,
  actorId: string,
  worldId: string,
  articleId?: string | null,
): { stored: StoredArticleDraft | null; legacyCopied: boolean } {
  let accountRaw: string | null;
  try {
    accountRaw = storage.getItem(articleDraftKey(actorId, worldId, articleId));
  } catch {
    // Storage unavailable: never strand an otherwise readable recovery by
    // falling through to a legacy read that will fail the same way.
    return { stored: null, legacyCopied: false };
  }
  if (accountRaw) {
    const draft = parseArticleDraft(accountRaw, worldId);
    return { stored: draft ? { draft, source: "account" } : null, legacyCopied: false };
  }
  const legacyKey = legacyArticleDraftKey(worldId, articleId);
  const legacyRaw = storage.getItem(legacyKey);
  if (!legacyRaw) return { stored: null, legacyCopied: false };
  const draft = parseArticleDraft(legacyRaw, worldId);
  if (!draft) return { stored: null, legacyCopied: false };
  // Copy to the new key. A failed copy (quota, denied storage) must not strand
  // recovery: the draft is still returned for this session and the legacy
  // entry stays in place.
  let legacyCopied = false;
  try {
    storage.setItem(articleDraftKey(actorId, worldId, articleId), legacyRaw);
    legacyCopied = true;
  } catch { legacyCopied = false; }
  return { stored: { draft, source: "legacy" }, legacyCopied };
}

export function writeArticleDraft(
  storage: DraftStorage,
  actorId: string,
  worldId: string,
  articleId: string | null | undefined,
  draft: ArticleDraft,
): boolean {
  try {
    storage.setItem(articleDraftKey(actorId, worldId, articleId), JSON.stringify(draft));
    return true;
  } catch { return false; }
}

/** Remove the account-scoped draft. Legacy entries are only removed when the
 * recovery is resolved (restore+save or explicit discard). Best effort: a
 * denied removal never throws into the caller. */
export function removeArticleDraft(
  storage: DraftStorage,
  actorId: string,
  worldId: string,
  articleId: string | null | undefined,
  options?: { legacy?: boolean },
): void {
  try { storage.removeItem(articleDraftKey(actorId, worldId, articleId)); } catch { /* best effort */ }
  if (options?.legacy) {
    try { storage.removeItem(legacyArticleDraftKey(worldId, articleId)); } catch { /* best effort */ }
  }
}
