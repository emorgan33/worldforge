import type { Prisma } from "@prisma/client";
import type { ArticleTemplateType, CategoryItem } from "@/types";
import { categoryPathLabel } from "./category-tree";
import { ARTICLE_TEMPLATES } from "./templates";

export const SEARCH_PAGE_SIZE = 40;
export const SEARCH_QUERY_MAX = 200;
export type PublicationStatusFilter = "DRAFT" | "WIP" | "PUBLISHED";
export type SearchKind = "all" | "articles" | "categories" | "tools";
export class SearchInputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface CampaignSearchFilters {
  q: string;
  template?: ArticleTemplateType;
  status?: PublicationStatusFilter;
  categoryId?: string;
  cursor?: string;
}

export interface SearchableArticle {
  id: string;
  title: string;
  excerpt?: string | null;
  tags?: string | null;
  template: string;
  publicationStatus: string;
  categoryId?: string | null;
}

export interface CampaignSearchHit {
  id: string;
  title: string;
  template: string;
  publicationStatus: string;
  categoryId: string | null;
  categoryPath: string;
}

export interface LocalSearchCommand {
  id: string;
  title: string;
  description: string;
  keywords?: string;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set<PublicationStatusFilter>(["DRAFT", "WIP", "PUBLISHED"]);

export function searchTerms(query: string): string[] {
  return query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
}

export function parseCampaignSearchParams(params: URLSearchParams): CampaignSearchFilters {
  const q = (params.get("q") || "").slice(0, SEARCH_QUERY_MAX);
  const template = params.get("template") || "";
  const status = params.get("status") || "";
  const categoryId = params.get("categoryId") || "";
  const cursor = params.get("cursor") || "";
  if (template && !(template in ARTICLE_TEMPLATES)) throw new SearchInputError("Invalid template filter.");
  if (status && !STATUSES.has(status as PublicationStatusFilter)) throw new SearchInputError("Invalid publication status filter.");
  if (categoryId && !ID.test(categoryId)) throw new SearchInputError("Invalid category filter.");
  if (cursor && !ID.test(cursor)) throw new SearchInputError("Invalid search cursor.");
  return {
    q,
    ...(template ? { template: template as ArticleTemplateType } : {}),
    ...(status ? { status: status as PublicationStatusFilter } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(cursor ? { cursor } : {}),
  };
}

export function campaignSearchUrl(worldId: string, filters: CampaignSearchFilters): string {
  const params = new URLSearchParams({ worldId });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.template) params.set("template", filters.template);
  if (filters.status) params.set("status", filters.status);
  if (filters.categoryId) params.set("categoryId", filters.categoryId);
  if (filters.cursor) params.set("cursor", filters.cursor);
  return `/api/search?${params}`;
}

export function articleSearchWhere(worldId: string, filters: CampaignSearchFilters): Prisma.ArticleWhereInput {
  const terms = searchTerms(filters.q);
  return {
    worldId,
    ...(filters.template ? { template: filters.template } : {}),
    ...(filters.status ? { publicationStatus: filters.status } : {}),
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    // Note: We search title, excerpt, and tags only — contentHtml/contentJson
    // are very large columns and searching them with LIKE always scans the full table.
    // For content search, the client-side filter or a dedicated FTS index would be needed.
    ...(terms.length ? {
      AND: terms.map(term => ({
        OR: [
          { title: { contains: term } },
          { excerpt: { contains: term } },
          { tags: { contains: term } },
        ],
      })),
    } : {}),
  };
}

export function rankSearchArticles(articles: SearchableArticle[], query: string): SearchableArticle[] {
  const terms = searchTerms(query);
  const needle = query.trim().toLocaleLowerCase();
  return [...articles].sort((a, b) => searchRank(a, terms, needle) - searchRank(b, terms, needle) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

function searchRank(article: SearchableArticle, terms: string[], needle: string) {
  if (!terms.length) return 1;
  const title = article.title.toLocaleLowerCase();
  const excerpt = `${article.excerpt ?? ""} ${article.tags ?? ""}`.toLocaleLowerCase();
  if (title.startsWith(needle)) return 0;
  if (terms.every(term => title.includes(term))) return 1;
  if (terms.every(term => `${title} ${excerpt}`.includes(term))) return 2;
  return 3;
}

export function paginateSearch<T extends { id: string }>(items: T[], cursor?: string, pageSize = SEARCH_PAGE_SIZE) {
  if (cursor && !items.some(item => item.id === cursor)) return { items: [] as T[], nextCursor: null as string | null };
  const start = cursor ? items.findIndex(item => item.id === cursor) + 1 : 0;
  const page = items.slice(start, start + pageSize);
  return { items: page, nextCursor: start + pageSize < items.length ? page[page.length - 1]?.id ?? null : null };
}

export function presentSearchArticle(article: SearchableArticle, categories: Pick<CategoryItem, "id" | "name" | "parentId" | "order">[]): CampaignSearchHit {
  return {
    id: article.id,
    title: article.title,
    template: article.template,
    publicationStatus: article.publicationStatus,
    categoryId: article.categoryId ?? null,
    categoryPath: categoryPathLabel(categories, article.categoryId ?? null),
  };
}

export function filterLocalCommands<T extends LocalSearchCommand>(commands: T[], query: string, kind: SearchKind): T[] {
  const scoped = commands.filter(command => {
    if (kind === "articles") return false;
    if (kind === "categories") return command.id.startsWith("category-");
    if (kind === "tools") return !command.id.startsWith("category-") && !command.id.startsWith("article-");
    return !command.id.startsWith("article-");
  });
  const terms = searchTerms(query);
  const needle = query.trim().toLocaleLowerCase();
  return scoped
    .filter(command => terms.every(term => `${command.title} ${command.description} ${command.keywords ?? ""}`.toLocaleLowerCase().includes(term)))
    .sort((a, b) => Number(b.title.toLocaleLowerCase().startsWith(needle)) - Number(a.title.toLocaleLowerCase().startsWith(needle)));
}
