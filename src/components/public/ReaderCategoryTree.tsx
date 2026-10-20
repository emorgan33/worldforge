"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen } from "lucide-react";
import { sortOrdered, type LinkableReaderArticle } from "@/lib/category-tree";
import { TemplateIcon } from "@/components/TemplateIcon";

interface CategoryMeta {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  icon?: string;
}

export function ReaderCategoryTree({
  categories,
  articles,
  worldSlug,
  currentArticleId,
}: {
  categories: CategoryMeta[];
  articles: LinkableReaderArticle[];
  worldSlug: string;
  currentArticleId?: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

        {childArts.map(article => {
          const isCurrent = article.id === currentArticleId;
          return (
            <li key={article.id} className="text-sm">
              <a
                href={`/w/${worldSlug}/a/${article.slug}`}
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

  const hasAnyContent = categories.length > 0 || articles.length > 0;
  if (!hasAnyContent) {
    return <p className="text-sm text-zinc-500">No public articles or categories yet.</p>;
  }

  return (
    <nav aria-label="World contents" className="reader-category-navigation">
      {renderCategoryBranch(null, 0)}
    </nav>
  );
}
