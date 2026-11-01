"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { fetchWorkspaceArticlePage, WORKSPACE_ARTICLE_PAGE_SIZE } from "@/lib/workspace-articles";

interface EntityRelationshipPickerProps {
  worldId: string;
  onSelect: (kind: string, entityId: string, label?: string) => void;
}

interface SearchResult {
  id: string;
  title: string;
  kind: "article" | "statblock";
}

export function EntityRelationshipPicker({ worldId, onSelect }: EntityRelationshipPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultScope, setResultScope] = useState(`${worldId}\0`);
  const [loadingScope, setLoadingScope] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "article" | "statblock">("ALL");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const requestGeneration = useRef(0);
  const worldRef = useRef(worldId);
  const queryRef = useRef(query);
  const activeRequest = useRef<AbortController | null>(null);

  const isCurrentRequest = useCallback((generation: number, requestedWorldId: string, requestedQuery: string) =>
    requestGeneration.current === generation
      && worldRef.current === requestedWorldId
      && queryRef.current.trim() === requestedQuery, []);

  useEffect(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestGeneration.current++;
    worldRef.current = worldId;
  }, [worldId]);

  const scope = `${worldId}\0${query.trim()}`;
  const scopedResults = resultScope === scope ? results : [];
  const scopedCursor = resultScope === scope ? nextCursor : null;
  const loading = loadingScope === scope;

  const doSearch = useCallback(async (q: string, generation: number) => {
    if (!q.trim()) {
      return;
    }
    const requestedWorldId = worldId;
    const requestedQuery = q.trim();
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadingScope(`${requestedWorldId}\0${requestedQuery}`);
    try {
      const articles = await fetchWorkspaceArticlePage(requestedWorldId, { query: requestedQuery, signal: controller.signal });
      const mapped: SearchResult[] = articles.map(
        (a: { id: string; title: string }) => ({ id: a.id, title: a.title, kind: "article" as const })
      );
      if (isCurrentRequest(generation, requestedWorldId, requestedQuery)) {
        setResults(mapped);
        setResultScope(`${requestedWorldId}\0${requestedQuery}`);
        setNextCursor(articles.length === WORKSPACE_ARTICLE_PAGE_SIZE ? articles[articles.length - 1].id : null);
      }
    } catch {
      if (isCurrentRequest(generation, requestedWorldId, requestedQuery)) {
        setResults([]);
        setResultScope(`${requestedWorldId}\0${requestedQuery}`);
        setNextCursor(null);
      }
    } finally {
      if (isCurrentRequest(generation, requestedWorldId, requestedQuery)) {
        if (activeRequest.current === controller) activeRequest.current = null;
        setLoadingScope(null);
      }
    }
  }, [isCurrentRequest, worldId]);

  const loadMore = useCallback(async () => {
    if (!scopedCursor || loading || !query.trim()) return;
    const generation = requestGeneration.current;
    const requestedWorldId = worldId;
    const requestedQuery = query.trim();
    const requestedCursor = scopedCursor;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setLoadingScope(`${requestedWorldId}\0${requestedQuery}`);
    try {
      const articles = await fetchWorkspaceArticlePage(requestedWorldId, { query: requestedQuery, cursor: requestedCursor, signal: controller.signal });
      if (isCurrentRequest(generation, requestedWorldId, requestedQuery)) {
        setResults(previous => [...previous, ...articles.map(a => ({ id: a.id, title: a.title, kind: "article" as const }))]);
        setResultScope(`${requestedWorldId}\0${requestedQuery}`);
        setNextCursor(articles.length === WORKSPACE_ARTICLE_PAGE_SIZE ? articles[articles.length - 1].id : null);
      }
    } catch {
      if (isCurrentRequest(generation, requestedWorldId, requestedQuery)) setNextCursor(null);
    } finally {
      if (isCurrentRequest(generation, requestedWorldId, requestedQuery)) {
        if (activeRequest.current === controller) activeRequest.current = null;
        setLoadingScope(null);
      }
    }
  }, [isCurrentRequest, loading, query, scopedCursor, worldId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) return;
    const generation = requestGeneration.current;
    debounceRef.current = setTimeout(() => doSearch(query, generation), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const filtered = !query.trim() ? [] : typeFilter === "ALL" ? scopedResults : scopedResults.filter(r => r.kind === typeFilter);

  function handleSelect(item: SearchResult) {
    onSelect(item.kind, item.id, item.title);
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestGeneration.current++;
    queryRef.current = "";
    setQuery("");
    setResults([]);
    setNextCursor(null);
    setLoadingScope(null);
    setOpen(false);
  }

  function handleQueryChange(value: string) {
    activeRequest.current?.abort();
    activeRequest.current = null;
    requestGeneration.current++;
    queryRef.current = value;
    setQuery(value);
    setOpen(true);
  }

  return (
    <div className="relative">
      <div className="flex gap-1.5 mb-1.5">
        {(["ALL", "article", "statblock"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTypeFilter(t)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold border transition-colors ${
              typeFilter === t
                ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                : "bg-zinc-800/50 text-zinc-400 border-zinc-700 hover:border-zinc-600"
            }`}
          >
            {t === "ALL" ? "All" : t === "article" ? "Articles" : "Statblocks"}
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => handleQueryChange(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search entities..."
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
        />
        {loading && (
          <span className="absolute right-2.5 top-2 h-3 w-3 animate-spin rounded-full border-2 border-zinc-500 border-t-transparent" />
        )}
      </div>

      {open && query.trim() && (
        <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-lg border border-zinc-700 bg-zinc-900 shadow-xl max-h-48 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-3 text-xs text-zinc-500 text-center">No results found.</p>
          ) : (
            filtered.map(item => (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => handleSelect(item)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-amber-900/20 hover:text-amber-200 transition-colors"
              >
                <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                  item.kind === "article"
                    ? "bg-indigo-500/15 text-indigo-300"
                    : "bg-amber-500/15 text-amber-300"
                }`}>
                  {item.kind}
                </span>
                {item.title}
              </button>
            ))
          )}
          {scopedCursor && (
            <button onClick={() => void loadMore()} disabled={loading} className="w-full border-t border-zinc-800 px-3 py-2 text-xs text-amber-300 hover:bg-amber-900/20 disabled:opacity-50">
              {loading ? "Loading…" : "Load more articles"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
