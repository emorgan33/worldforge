"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"ALL" | "article" | "statblock">("ALL");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({ worldId, q: q.trim() });
      const res = await fetch(`/api/articles?${params}`);
      const articles = await res.json();
      let mapped: SearchResult[] = (Array.isArray(articles) ? articles : []).map(
        (a: { id: string; title: string }) => ({ id: a.id, title: a.title, kind: "article" as const })
      );
      setResults(mapped);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [worldId]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(query), 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  const filtered = typeFilter === "ALL" ? results : results.filter(r => r.kind === typeFilter);

  function handleSelect(item: SearchResult) {
    onSelect(item.kind, item.id, item.title);
    setQuery("");
    setResults([]);
    setOpen(false);
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
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
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
        </div>
      )}
    </div>
  );
}
