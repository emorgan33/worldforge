import type { ArticleDetail, ArticleListItem } from "@/types";
import {
  ArticleSaveError,
  isArticleVersion,
  type ArticleSaveInput,
  type ArticleSaveOptions,
  type ArticleSaveResult,
} from "@/lib/article-save";
import { sortOrdered } from "@/lib/category-tree";
import { isRecord, readWorkspaceJson, type Decoder } from "@/lib/workspace-client";

const templates = new Set([
  "CHARACTER", "CREATURE", "ENCOUNTER", "SETTLEMENT", "BUILDING", "LANDMARK", "GEOGRAPHY",
  "ORGANIZATION", "MILITARY", "SPECIES", "ETHNICITY", "ITEM", "VEHICLE", "TECHNOLOGY",
  "MATERIAL", "CONDITION", "DOCUMENT", "LAW", "LANGUAGE", "TRADITION", "RITUAL", "MYTH",
  "SPELL", "PLOT", "REPORT", "PROSE", "GENERIC",
]);

export function isWorkspaceArticleListItem(value: unknown): value is ArticleListItem {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.worldId === "string"
    && typeof value.template === "string" && templates.has(value.template)
    && typeof value.title === "string"
    && typeof value.slug === "string"
    && ["DRAFT", "WIP", "PUBLISHED", "PRIVATE"].includes(String(value.state))
    && typeof value.isPinned === "boolean"
    && typeof value.order === "number"
    && typeof value.wordCount === "number"
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string";
}

export function isWorkspaceArticleDetail(value: unknown): value is ArticleDetail {
  return isWorkspaceArticleListItem(value)
    && isRecord(value)
    && typeof value.version === "number"
    && Array.isArray(value.children)
    && Array.isArray(value.outboundMentions)
    && Array.isArray(value.inboundMentions)
    && Array.isArray(value.secrets);
}

type SavedArticle = ArticleListItem & { version: number };
const isSavedArticle: Decoder<SavedArticle> = (value): value is SavedArticle =>
  isWorkspaceArticleListItem(value) && isRecord(value) && isArticleVersion(value.version);
const isArticleList = (value: unknown): value is ArticleListItem[] =>
  Array.isArray(value) && value.every(isWorkspaceArticleListItem);
export interface WorkspaceArticlePageOptions {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  cursor?: string;
  query?: string;
}

export const WORKSPACE_ARTICLE_PAGE_SIZE = 200;

/** Read one bounded article-list page in stable server order. */
export async function fetchWorkspaceArticlePage(
  worldId: string,
  options: WorkspaceArticlePageOptions = {},
): Promise<ArticleListItem[]> {
  const fetcher = options.fetcher ?? fetch;
  const params = new URLSearchParams({ worldId });
  if (options.cursor) params.set("cursor", options.cursor);
  if (options.query) params.set("q", options.query);
  const response = await fetcher(`/api/articles?${params}`, { signal: options.signal });
  return readWorkspaceJson(response, isArticleList, "Could not load articles.");
}

/** Read every bounded article-list page in stable server order. */
export async function fetchWorkspaceArticleList(
  worldId: string,
  options: Omit<WorkspaceArticlePageOptions, "cursor" | "query"> = {},
): Promise<ArticleListItem[]> {
  const articles: ArticleListItem[] = [];
  let cursor: string | null = null;
  do {
    const page = await fetchWorkspaceArticlePage(worldId, { ...options, cursor: cursor ?? undefined });
    articles.push(...page);
    cursor = page.length === WORKSPACE_ARTICLE_PAGE_SIZE ? page[page.length - 1].id : null;
  } while (cursor);
  return articles;
}

export interface WorkspaceArticleIdentity {
  worldId: string;
  epoch: number;
  isCurrent: (epoch: number, worldId: string) => boolean;
}

export interface LoadWorkspaceArticleOptions extends WorkspaceArticleIdentity {
  articleId: string;
  setCurrentArticle: (article: ArticleDetail) => void;
  fetcher?: typeof fetch;
  onError?: (error: unknown) => void;
}

