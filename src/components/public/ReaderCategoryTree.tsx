"use client";

import { useId, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderTree, House } from "lucide-react";
import { readerArticleHref, readerWorldHref, sortOrdered, type LinkableReaderArticle, type ReaderType } from "@/lib/category-tree";
import { TemplateIcon } from "@/components/TemplateIcon";

interface CategoryMeta {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  icon?: string;
  iconImage?: string | null;
}

/**
 * Category illustration with an accessible folder fallback. Readers without a
 * readable image (private, missing, or failed load) still see a labelled folder
 * rather than a broken-image glyph or a private URL.
 */
function CategoryBranchIcon({ category, collapsed }: { category: CategoryMeta; collapsed: boolean }) {
  const [failed, setFailed] = useState(false);
  const src = category.iconImage;
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        onError={() => setFailed(true)}
        className="h-4 w-4 shrink-0 rounded-sm object-cover"
      />
    );
  }
  return collapsed
    ? <Folder className="h-4 w-4 text-amber-400/80 shrink-0" />
    : <FolderOpen className="h-4 w-4 text-amber-400 shrink-0" />;
}

export function ReaderCategoryTree({
  categories,
  articles,
  worldSlug,
  currentArticleId,
  readerType = "public",
  currentPage = "article",
}: {
  categories: CategoryMeta[];
  articles: LinkableReaderArticle[];
  worldSlug: string;
  currentArticleId?: string;
  readerType?: ReaderType;
  currentPage?: "home" | "article";
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const articlesHeadingId = useId();

  function toggle(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderCategoryBranch(parentId: string | null, depth = 0) {
    const childCats = sortOrdered(categories.filter(cat => (cat.parentId ?? null) === parentId));
    const childArts = [...articles.filter(art => (art.categoryId ?? null) === parentId)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));

    if (!childCats.length && !childArts.length) return null;

    return (
      <ul className={`space-y-1 ${depth > 0 ? "ml-4 border-l border-zinc-800/80 pl-2 mt-1" : ""}`}>
        {childCats.map(category => {
          const isCollapsed = collapsed.has(category.id);
          const hasChildren = categories.some(c => c.parentId === category.id) || articles.some(a => a.categoryId === category.id);

          return (
            <li key={category.id} className="text-sm">
              <div className="flex items-center gap-1.5 py-1 text-zinc-300">
                {hasChildren ? (
                  <button
                    type="button"
                    onClick={() => toggle(category.id)}
                    aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${category.name}`}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="h-9 w-9 shrink-0" aria-hidden="true" />
                )}
                <span className="flex items-center gap-2 font-medium text-zinc-200">
                  <CategoryBranchIcon category={category} collapsed={isCollapsed} />
                  <span>{category.name}</span>
                </span>
              </div>
              {!isCollapsed && renderCategoryBranch(category.id, depth + 1)}
            </li>
          );
        })}

        {childArts.map(article => {
          const isCurrent = article.id === currentArticleId;
          return (
            <li key={article.id} className="text-sm">
              <a
                href={readerArticleHref(worldSlug, article.slug, readerType)}
                className={`flex min-h-10 items-center gap-2 rounded-lg px-2 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  isCurrent
                    ? "bg-violet-500/15 font-medium text-violet-100 ring-1 ring-inset ring-violet-300/40"
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

  const hasAnyContent = categories.length > 0 || articles.length > 0;
  const worldHref = readerWorldHref(worldSlug, readerType);
  return (
    <nav aria-label="World contents" className="reader-category-navigation space-y-3">
      <a
        href={worldHref}
        aria-current={currentPage === "home" ? "page" : undefined}
        className={`flex min-h-11 items-center gap-3 rounded-xl border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
          currentPage === "home"
            ? "border-violet-300/40 bg-violet-500/15 text-violet-100 shadow-sm shadow-violet-950/40"
            : "border-transparent text-zinc-300 hover:border-zinc-700 hover:bg-zinc-900/80 hover:text-zinc-100"
        }`}
      >
        <House className="h-4 w-4 shrink-0 text-violet-300" aria-hidden="true" />
        <span className="truncate">World home</span>
      </a>
      <section aria-labelledby={articlesHeadingId} className="overflow-hidden rounded-xl border border-zinc-800/80 bg-zinc-950/30">
        <h2 id={articlesHeadingId} className="flex items-center gap-2 border-b border-zinc-800/80 px-3 py-2.5 text-xs font-bold uppercase tracking-wider text-amber-300">
          <FolderTree className="h-4 w-4 text-amber-400" aria-hidden="true" />
          <span>Articles</span>
        </h2>
        <div className="p-2">
          {hasAnyContent ? renderCategoryBranch(null, 0) : <p className="px-2 py-3 text-sm text-zinc-500">No articles or categories yet.</p>}
        </div>
      </section>
    </nav>
  );
}
