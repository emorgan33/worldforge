"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";
import { readerArticleHref, searchReaderArticles, type LinkableReaderArticle, type ReaderType } from "@/lib/category-tree";
import { TemplateIcon } from "@/components/TemplateIcon";

export function ReaderSearch({ worldSlug, articles, readerType = "public" }: { worldSlug: string; articles: LinkableReaderArticle[]; readerType?: ReaderType }) {
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const results = trimmed ? searchReaderArticles(trimmed, articles) : [];
  const searchLabel = readerType === "campaign" ? "Search articles" : "Search public articles";

  return (
    <div className="relative my-4">
      <div className="flex items-center gap-2 reader-search-field rounded-xl border px-3 py-2 text-sm text-app-text focus-within:border-highlight-400 focus-within:ring-2 focus-within:ring-highlight-400/30">
        <Search className="h-4 w-4 shrink-0 text-app-muted" aria-hidden="true" />
        <input
          type="search"
          aria-label={searchLabel}
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={`${searchLabel}…`}
          className="w-full bg-transparent text-sm placeholder:text-app-subtle focus:outline-none"
        />
        {trimmed && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear search"
            className="rounded p-1 text-app-muted hover:text-app-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      {trimmed && (
        <div
          role="region"
          aria-label={readerType === "campaign" ? "Article search results" : "Public search results"}
          className="mt-2 space-y-1.5 rounded-xl border border-app-border bg-app-canvas p-2 shadow-xl"
        >
          {results.length > 0 ? (
            results.map(article => (
              <a
                key={article.id}
                href={readerArticleHref(worldSlug, article.slug, readerType)}
                className="flex min-h-10 items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-highlight-300 hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"
              >
                <TemplateIcon template={article.template} className="h-4 w-4 shrink-0 text-primary-400" />
                <span className="font-medium text-app-text-strong truncate">{article.title}</span>
                {article.excerpt && <span className="text-xs text-app-muted truncate ml-auto max-w-[50%]">{article.excerpt}</span>}
              </a>
            ))
          ) : (
            <p className="p-3 text-center text-xs text-app-subtle">No articles match &ldquo;{trimmed}&rdquo;.</p>
          )}
        </div>
      )}
    </div>
  );
}
