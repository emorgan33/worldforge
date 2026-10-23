"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, GripVertical, Inbox } from "lucide-react";
import { ArticleListItem, CategoryItem } from "@/types";
import { sortOrdered } from "@/lib/category-tree";
import { TemplateIcon } from "./TemplateIcon";

export interface TreeMove { kind: "category" | "article"; id: string; parentId: string | null; beforeId?: string | null }
const MIME = "application/x-worldforge-tree";

export function ArticleTree({ categories, articles, selectedArticleId, selectedCategoryId, onSelectArticle, onSelectCategory, onMove, query = "", disabled = false, mobile = false }: {
  categories: CategoryItem[];
  articles: ArticleListItem[];
  selectedArticleId?: string | null;
  selectedCategoryId?: string | null;
  onSelectArticle: (id: string) => void;
  onSelectCategory: (id: string | null) => void;
  onMove: (move: TreeMove) => Promise<void>;
  query?: string;
  disabled?: boolean;
  mobile?: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const search = query.trim().toLowerCase();
  function start(event: React.DragEvent, kind: TreeMove["kind"], id: string) {
    if (disabled) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(MIME, JSON.stringify({ kind, id }));
  }
  function dropProps(key: string, parentId: string | null, beforeId?: string, requiredKind?: TreeMove["kind"]) {
    return {
      onDragOver: (event: React.DragEvent) => { if (!disabled && event.dataTransfer.types.includes(MIME)) { event.preventDefault(); event.stopPropagation(); setDropTarget(key); event.dataTransfer.dropEffect = "move"; } },
      onDragLeave: () => setDropTarget(previous => previous === key ? null : previous),
      onDrop: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(MIME) || disabled) return;
        event.preventDefault(); event.stopPropagation(); setDropTarget(null);
        try {
          const item = JSON.parse(event.dataTransfer.getData(MIME));
          if (!["category", "article"].includes(item.kind) || typeof item.id !== "string" || (requiredKind && item.kind !== requiredKind)) return;
          void onMove({ ...item, parentId, beforeId }).catch(() => {});
        } catch { /* Foreign or stale drag payload. */ }
      },
    };
  }
  function hasMatch(id: string, visited = new Set<string>()): boolean {
    if (visited.has(id)) return false;
    visited.add(id);
    const category = categories.find(item => item.id === id);
    return !!category && (category.name.toLowerCase().includes(search) || articles.some(article => article.categoryId === id && `${article.title} ${article.excerpt ?? ""}`.toLowerCase().includes(search)) || categories.some(child => child.parentId === id && hasMatch(child.id, visited)));
  }
  function articleRows(parentId: string | null, showAll: boolean) {
    return sortOrdered(articles.filter(article => (article.categoryId ?? null) === parentId && (!search || showAll || `${article.title} ${article.excerpt ?? ""}`.toLowerCase().includes(search)))).map(article => <li key={article.id} className="relative">
      <div {...dropProps(`before-article-${article.id}`, parentId, article.id, "article")} className={`h-1.5 rounded ${dropTarget === `before-article-${article.id}` ? "bg-amber-500" : ""}`} aria-hidden="true" />
      <div className={`flex items-center gap-1 rounded-lg ${selectedArticleId === article.id ? "bg-indigo-600/30 text-indigo-200" : "text-zinc-300 hover:bg-zinc-900"}`}>
        <button type="button" draggable={!disabled} onDragStart={event => start(event, "article", article.id)} onDragEnd={() => setDropTarget(null)} aria-label={`Drag article ${article.title}`} className="cursor-grab p-1 opacity-50 hover:opacity-100"><GripVertical size={12} /></button>
        <button type="button" onClick={() => onSelectArticle(article.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left text-sm"><TemplateIcon template={article.template} className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{article.title}</span>{((article.publicationStatus || article.state) !== "PUBLISHED" || article.visibility === "PRIVATE") && <span className="ml-auto text-[11px] uppercase text-zinc-400">{article.state === "DRAFT" ? "Draft" : article.state === "PRIVATE" ? "Private" : "WIP"}</span>}</button>
      </div>
    </li>);
  }
  function branch(parentId: string | null, ancestors = new Set<string>(), showAll = false): React.ReactNode {
    return sortOrdered(categories.filter(category => category.parentId === parentId && !ancestors.has(category.id) && (!search || showAll || hasMatch(category.id)))).map(category => {
      const open = !!search || !collapsed.has(category.id);
      const showChildren = showAll || (!!search && category.name.toLowerCase().includes(search));
      const childAncestors = new Set([...ancestors, category.id]);
      const count = articles.filter(article => article.categoryId === category.id).length;
      return <li key={category.id}>
        <div {...dropProps(`before-category-${category.id}`, parentId, category.id, "category")} className={`h-1.5 rounded ${dropTarget === `before-category-${category.id}` ? "bg-amber-500" : ""}`} aria-hidden="true" />
        <div {...dropProps(`category-${category.id}`, category.id)} className={`flex items-center gap-0.5 rounded-lg border ${dropTarget === `category-${category.id}` ? "border-amber-500 bg-amber-950/30" : selectedCategoryId === category.id ? "border-zinc-700 bg-zinc-900" : "border-transparent hover:bg-zinc-900"}`}>
          <button type="button" draggable={!disabled} onDragStart={event => start(event, "category", category.id)} onDragEnd={() => setDropTarget(null)} aria-label={`Drag category ${category.name}`} className="cursor-grab p-1 text-zinc-600 hover:text-zinc-300"><GripVertical size={12} /></button>
          <button type="button" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${category.name}`} onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(category.id)) next.delete(category.id); else next.add(category.id); return next; })} className={mobile ? "flex h-11 w-11 shrink-0 items-center justify-center text-zinc-400" : "p-1 text-zinc-500"}>{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
          <button type="button" onClick={() => onSelectCategory(category.id)} className="flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 text-left text-sm font-semibold text-zinc-200">{open ? <FolderOpen size={14} className="shrink-0 text-amber-500" /> : <Folder size={14} className="shrink-0 text-amber-500" />}<span className="truncate">{category.name}</span><span className="ml-auto text-xs text-zinc-400">{count}</span></button>
        </div>
        {open && <ul className="ml-5 border-l border-zinc-800 pl-1.5">{branch(category.id, childAncestors, showChildren)}{articleRows(category.id, showChildren)}</ul>}
      </li>;
    });
  }
  return <div aria-label="Article tree" className={disabled ? "opacity-60" : ""}>
    <ul>{branch(null)}</ul>
    <div {...dropProps("root", null)} className={`mt-2 rounded-lg border ${dropTarget === "root" ? "border-amber-500 bg-amber-950/30" : "border-transparent"}`}>
      <button type="button" onClick={() => onSelectCategory(null)} className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-semibold ${selectedCategoryId === null ? "bg-zinc-900 text-zinc-200" : "text-zinc-500"}`}><Inbox size={14} />Uncategorized</button>
      <ul>{articleRows(null, false)}</ul>
    </div>
    <div {...dropProps("world-root", null, undefined, "category")} className={`mt-3 rounded-lg border border-dashed p-2 text-center text-[10px] ${dropTarget === "world-root" ? "border-amber-500 text-amber-300" : "border-zinc-800 text-zinc-600"}`}>Drop a category here to move it to the top level</div>
    {!categories.length && !articles.length && <p className="p-4 text-xs text-zinc-500">Create a category or article to organize your lore.</p>}
  </div>;
}
