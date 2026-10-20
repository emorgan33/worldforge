"use client";

import { useState } from "react";
import { Search, X, ChevronRight, Folder, FolderOpen, BookOpen } from "lucide-react";
import { ReaderBreadcrumbs, type BreadcrumbItem } from "@/components/public/ReaderBreadcrumbs";
import { TemplateIcon } from "@/components/TemplateIcon";
import type { LinkableReaderArticle } from "@/lib/category-tree";

interface CategoryMeta {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  icon?: string;
}

interface PlayerSidebarProps {
  worldSlug: string;
  worldTitle: string;
  categories: CategoryMeta[];
  articles: LinkableReaderArticle[];
  currentArticleId?: string;
  breadcrumbs?: BreadcrumbItem[];
  isPreview?: boolean;
  actorName?: string | null;
}

export function PlayerSidebar({
  worldSlug,
  worldTitle,
  categories,
  articles,
  currentArticleId,
  breadcrumbs,
  isPreview,
  actorName,
}: PlayerSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const trimmed = searchQuery.trim();
  const searchResults = trimmed
    ? articles.filter((a: LinkableReaderArticle) => {
        const haystack = `${a.title} ${a.excerpt ?? ""}`.toLocaleLowerCase();
        return trimmed.toLocaleLowerCase().split(/\s+/).every(t => haystack.includes(t));
      }).sort((a: LinkableReaderArticle, b: LinkableReaderArticle) => {
        const aStarts = a.title.toLocaleLowerCase().startsWith(trimmed.toLocaleLowerCase());
        const bStarts = b.title.toLocaleLowerCase().startsWith(trimmed.toLocaleLowerCase());
        return Number(bStarts) - Number(aStarts) || a.title.localeCompare(b.title);
      })
    : [];

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderCategoryBranch(parentId: string | null, depth = 0) {
    const childCats = [...categories.filter((cat: CategoryMeta) => (cat.parentId ?? null) === parentId)]
      .sort((a: CategoryMeta, b: CategoryMeta) => a.order - b.order || a.id.localeCompare(b.id));
    const childArts = [...articles.filter((art: LinkableReaderArticle) => (art.categoryId ?? null) === parentId)]
      .sort((a: LinkableReaderArticle, b: LinkableReaderArticle) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

    if (!childCats.length && !childArts.length) return null;

    return (
      <ul className={`space-y-1 ${depth > 0 ? "ml-4 border-l border-zinc-800/80 pl-2 mt-1" : ""}`}>
        {childCats.map((category: CategoryMeta) => {
          const isCollapsed = collapsed.has(category.id);
          const hasChildren = categories.some((c: CategoryMeta) => c.parentId === category.id) || articles.some((a: LinkableReaderArticle) => a.categoryId === category.id);
          return (
            <li key={category.id} className="text-sm">
              <div className="flex items-center gap-1.5 py-1 text-zinc-300">
                {hasChildren ? (
                  <button type="button" onClick={() => toggle(category.id)}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${category.name}`}
                    className="p-1 text-zinc-400 hover:text-zinc-100 rounded"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="w-5" aria-hidden="true" />
                )}
                <span className="flex items-center gap-2 font-medium text-zinc-200">
                  {isCollapsed ? <Folder className="h-4 w-4 text-amber-400/80 shrink-0" /> : <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" />}
                  <span>{category.name}</span>
                </span>
              </div>
              {!isCollapsed && renderCategoryBranch(category.id, depth + 1)}
            </li>
          );
        })}
        {childArts.map((article: LinkableReaderArticle) => {
          const isCurrent = article.id === currentArticleId;
          return (
            <li key={article.id} className="text-sm">
              <a href={`/c/${worldSlug}/a/${article.slug}`}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${
                  isCurrent
                    ? "bg-indigo-600/25 font-medium text-indigo-200"
                    : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                }`}
                aria-current={isCurrent ? "page" : undefined}
              >
                <TemplateIcon template={article.template} className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
                <span className="truncate">{article.title}</span>
              </a>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
<aside className="w-64 shrink-0 space-y-4">
      {/* Preview banner */}
      {isPreview && (
        <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200 flex items-center gap-2">
          <BookOpen className="h-3.5 w-3.5 shrink-0" />
          <span>Preview: <strong>{actorName || "Player"}</strong></span>
        </div>
      )}

      {/* Breadcrumbs */}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <ReaderBreadcrumbs items={breadcrumbs} />
      )}

      {/* Search */}
      <div className="relative">
        <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-2.5 py-1.5 text-sm text-zinc-200 focus-within:border-indigo-500">
          <Search className="h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden="true" />
          <input type="search" aria-label="Search articles" value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search…"
            className="w-full bg-transparent text-sm placeholder:text-zinc-500 focus:outline-none"
          />
          {trimmed && (
            <button type="button" onClick={() => setSearchQuery("")}
              aria-label="Clear search" className="rounded p-0.5 text-zinc-400 hover:text-zinc-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {trimmed && (
          <div role="region" aria-label="Search results"
            className="mt-2 space-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2 shadow-xl max-h-64 overflow-y-auto"
          >
            {searchResults.length > 0 ? searchResults.map((article: LinkableReaderArticle) => (
              <a key={article.id} href={`/c/${worldSlug}/a/${article.slug}`}
                className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-indigo-300 hover:bg-zinc-900"
              >
                <TemplateIcon template={article.template} className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span className="font-medium text-zinc-100 truncate">{article.title}</span>
                {article.excerpt && <span className="text-xs text-zinc-400 truncate ml-auto max-w-[40%]">{article.excerpt}</span>}
              </a>
            )) : (
              <p className="p-2 text-center text-xs text-zinc-500">No articles match &ldquo;{trimmed}&rdquo;.</p>
            )}
          </div>
        )}
      </div>

      {/* Category tree */}
      <nav aria-label="World contents" className="rounded-lg border border-zinc-800/80 bg-zinc-950/40 p-3">
        <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400/90">{worldTitle}</h2>
        {categories.length > 0 || articles.length > 0 ? (
          renderCategoryBranch(null, 0)
        ) : (
          <p className="text-xs text-zinc-500">No articles available.</p>
        )}
      </nav>
    </aside>
  );
}

function ChevronDown({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}