"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { ARTICLE_TEMPLATES } from "@/lib/templates";
import { campaignSearchUrl, filterLocalCommands, type CampaignSearchHit, type SearchKind } from "@/lib/campaign-search";
import type { ArticleTemplateType, CategoryItem } from "@/types";
import { categoryOptions } from "@/lib/category-tree";

export interface SearchCommand {
  id: string;
  title: string;
  description: string;
  keywords?: string;
  run: () => void;
}

const TEMPLATES = Object.values(ARTICLE_TEMPLATES);

export function CommandSearch({
  open,
  onOpenChange,
  worldId,
  categories = [],
  commands,
  onSelectArticle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  worldId?: string;
  categories?: CategoryItem[];
  commands: SearchCommand[];
  onSelectArticle?: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<SearchKind>("all");
  const [template, setTemplate] = useState("");
  const [status, setStatus] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [hits, setHits] = useState<CampaignSearchHit[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const request = useRef(0);

  const local = filterLocalCommands(commands, query, kind);
  const articleCommands: SearchCommand[] = kind === "categories" || kind === "tools" ? [] : hits.map(hit => ({
    id: `article-${hit.id}`,
    title: hit.title,
    description: `Article · ${hit.categoryPath} · ${hit.publicationStatus} · ${ARTICLE_TEMPLATES[hit.template as ArticleTemplateType]?.label || hit.template}`,
    run: () => onSelectArticle?.(hit.id),
  }));
  const results = [...local, ...articleCommands];
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.altKey && !event.isComposing) {
        if (!open && document.querySelector("dialog[open]")) return;
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [open, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    input.current?.focus();
    return () => element?.close();
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`command-result-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, query, hits]);

  useEffect(() => {
    if (!open || !worldId || kind === "categories" || kind === "tools") {
      setHits([]);
      setNextCursor(null);
      setLoading(false);
      return;
    }
    setHits([]);
    setNextCursor(null);
    setSelected(0);
    const controller = new AbortController();
    const id = ++request.current;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(campaignSearchUrl(worldId, {
        q: query,
        ...(template ? { template: template as ArticleTemplateType } : {}),
        ...(status ? { status: status as "DRAFT" | "WIP" | "PUBLISHED" } : {}),
        ...(categoryId ? { categoryId } : {}),
      }), { signal: controller.signal }).then(async response => {
        if (id !== request.current) return;
        if (!response.ok) throw new Error("Search failed.");
        const body = await response.json() as { articles: CampaignSearchHit[]; nextCursor: string | null };
        if (id !== request.current) return;
        setHits(body.articles);
        setNextCursor(body.nextCursor);
        setSelected(0);
      }).catch(error => {
        if (controller.signal.aborted || id !== request.current) return;
        console.error(error);
        setHits([]);
        setNextCursor(null);
      }).finally(() => { if (id === request.current) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, worldId, query, kind, template, status, categoryId]);

  const loadMore = () => {
    if (!worldId || !nextCursor || loading) return;
    const controller = new AbortController();
    const id = ++request.current;
    setLoading(true);
    fetch(campaignSearchUrl(worldId, {
      q: query,
      ...(template ? { template: template as ArticleTemplateType } : {}),
      ...(status ? { status: status as "DRAFT" | "WIP" | "PUBLISHED" } : {}),
      ...(categoryId ? { categoryId } : {}),
      cursor: nextCursor,
    }), { signal: controller.signal }).then(async response => {
      if (id !== request.current) return;
      if (!response.ok) throw new Error("Search failed.");
      const body = await response.json() as { articles: CampaignSearchHit[]; nextCursor: string | null };
      if (id !== request.current) return;
      setHits(current => [...current, ...body.articles]);
      setNextCursor(body.nextCursor);
    }).catch(error => { if (!controller.signal.aborted && id === request.current) console.error(error); }).finally(() => { if (id === request.current) setLoading(false); });
  };

  const close = () => onOpenChange(false);
  const choose = (command: SearchCommand) => { close(); command.run(); };
  if (!open) return null;
  const palette = <dialog ref={dialog} aria-labelledby="command-search-heading" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) { const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) close(); } }} className="m-auto w-[min(640px,94vw)] rounded-2xl border border-zinc-700 bg-zinc-950 p-0 text-zinc-100 shadow-2xl backdrop:bg-black/75">
    <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3"><h2 id="command-search-heading" className="text-sm font-semibold">Search campaign</h2><button type="button" onClick={close} aria-label="Close campaign search" className="rounded p-1 text-zinc-400 hover:text-white"><X className="h-4 w-4" /></button></div>
    <div className="flex items-center gap-3 px-5 py-4"><Search className="h-5 w-5 text-zinc-400" /><input ref={input} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setSelected(results.length ? (activeIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0); }
      if (event.key === "Enter") { event.preventDefault(); if (results[activeIndex]) choose(results[activeIndex]); }
    }} role="combobox" aria-label="Search articles, categories and tools" aria-expanded="true" aria-controls="command-search-results" aria-autocomplete="list" aria-activedescendant={results.length ? `command-result-${activeIndex}` : undefined} placeholder="Find an article, category or tool…" className="w-full bg-transparent text-sm outline-none" /></div>
    <div className="flex flex-wrap gap-2 border-t border-zinc-800 px-5 py-3 text-xs">
      <label className="flex items-center gap-2">Result type<select aria-label="Result type" value={kind} onChange={event => setKind(event.target.value as SearchKind)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"><option value="all">All</option><option value="articles">Articles</option><option value="categories">Categories</option><option value="tools">Tools</option></select></label>
      <label className="flex items-center gap-2">Template<select aria-label="Template" value={template} onChange={event => setTemplate(event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"><option value="">Any template</option>{TEMPLATES.map(item => <option key={item.type} value={item.type}>{item.label}</option>)}</select></label>
      <label className="flex items-center gap-2">Status<select aria-label="Publication status" value={status} onChange={event => setStatus(event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"><option value="">Any status</option><option value="DRAFT">Draft</option><option value="WIP">WIP</option><option value="PUBLISHED">Published</option></select></label>
      <label className="flex items-center gap-2">Category<select aria-label="Category" value={categoryId} onChange={event => setCategoryId(event.target.value)} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1"><option value="">Any category</option>{categoryOptions(categories).map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    </div>
    <div id="command-search-results" role="listbox" aria-label="Campaign search results" className="max-h-[50vh] overflow-y-auto border-t border-zinc-800 p-2">
      {loading && !results.length && <p role="status" className="p-5 text-sm text-zinc-400">Searching…</p>}
      {!loading && !results.length && <p role="status" className="p-5 text-sm text-zinc-400">No matches. Try another title, body phrase or filter.</p>}
      {results.map((command, index) => <div key={command.id} id={`command-result-${index}`} role="option" aria-selected={index === activeIndex} onMouseDown={event => event.preventDefault()} onClick={() => choose(command)} className={`cursor-pointer rounded-lg px-3 py-2 ${index === activeIndex ? "bg-indigo-600/25 text-indigo-100" : "hover:bg-zinc-900"}`}><div className="truncate text-sm font-medium">{command.title}</div><div className="truncate text-xs text-zinc-400">{command.description}</div></div>)}
      {nextCursor && kind !== "categories" && kind !== "tools" && <button type="button" onClick={loadMore} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-indigo-300 hover:bg-zinc-900">{loading ? "Loading…" : "Load more articles"}</button>}
    </div>
    <p className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">↑ ↓ to select · Enter to open · Esc to close · Ctrl/Cmd+K to search</p>
  </dialog>;
  return typeof document === "undefined" ? palette : createPortal(palette, document.body);
}
