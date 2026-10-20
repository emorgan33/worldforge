"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import { useState } from "react";
import { ArrowDown, ArrowUp, FolderPlus, FolderTree, Plus, Search } from "lucide-react";
import { ArticleTree, TreeMove } from "@/components/ArticleTree";
import { ArticleListItem, ArticleTemplateType, CategoryItem } from "@/types";
import { categoryOptions, descendantIds, sortOrdered } from "@/lib/category-tree";

export type CategoryAction = { action: "create"; name: string; parentId: string | null } | { action: "rename"; id: string; name: string } | { action: "delete"; id: string };
const inputClass = "rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none";

export function CategoryManager({ categories, articles, selectedId, onSelectCategory, onSelectArticle, onMove, onAction, onNewArticle, busy, error }: {
  categories: CategoryItem[]; articles: ArticleListItem[]; selectedId: string | null;
  onSelectCategory: (id: string | null) => void; onSelectArticle: (id: string) => void;
  onMove: (move: TreeMove) => Promise<void>; onAction: (action: CategoryAction) => Promise<void>;
  onNewArticle: (template?: ArticleTemplateType, categoryId?: string | null) => void;
  busy: boolean; error: string;
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState<string | null>(selectedId);
  const [rename, setRename] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [allArticles, setAllArticles] = useState(false);
  useWorldGuard({ dirty: (creating && !!newName) || rename !== null, busy }, "category");
  const selected = categories.find(category => category.id === selectedId);
  const options = categoryOptions(categories);
  const descendants = selected ? descendantIds(categories, selected.id) : new Set();
  const siblings = sortOrdered(categories.filter(category => category.parentId === selected?.parentId));
  const siblingIndex = siblings.findIndex(category => category.id === selectedId);
  const entries = sortOrdered(articles.filter(article => (allArticles || (article.categoryId ?? null) === selectedId) && `${article.title} ${article.excerpt ?? ""}`.toLowerCase().includes(query.toLowerCase())));
  const childCategories = sortOrdered(categories.filter(category => category.parentId === selectedId));
  function select(id: string | null) { setRename(null); setDeleting(false); setAllArticles(false); onSelectCategory(id); }
  async function create(event: React.FormEvent) {
    event.preventDefault();
    try { await onAction({ action: "create", name: newName, parentId: newParent }); setNewName(""); setCreating(false); }
    catch { /* Parent retains the error and this draft. */ }
  }
  async function renameCategory(event: React.FormEvent) {
    event.preventDefault(); if (!selected || rename === null) return;
    try { await onAction({ action: "rename", id: selected.id, name: rename }); setRename(null); }
    catch { /* Keep the proposed name available for retry. */ }
  }
  return <section className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><p className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-amber-500"><FolderTree size={15} /> World manager</p><h1 className="font-serif text-3xl text-amber-50">Articles & Categories</h1><p className="mt-2 text-sm text-zinc-400">Organize your lore. Drag entries into folders, or use the move controls.</p></div><div className="flex gap-2"><button disabled={busy} onClick={() => { setNewParent(selectedId); setCreating(!creating); }} className="flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm"><FolderPlus size={15} />New category</button><button onClick={() => onNewArticle("GENERIC", selectedId)} className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-zinc-950"><Plus size={15} />New article</button></div></header>
    {error && <p role="alert" className="rounded-lg border border-red-800/40 bg-red-950/20 p-3 text-sm text-red-300">{error}</p>}
    <p role="status" className="text-xs text-zinc-500">{busy ? "Saving organization…" : `${categories.length} categories · ${articles.length} articles`}</p>
    {creating && <form onSubmit={create} className="flex flex-wrap items-end gap-3 rounded-xl border border-amber-800/50 bg-zinc-900 p-4"><label className="grid flex-1 gap-1 text-xs text-zinc-400">Category name<input autoFocus required maxLength={200} value={newName} onChange={event => setNewName(event.target.value)} className={inputClass} placeholder="People, Atlas, Adventure arcs…" /></label><label className="grid flex-1 gap-1 text-xs text-zinc-400">Parent category<select aria-label="New category parent" value={newParent ?? ""} onChange={event => setNewParent(event.target.value || null)} className={inputClass}><option value="">Top level</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><button disabled={busy || !newName.trim()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-40">Create category</button><button type="button" disabled={busy} onClick={() => setCreating(false)} className="px-2 py-2 text-sm text-zinc-400">Cancel</button></form>}
    <div className="grid items-start gap-5 xl:grid-cols-[minmax(240px,1fr)_2fr]">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/30 p-3"><div className="mb-3 flex items-center gap-2"><Search size={14} className="text-zinc-500" /><input aria-label="Search article tree" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find categories or articles…" className={`${inputClass} min-w-0 flex-1 text-xs`} /></div><button onClick={() => setAllArticles(true)} className={`mb-3 w-full rounded-lg border px-3 py-2 text-left text-xs ${allArticles ? "border-amber-700 text-amber-200" : "border-zinc-800 text-zinc-400"}`}>All articles ({articles.length})</button><ArticleTree categories={categories} articles={articles} selectedCategoryId={allArticles ? undefined : selectedId} onSelectCategory={select} onSelectArticle={onSelectArticle} onMove={onMove} query={query} disabled={busy} /></div>
      <div className="space-y-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">{allArticles ? "Across your world" : selected ? options.find(option => option.id === selected.id)?.label : "World root"}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3"><h2 className="font-serif text-2xl text-amber-100">{allArticles ? "All articles" : selected?.name ?? "Uncategorized"}</h2>{selected && !allArticles && <div className="flex gap-2 text-xs"><button disabled={busy} onClick={() => { setRename(selected.name); setDeleting(false); }} className="rounded border border-zinc-700 px-3 py-1.5">Rename</button><button disabled={busy} onClick={() => { setDeleting(!deleting); setRename(null); }} className="px-2 py-1.5 text-red-400">Delete category</button></div>}</div>
          {selected && !allArticles && <div className="mt-4 flex flex-wrap items-end gap-3"><label className="grid min-w-0 flex-1 gap-1 text-xs text-zinc-400">Parent category<select aria-label="Move category to" disabled={busy} value={selected.parentId ?? ""} onChange={event => { void onMove({ kind: "category", id: selected.id, parentId: event.target.value || null }).catch(() => {}); }} className={inputClass}><option value="">Top level</option>{options.filter(option => !descendants.has(option.id)).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label><button aria-label="Move category up" disabled={busy || siblingIndex <= 0} onClick={() => { void onMove({ kind: "category", id: selected.id, parentId: selected.parentId, beforeId: siblings[siblingIndex - 1].id }).catch(() => {}); }} className="rounded border border-zinc-700 p-2 disabled:opacity-25"><ArrowUp size={16} /></button><button aria-label="Move category down" disabled={busy || siblingIndex < 0 || siblingIndex === siblings.length - 1} onClick={() => { void onMove({ kind: "category", id: selected.id, parentId: selected.parentId, beforeId: siblings[siblingIndex + 2]?.id ?? null }).catch(() => {}); }} className="rounded border border-zinc-700 p-2 disabled:opacity-25"><ArrowDown size={16} /></button></div>}
          {rename !== null && <form onSubmit={renameCategory} className="mt-4 flex gap-2"><input aria-label="Category name to save" required maxLength={200} value={rename} onChange={event => setRename(event.target.value)} className={`${inputClass} min-w-0 flex-1`} /><button disabled={busy || !rename.trim()} className="rounded-lg bg-amber-500 px-3 text-sm font-semibold text-zinc-950">Save name</button><button type="button" onClick={() => setRename(null)} className="text-xs text-zinc-500">Cancel</button></form>}
          {deleting && selected && <div className="mt-4 rounded-lg border border-red-900/50 p-3 text-sm text-zinc-400"><p>Delete “{selected.name}”? Its articles and subcategories will move to {selected.parentId ? "its parent category" : "the world root"}.</p><div className="mt-3 flex gap-3"><button disabled={busy} onClick={() => { void onAction({ action: "delete", id: selected.id }).then(() => { select(selected.parentId); setDeleting(false); }).catch(() => {}); }} className="rounded border border-red-800 px-3 py-1.5 text-xs text-red-300">Confirm delete category</button><button disabled={busy} onClick={() => setDeleting(false)} className="text-xs">Cancel</button></div></div>}
        </div>
        {!allArticles && childCategories.length > 0 && <div className="flex flex-wrap gap-2">{childCategories.map(category => <button key={category.id} onClick={() => select(category.id)} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs text-amber-300"><FolderTree size={13} />{category.name}</button>)}</div>}
        <div className="space-y-2">{entries.map((article, index) => <div key={article.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"><button onClick={() => onSelectArticle(article.id)} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold text-zinc-200">{article.title}</span><span className="mt-1 block text-[10px] uppercase tracking-wider text-zinc-500">{article.template} · {article.state}</span></button><select aria-label={`Move ${article.title} to category`} disabled={busy} value={article.categoryId ?? ""} onChange={event => { void onMove({ kind: "article", id: article.id, parentId: event.target.value || null }).catch(() => {}); }} className={`${inputClass} max-w-48 text-xs`}><option value="">Uncategorized</option>{options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select>{!allArticles && !query && <div className="flex"><button aria-label={`Move ${article.title} up`} disabled={busy || index === 0} onClick={() => { void onMove({ kind: "article", id: article.id, parentId: selectedId, beforeId: entries[index - 1].id }).catch(() => {}); }} className="p-1.5 text-zinc-400 disabled:opacity-20"><ArrowUp size={14} /></button><button aria-label={`Move ${article.title} down`} disabled={busy || index === entries.length - 1} onClick={() => { void onMove({ kind: "article", id: article.id, parentId: selectedId, beforeId: entries[index + 2]?.id ?? null }).catch(() => {}); }} className="p-1.5 text-zinc-400 disabled:opacity-20"><ArrowDown size={14} /></button></div>}</div>)}{!entries.length && <div className="rounded-xl border border-dashed border-zinc-800 p-8 text-center text-sm text-zinc-500">{query ? "No matching articles in this view." : "No articles here yet. Create one or move an article into this category."}</div>}</div>
      </div>
    </div>
  </section>;
}
