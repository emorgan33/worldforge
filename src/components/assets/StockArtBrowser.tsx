"use client";
/* Bundled artwork previews use the private, author-only byte route. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { useWorldGuard } from "@/components/worlds/WorldGuard";
import type { ImageAssetItem } from "@/lib/assets";
import { PLACEMENT_LABELS, type ImagePlacementPurpose } from "@/lib/image-placement";
import { PlacementPreview, type PlacementRecommendation } from "./PlacementPreview";

export type StockArtPurpose = ImagePlacementPurpose;

interface CatalogCredit {
  text: string;
  required: boolean;
  licenseUrl: string;
  sourceUrl?: string;
  creatorUrl?: string;
}

interface CatalogEntrySummary {
  id: string;
  version: number;
  collection: string;
  collectionTitle: string;
  title: string;
  reviewStatus: "approved" | "pending";
  subjectTypes: string[];
  styleTags: string[];
  defaultAlt: string;
  thumbnailUrl: string;
  previewUrl: string;
  credit: CatalogCredit;
  recommendation: PlacementRecommendation | null;
  saved: { assetId: string } | null;
}

interface CatalogDetails extends Omit<CatalogEntrySummary, "credit" | "collectionTitle"> {
  collectionTitle: string;
  searchTerms: string[];
  visual: { recommendations: PlacementRecommendation[] };
  creator: { name: string; url?: string };
  source: { itemUrl: string; originalFilename: string; acquiredAt: string };
  rights: { licenseId: string; licenseUrl: string; publicDomainBasis?: string; evidence: { id: string; sha256: string; reviewer: string; reviewedAt: string } };
  allowedUses: Record<string, "allowed" | "prohibited">;
  attribution: {
    creditText: string;
    required: boolean;
    placement: "adjacent" | "credits-section";
    creatorUrl?: string;
    sourceUrl?: string;
    licenseUrl: string;
    modificationNotice?: string;
  };
  derivatives: { width: number; height: number; modifications: string[] };
}

interface CatalogPage {
  catalogRevision: string;
  collections: { id: string; title: string }[];
  subjects: string[];
  styles: string[];
  total: number;
  entries: CatalogEntrySummary[];
  nextCursor: string | null;
}

async function jsonResponse(response: Response) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to load the stock-art catalog.");
  return result;
}

export function StockArtBrowser({ worldId, purpose, onUse, onBrowseWorldImages }: {
  worldId: string;
  purpose?: StockArtPurpose;
  onUse: (asset: ImageAssetItem, reused: boolean) => void;
  onBrowseWorldImages: () => void;
}) {
  const [entries, setEntries] = useState<CatalogEntrySummary[]>([]);
  const [collections, setCollections] = useState<{ id: string; title: string }[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("");
  const [subject, setSubject] = useState("");
  const [style, setStyle] = useState("");
  const [recommendedOnly, setRecommendedOnly] = useState(!!purpose);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<CatalogEntrySummary | null>(null);
  const [details, setDetails] = useState<CatalogDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState("");
  const [useBusy, setUseBusy] = useState(false);
  const [useError, setUseError] = useState("");
  const generation = useRef(0);
  const cards = useRef(new Map<string, HTMLButtonElement>());
  const previousSelection = useRef<string | null>(null);
  const detailsRequest = useRef<AbortController | null>(null);

  useWorldGuard({ dirty: false, busy: useBusy }, "asset");

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const params = new URLSearchParams();
        if (search) params.set("q", search);
        if (collection) params.set("collection", collection);
        if (subject) params.set("subject", subject);
        if (style) params.set("style", style);
        if (purpose) { params.set("purpose", purpose); if (recommendedOnly) params.set("recommendedOnly", "true"); }
        const result = await fetch(`/api/worlds/${worldId}/stock-art?${params}`, { signal: controller.signal }).then(jsonResponse) as CatalogPage;
        if (generation.current === current) {
          setEntries(result.entries);
          setCollections(result.collections);
          setSubjects(result.subjects);
          setStyles(result.styles);
          setCursor(result.nextCursor);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load the stock-art catalog.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [worldId, search, collection, subject, style, purpose, recommendedOnly]);

  useEffect(() => () => detailsRequest.current?.abort(), []);

  async function loadMore() {
    if (!cursor) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams({ cursor });
      if (search) params.set("q", search);
      if (collection) params.set("collection", collection);
      if (subject) params.set("subject", subject);
      if (style) params.set("style", style);
      if (purpose) { params.set("purpose", purpose); if (recommendedOnly) params.set("recommendedOnly", "true"); }
      const result = await fetch(`/api/worlds/${worldId}/stock-art?${params}`).then(jsonResponse) as CatalogPage;
      if (current === generation.current) {
        setEntries(previous => [...previous, ...result.entries.filter(entry => !previous.some(item => item.id === entry.id && item.version === entry.version))]);
        setCursor(result.nextCursor);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load more artwork.");
    } finally { setLoadingMore(false); }
  }

  function choose(entry: CatalogEntrySummary) {
    previousSelection.current = entry.id;
    detailsRequest.current?.abort();
    const controller = new AbortController();
    detailsRequest.current = controller;
    setSelected(entry); setDetails(null); setDetailsLoading(true); setDetailsError(""); setUseError("");
    fetch(`/api/worlds/${worldId}/stock-art/${entry.id}/${entry.version}`, { signal: controller.signal })
      .then(jsonResponse)
      .then(result => { if (!controller.signal.aborted) setDetails(result.entry as CatalogDetails); })
      .catch(error => { if (!controller.signal.aborted) setDetailsError(error instanceof Error ? error.message : "Unable to load this artwork's details."); })
      .finally(() => { if (!controller.signal.aborted) setDetailsLoading(false); });
  }

  function back() {
    const id = previousSelection.current;
    detailsRequest.current?.abort();
    setSelected(null); setDetails(null); setDetailsLoading(false); setDetailsError("");
    window.setTimeout(() => { if (id) cards.current.get(id)?.focus(); }, 0);
  }

  function clearFilters() {
    detailsRequest.current?.abort();
    setSearch(""); setCollection(""); setSubject(""); setStyle(""); setSelected(null); setDetails(null);
  }

  async function addToWorld() {
    if (!selected) return;
    setUseBusy(true); setUseError("");
    try {
      const result = await fetch(`/api/worlds/${worldId}/stock-art`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: selected.id, version: selected.version }),
      }).then(jsonResponse) as { asset: ImageAssetItem; reused: boolean };
      onUse(result.asset, result.reused);
    } catch (error) {
      setUseError(error instanceof Error ? error.message : "Unable to use this artwork. Try again.");
    } finally { setUseBusy(false); }
  }

  const creditText = details?.attribution.creditText ?? selected?.credit?.text ?? null;
  const creditLinks = details?.attribution ?? selected?.credit ?? null;
  const recommendation = details?.visual.recommendations.find(item => item.purpose === purpose) ?? selected?.recommendation ?? null;

  return <section aria-label="Stock art">
    {error && <div role="alert" className="mb-3 rounded-lg border border-danger-800 bg-danger-950 px-3 py-2 text-sm text-danger-200"><p>{error}</p><button type="button" onClick={onBrowseWorldImages} className="mt-2 min-h-10 rounded-lg border border-danger-300/40 px-3 text-xs font-semibold">Use world images</button></div>}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className={selected ? "hidden lg:block" : "block"}>
        <div className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-xs text-app-muted">Search<input aria-label="Search stock art" value={search} onChange={event => { setSearch(event.target.value); setSelected(null); }} className="ml-1 w-40 rounded border border-app-border-strong bg-app-canvas px-3 py-2 text-sm" /></label>
          <label className="text-xs text-app-muted">Collection<select aria-label="Filter by collection" value={collection} onChange={event => { setCollection(event.target.value); setSelected(null); }} className="ml-1 min-h-10 rounded border border-app-border-strong bg-app-canvas px-2 text-sm"><option value="">All</option>{collections.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
          <label className="text-xs text-app-muted">Subject<select aria-label="Filter by subject" value={subject} onChange={event => { setSubject(event.target.value); setSelected(null); }} className="ml-1 min-h-10 rounded border border-app-border-strong bg-app-canvas px-2 text-sm"><option value="">All</option>{subjects.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
          {styles.length > 0 && <label className="text-xs text-app-muted">Style<select aria-label="Filter by style" value={style} onChange={event => { setStyle(event.target.value); setSelected(null); }} className="ml-1 min-h-10 rounded border border-app-border-strong bg-app-canvas px-2 text-sm"><option value="">All</option>{styles.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}
          {(search || collection || subject || style || (purpose && !recommendedOnly)) && <button type="button" onClick={clearFilters} className="min-h-10 rounded-lg border border-app-border-strong px-3 text-xs text-app-text">Clear filters</button>}
        </div>
        {purpose && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs text-app-text-dim"><span>{recommendedOnly ? `Recommended for: ${PLACEMENT_LABELS[purpose]}` : "Browsing all artwork"}</span><button type="button" onClick={() => { setRecommendedOnly(value => !value); setSelected(null); }} className="min-h-10 rounded-lg border border-app-border-strong px-3">{recommendedOnly ? "Browse all artwork" : "Show recommended only"}</button></div>}
        {loading ? <p role="status" className="text-sm text-app-muted">Loading artwork…</p> : entries.length === 0 ? <div className="py-6 text-sm text-app-subtle">
          <p>{search || collection || subject || style ? "No matching artwork." : purpose && recommendedOnly ? "No artwork is reviewed for this placement." : "No stock artwork is installed yet."}</p>
          <div className="mt-2 flex flex-wrap gap-2">{purpose && recommendedOnly && <button type="button" onClick={() => setRecommendedOnly(false)} className="min-h-10 rounded-lg border border-app-border-strong px-3 text-xs text-app-text">Browse all artwork</button>}{(search || collection || subject || style) && <button type="button" onClick={clearFilters} className="min-h-10 rounded-lg border border-app-border-strong px-3 text-xs text-app-text">Clear filters</button>}</div>
        </div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {entries.map(entry => <button key={`${entry.id}@${entry.version}`} ref={node => { if (node) cards.current.set(entry.id, node); else cards.current.delete(entry.id); }} type="button" aria-label={`View details for ${entry.title}`} aria-pressed={selected?.id === entry.id} onClick={() => choose(entry)} className={`overflow-hidden rounded-lg border text-left ${selected?.id === entry.id ? "border-highlight-400 ring-1 ring-highlight-400" : "border-app-border-strong hover:border-app-border-emphasis-strong"}`}>
            <img src={entry.thumbnailUrl} alt="" loading="lazy" className="h-28 w-full bg-app-canvas object-cover" />
            <span className="block truncate p-2 text-xs text-app-text">{entry.title}</span>
            <span className="block truncate px-2 text-[10px] text-app-subtle">{entry.collectionTitle}</span>
            <span className="block px-2 pb-2 text-[10px] font-semibold text-highlight-300">{entry.saved ? "✓ Added to this world" : "View details"}</span>
          </button>)}
        </div>}
        {cursor && !loading && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="mt-3 min-h-10 text-sm text-secondary-300">{loadingMore ? "Loading…" : "Load more artwork"}</button>}
      </div>
      <aside aria-label="Selected artwork" className={selected ? "block" : "hidden lg:block"}>
        {!selected ? <p className="rounded-xl border border-dashed border-app-border p-4 text-sm text-app-subtle">Select artwork to inspect its source, rights and placement preview.</p> : <section className="space-y-4 rounded-xl border border-highlight-800/50 bg-app-surface p-4">
          <button type="button" onClick={back} className="min-h-10 text-xs font-semibold text-highlight-300 lg:hidden">← Back to results</button>
          <div><h3 className="text-sm font-semibold text-app-text-strong">{selected.title}</h3><p className="mt-1 text-xs text-app-muted">{selected.collectionTitle}</p>{selected.saved && <p className="mt-1 text-xs font-semibold text-highlight-300">✓ Added to this world</p>}</div>
          <img src={selected.previewUrl} alt="" className="max-h-56 w-full rounded-lg bg-app-canvas object-contain" />
          {purpose && <PlacementPreview purpose={purpose} title={selected.title} imageUrl={selected.previewUrl} recommendation={recommendation} />}
          {detailsLoading ? <p role="status" className="text-xs text-app-subtle">Loading rights and credit details…</p> : detailsError ? <p role="alert" className="text-xs text-danger-300">{detailsError}</p> : details && <div className="space-y-2 text-xs text-app-text-dim">
            <p><span className="text-app-subtle">Creator:</span> {details.creator.url ? <a href={details.creator.url} target="_blank" rel="noreferrer" className="text-secondary-300 underline">{details.creator.name}</a> : details.creator.name}</p>
            <p><span className="text-app-subtle">Source:</span> <a href={details.source.itemUrl} target="_blank" rel="noreferrer" className="text-secondary-300 underline">Original artwork</a></p>
            <p><span className="text-app-subtle">License:</span> <a href={details.rights.licenseUrl} target="_blank" rel="noreferrer" className="text-secondary-300 underline">{details.rights.licenseId}</a></p>
            <p><span className="text-app-subtle">Provenance:</span> {details.reviewStatus === "approved" ? "Reviewed catalog provenance" : "Pending human review — not verified"}</p>
            {details.attribution.modificationNotice && <p><span className="text-app-subtle">Modification:</span> {details.attribution.modificationNotice}</p>}
            <p className="text-app-muted">{details.attribution.required ? "Credit is required." : "Credit is provided voluntarily."} {details.attribution.placement === "adjacent" ? "Place credit beside the artwork." : "Credit appears in the artwork credits section."}</p>
          </div>}
          {creditText && creditLinks && <div className="rounded-lg border border-app-border-strong bg-app-canvas p-3 text-xs"><p className="font-semibold text-app-text">Exact credit</p><p className="mt-1 break-words text-app-text-dim">{creditText}</p><div className="mt-2 flex flex-wrap gap-3">{creditLinks.creatorUrl && <a href={creditLinks.creatorUrl} target="_blank" rel="noreferrer" className="text-secondary-300 underline">Creator</a>}{creditLinks.sourceUrl && <a href={creditLinks.sourceUrl} target="_blank" rel="noreferrer" className="text-secondary-300 underline">Source</a>}<a href={creditLinks.licenseUrl} target="_blank" rel="noreferrer" className="text-secondary-300 underline">License</a></div></div>}
          {recommendation && <p className="text-xs text-app-muted"><span className="font-semibold text-app-text">{recommendation.recommended ? "Recommended for this placement." : "Not recommended for this crop."}</span> {recommendation.rationale}</p>}
          <p className="text-xs text-app-muted">Selecting artwork adds a private world copy. It does not share the image with players.</p>
          {useError && <p role="alert" className="rounded-lg border border-danger-800 bg-danger-950 px-3 py-2 text-xs text-danger-200">{useError}</p>}
          <div className="flex flex-wrap gap-2"><button type="button" disabled={useBusy || detailsLoading} onClick={() => void addToWorld()} className="min-h-11 rounded-lg bg-primary-500 px-4 py-2 text-xs font-bold text-app-on-accent disabled:opacity-40">{useBusy ? "Adding…" : "Use image"}</button>{useError && <button type="button" disabled={useBusy} onClick={() => void addToWorld()} className="min-h-11 rounded-lg border border-app-border-emphasis px-3 text-xs text-app-text">Retry</button>}</div>
        </section>}
      </aside>
    </div>
  </section>;
}