/** Fetch detail for a selected article; callers abort the returned request on effect cleanup. */
export function loadWorkspaceArticle(options: LoadWorkspaceArticleOptions): AbortController {
  const controller = new AbortController();
  const fetcher = options.fetcher ?? fetch;
  void (async () => {
    try {
      const response = await fetcher(`/api/articles/${options.articleId}`, { signal: controller.signal });
      const article = await readWorkspaceJson(response, isWorkspaceArticleDetail, "Could not load article details.");
      if (!controller.signal.aborted && options.isCurrent(options.epoch, options.worldId)) options.setCurrentArticle(article);
    } catch (error) {
      if (!controller.signal.aborted) options.onError?.(error);
    }
  })();
  return controller;
}

export interface SaveWorkspaceArticleOptions extends WorkspaceArticleIdentity {
  input: ArticleSaveInput;
  options?: ArticleSaveOptions;
  currentArticle: ArticleDetail | null;
  canStart: () => boolean;
  setSaving: (saving: boolean) => void;
  setArticles: (update: (current: ArticleListItem[]) => ArticleListItem[]) => void;
  setCurrentArticle: (article: ArticleDetail) => void;
  setEditorDirty: (dirty: boolean) => void;
  setSelectedArticleId: (id: string) => void;
  setActiveView: (view: "article") => void;
  fetcher?: typeof fetch;
}

/** Save an article and refresh its list/detail projections without mixing world snapshots. */
export async function saveWorkspaceArticle(deps: SaveWorkspaceArticleOptions): Promise<ArticleSaveResult> {
  if (!deps.canStart()) throw new Error("Paused while switching worlds. Your local draft is safe — try saving again.");
  const fetcher = deps.fetcher ?? fetch;
  const targetId = deps.options?.articleId === null ? undefined : deps.options?.articleId || deps.currentArticle?.id;
  if (targetId && !isArticleVersion(deps.input.expectedVersion)) {
    throw new ArticleSaveError("This draft has no saved article version. Save it as a new article, or copy your changes and reopen the saved article to apply them.", "ARTICLE_VERSION_REQUIRED");
  }

  deps.setSaving(true);
  try {
    const response = await fetcher(targetId ? `/api/articles/${targetId}` : "/api/articles", {
      method: targetId ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(deps.input),
    });

    let saved: SavedArticle;
    try {
      saved = await readWorkspaceJson(response, isSavedArticle, "Unable to save article. Please try again.");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ARTICLE_CONFLICT") {
        throw new ArticleSaveError(error.message, "ARTICLE_CONFLICT");
      }
      throw error;
    }
    const result: ArticleSaveResult = { id: saved.id, version: saved.version };

    // A committed write stays successful when a follow-up projection fails.
    const [listResult, detailResult] = await Promise.allSettled([
      fetchWorkspaceArticleList(deps.worldId, { fetcher }),
      fetcher(`/api/articles/${saved.id}`).then(result =>
        readWorkspaceJson(result, isWorkspaceArticleDetail, "Could not refresh article details.")),
    ]);
    if (!deps.isCurrent(deps.epoch, deps.worldId)) return result;

    deps.setArticles(previous => listResult.status === "fulfilled"
      ? listResult.value
      : sortOrdered([...previous.filter(article => article.id !== saved.id), saved]));

    if (deps.options?.autosave) {
      if (deps.currentArticle?.id === saved.id) {
        deps.setCurrentArticle(detailResult.status === "fulfilled"
          ? detailResult.value
          : { ...deps.currentArticle, ...saved });
      }
      return result;
    }

    deps.setCurrentArticle(detailResult.status === "fulfilled"
      ? detailResult.value
      : { children: [], inboundMentions: [], outboundMentions: [], secrets: [], ...deps.currentArticle, ...saved });
    deps.setEditorDirty(false);
    deps.setSelectedArticleId(saved.id);
    deps.setActiveView("article");
    return result;
  } finally {
    deps.setSaving(false);
  }
}
