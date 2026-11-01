import type { JSONContent } from "@tiptap/core";
import type { ArticleDetail, ArticleTemplateType } from "@/types";
import type { PublicationStatus, ArticleVisibility } from "./publication";

export interface ArticleSaveInput {
  worldId: string; template: ArticleTemplateType; title: string; categoryId: string | null;
  excerpt: string; tags: string; state: NonNullable<ArticleDetail["state"]>; contentHtml: string;
  contentJson?: JSONContent; coverImage?: string; coverImageAlt?: string | null;
  publicationStatus?: PublicationStatus; visibility?: ArticleVisibility; metadata: Record<string, string>;
  portraitImage?: string; portraitImageAlt?: string | null;
  canonState?: string;
  expectedVersion?: number;
}

export interface ArticleSaveResult { id: string; version: number }
export interface ArticleSaveOptions { autosave?: boolean; articleId?: string | null }
export interface ArticleConflictResponse {
  code: "ARTICLE_CONFLICT";
  error: string;
  currentVersion: number | null;
}

export function isArticleVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

export class ArticleSaveError extends Error {
  constructor(message: string, public code: "ARTICLE_CONFLICT" | "ARTICLE_VERSION_REQUIRED") {
    super(message);
    this.name = "ArticleSaveError";
  }
}
