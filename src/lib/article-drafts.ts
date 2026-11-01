import { isArticleVersion, type ArticleSaveInput } from "./article-save";
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
      (data.expectedVersion !== undefined && !isArticleVersion(data.expectedVersion)) ||
      (data.canonState !== undefined && typeof data.canonState !== "string") ||
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

// Account, world and top-level-window scoped drafts. Older versions used an
// account-scoped key without the window suffix, then an older world-only key.
// Legacy entries are only inspected for the authorized selected world (the
// caller is the mounted workspace form), validated by the existing parser,
// copied to the new key when safe, and retained until recovery, save or an
// explicit discard resolves them.

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function articleDraftKey(actorId: string, worldId: string, articleId?: string | null, sessionId?: string): string {
  return `worldforge:draft:${actorId}:${worldId}:${articleId || "new"}${sessionId ? `:${sessionId}` : ""}`;
}

export const ARTICLE_DRAFT_WINDOW_PREFIX = "worldforge-draft-tab:";
export interface DraftWindowIdentity { getName(): string; setName(value: string): void }

/** window.name survives reloads but is not copied when window.open creates a new top-level window. */
export function articleDraftSessionId(identity: DraftWindowIdentity): string {
  const name = identity.getName();
  const match = name.match(/^worldforge-draft-tab:([\w-]+)(?::|$)/);
  if (match) return match[1];
  const sessionId = globalThis.crypto.randomUUID();
  identity.setName(`${ARTICLE_DRAFT_WINDOW_PREFIX}${sessionId}${name ? `:${name}` : ""}`);
  return sessionId;
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
  sessionId?: string,
): { stored: StoredArticleDraft | null; legacyCopied: boolean } {
  let accountRaw: string | null;
  try {
    accountRaw = storage.getItem(articleDraftKey(actorId, worldId, articleId, sessionId));
  } catch {
    // Storage unavailable: never strand an otherwise readable recovery by
    // falling through to a legacy read that will fail the same way.
    return { stored: null, legacyCopied: false };
  }
  if (accountRaw) {
    const draft = parseArticleDraft(accountRaw, worldId);
    return { stored: draft ? { draft, source: "account" } : null, legacyCopied: false };
  }
  // Migrate the previous account-scoped key into this window's private key.
  // Retain the source until this window resolves recovery; another window may
  // still need to migrate it before it can edit.
  if (sessionId) {
    const previousAccountKey = articleDraftKey(actorId, worldId, articleId);
    const previousAccountRaw = storage.getItem(previousAccountKey);
    if (previousAccountRaw) {
      const draft = parseArticleDraft(previousAccountRaw, worldId);
      if (draft) {
        let legacyCopied = false;
        try { storage.setItem(articleDraftKey(actorId, worldId, articleId, sessionId), previousAccountRaw); legacyCopied = true; } catch { /* return recovery even when migration cannot write */ }
        return { stored: { draft, source: "account" }, legacyCopied };
      }
    }
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
    storage.setItem(articleDraftKey(actorId, worldId, articleId, sessionId), legacyRaw);
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
  sessionId?: string,
): boolean {
  try {
    storage.setItem(articleDraftKey(actorId, worldId, articleId, sessionId), JSON.stringify(draft));
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
  options?: { legacy?: boolean; sessionId?: string },
): void {
  try { storage.removeItem(articleDraftKey(actorId, worldId, articleId, options?.sessionId)); } catch { /* best effort */ }
  if (options?.legacy) {
    try { storage.removeItem(articleDraftKey(actorId, worldId, articleId)); } catch { /* best effort */ }
    try { storage.removeItem(legacyArticleDraftKey(worldId, articleId)); } catch { /* best effort */ }
  }
}
