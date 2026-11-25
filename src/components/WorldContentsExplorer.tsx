"use client";

import { useEffect, useRef } from "react";
import { PanelLeftClose, Pin, PinOff, Search, X } from "lucide-react";
import { ArticleTree, TreeMove } from "@/components/ArticleTree";
import type { ArticleListItem, CategoryItem } from "@/types";

export function WorldContentsExplorer({ articles, categories, selectedArticleId, selectedCategoryId, onSelectArticle, onSelectCategory, onMove, organizationBusy, organizationError, pinned, onTogglePin, onClose, onOpenSearch, drawer = false, visible = true }: {
  articles: ArticleListItem[];
  categories: CategoryItem[];
  selectedArticleId?: string | null;
  selectedCategoryId?: string | null;
  onSelectArticle: (id: string) => void;
  onSelectCategory: (id: string | null) => void;
  onMove: (move: TreeMove) => Promise<void>;
  organizationBusy: boolean;
  organizationError: string;
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  onOpenSearch?: () => void;
  drawer?: boolean;
  visible?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useEffect(() => {
    if (visible && scrollRef.current) scrollRef.current.scrollTop = scrollTop.current;
  }, [visible]);

  return (
    <section aria-label="World contents" role={drawer ? "dialog" : undefined} aria-modal={drawer || undefined} className="flex h-full min-w-0 flex-col overflow-hidden border-r border-[var(--aw-sidebar-border)] bg-[var(--aw-sidebar)] text-[var(--aw-text)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--aw-sidebar-border)] px-2 py-3">
        <h2 className="min-w-0 flex-1 truncate text-[10px] font-bold uppercase tracking-wider text-[var(--aw-sidebar-muted)]">World contents <span className="font-semibold tracking-normal">· {articles.length} {articles.length === 1 ? "article" : "articles"}</span></h2>
        <button type="button" onClick={onTogglePin} aria-label={pinned ? "Unpin world contents" : "Pin world contents"} aria-pressed={pinned} title={pinned ? "Unpin world contents" : "Pin world contents"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-app-text-dim hover:bg-app-raised hover:text-app-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">{pinned ? <PinOff aria-hidden="true" className="h-4 w-4" /> : <Pin aria-hidden="true" className="h-4 w-4" />}</button>
        <button id="world-contents-close" type="button" onClick={onClose} aria-label={drawer ? "Close world contents" : "Collapse world contents"} title={drawer ? "Close world contents" : "Collapse world contents"} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-app-text-dim hover:bg-app-raised hover:text-app-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">{drawer ? <X aria-hidden="true" className="h-5 w-5" /> : <PanelLeftClose aria-hidden="true" className="h-4 w-4" />}</button>
      </div>
      {organizationError && <p role="alert" className="mx-3 mt-2 shrink-0 rounded border border-danger-900/40 p-2 text-xs text-danger-300">{organizationError}</p>}
      <div ref={scrollRef} onScroll={event => { if (visible) scrollTop.current = event.currentTarget.scrollTop; }} className="sidebar-lore-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        <ArticleTree categories={categories} articles={articles} selectedArticleId={selectedArticleId} selectedCategoryId={selectedCategoryId} onSelectArticle={onSelectArticle} onSelectCategory={onSelectCategory} onMove={onMove} disabled={organizationBusy} mobile={drawer} />
      </div>
      {drawer && onOpenSearch && <div className="shrink-0 border-t border-[var(--aw-sidebar-border)] p-3"><button type="button" onClick={onOpenSearch} aria-label="Search this world" className="flex h-11 w-full items-center gap-3 rounded-lg border border-[var(--aw-sidebar-control-border)] bg-app-surface px-3 text-left text-sm text-[var(--aw-sidebar-muted)] hover:border-highlight-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><Search aria-hidden="true" className="h-4 w-4" /><span>Search this world</span></button></div>}
    </section>
  );
}
