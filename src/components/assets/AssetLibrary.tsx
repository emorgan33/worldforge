"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";
/* Uploaded images use the byte-serving route directly. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES, type ImageAssetItem } from "@/lib/assets";
import type { GuardRegistration } from "@/lib/navigation-guard";

const inputClass = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200";
async function jsonResponse(response: Response) {
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to update the image library.");
  return result;
}

interface AssetUsage {
  worldCover: boolean | null;
  worldBanner: boolean | null;
  worldBackground: boolean | null;
  articleCount: number;
  articles: { id: string; title: string; slug: string; categoryName: string | null }[];
}

export function AssetLibrary({ worldId, onSelect, onGuardChange }: { worldId: string; onSelect?: (asset: ImageAssetItem) => void; onGuardChange?: (registration: GuardRegistration) => void }) {
  const [assets, setAssets] = useState<ImageAssetItem[]>([]);
  const [search, setSearch] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ImageAssetItem | null>(null);
  const uploadInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadAlt, setUploadAlt] = useState("");

  useWorldGuard({ dirty: !!file || !!uploadTitle || !!uploadAlt, busy }, "asset", onGuardChange);

  useEffect(() => {
    const controller = new AbortController();
    const current = ++generation.current;
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const result = await fetch(`/api/assets?${new URLSearchParams({ worldId, q: search, includeArchived: String(includeArchived) })}`, { signal: controller.signal }).then(jsonResponse);
        if (generation.current === current) { setAssets(result.assets); setCursor(result.nextCursor); }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Unable to load images."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [worldId, search, includeArchived, refresh]);

  async function loadMore() {
    if (!cursor) return;
    const current = generation.current;
    setLoadingMore(true);
    try {
      const result = await fetch(`/api/assets?${new URLSearchParams({ worldId, q: search, includeArchived: String(includeArchived), cursor })}`).then(jsonResponse);
      if (current === generation.current) { setAssets(previous => [...previous, ...result.assets.filter((asset: ImageAssetItem) => !previous.some(item => item.id === asset.id))]); setCursor(result.nextCursor); }
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load more images."); }
    finally { setLoadingMore(false); }
  }
  async function upload(event: React.FormEvent) {
    event.preventDefault(); if (!file) return;
    if (file.size > MAX_IMAGE_BYTES || !IMAGE_ACCEPT.split(",").includes(file.type)) { setError("Choose a PNG, JPEG or WebP image no larger than 10 MB."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const form = new FormData(); form.set("worldId", worldId); form.set("file", file); form.set("title", uploadTitle); form.set("alt", uploadAlt);
      const result = await fetch("/api/assets", { method: "POST", body: form }).then(jsonResponse);
      setSelected(result); setSearch(""); setFile(null); setUploadTitle(""); setUploadAlt(""); setRefresh(r => r + 1);
      setMessage(result.reused ? "An existing image with the same content was restored." : "Image uploaded.");
    } catch (error) { setError(error instanceof Error ? error.message : "Upload failed."); }
    finally { setBusy(false); }
  }
  async function update(asset: ImageAssetItem, changes: { title?: string; alt?: string; archived?: boolean }) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await fetch("/api/assets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: asset.id, worldId, ...changes }) }).then(jsonResponse);
      setSelected(result); setRefresh(r => r + 1); setMessage(changes.archived === false ? "Image restored to library." : changes.archived ? "Image hidden from library." : "Image updated.");
    } catch (error) { setError(error instanceof Error ? error.message : "Update failed."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Image library">
    {error && <p role="alert" className="mb-3 rounded-lg border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">{error}</p>}
    {message && !error && <p role="status" className="mb-3 rounded-lg border border-green-800 bg-green-950 px-3 py-2 text-sm text-green-200">{message}</p>}
    <form onSubmit={upload} className="mb-5 grid gap-3 sm:grid-cols-4"><div className="sm:col-span-2"><label className="mb-1 block text-xs text-zinc-400">Upload image<input ref={uploadInput} type="file" accept={IMAGE_ACCEPT} onChange={e => { setFile(e.target.files?.[0] ?? null); setError(""); }} className="mt-1 block w-full text-sm text-zinc-400 file:mr-4 file:rounded-lg file:border file:border-zinc-600 file:bg-zinc-800 file:px-3 file:py-1 file:text-zinc-200" /></label></div><div><label className="mb-1 block text-xs text-zinc-400">Title<input aria-label="Image title" maxLength={200} value={uploadTitle} onChange={e => setUploadTitle(e.target.value)} placeholder="Optional" className={inputClass} /></label></div><div><label className="mb-1 block text-xs text-zinc-400">Alt text<input aria-label="Alternative text" maxLength={1000} value={uploadAlt} onChange={e => setUploadAlt(e.target.value)} placeholder="Describe the image" className={inputClass} /></label></div><div className="flex items-end"><button type="submit" disabled={!file || busy} className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-40">Upload</button></div></form>
    <div className="mb-4 flex flex-wrap items-center gap-3"><label className="text-xs text-zinc-400">Search<input aria-label="Search images" value={search} onChange={e => { setSearch(e.target.value); setSelected(null); }} className="ml-1 w-40 rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm" /></label><label className="flex items-center gap-2 text-xs text-zinc-400"><input type="checkbox" checked={includeArchived} onChange={e => { setIncludeArchived(e.target.checked); setSelected(null); }} />Show hidden images</label></div>
    {loading ? <p role="status" className="text-sm text-zinc-400">Loading images…</p> : assets.length === 0 ? <p className="py-5 text-sm text-zinc-500">{search ? "No matching images." : "No images yet. Upload your first image above."}</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{assets.map(asset => <button type="button" aria-label={`View image ${asset.title}`} aria-pressed={selected?.id === asset.id} key={asset.id} onClick={() => setSelected(asset)} className={`overflow-hidden rounded-lg border text-left ${selected?.id === asset.id ? "border-indigo-400" : "border-zinc-700 hover:border-zinc-500"}`}>
      <img src={asset.url} alt="" loading="lazy" className="h-28 w-full bg-zinc-950 object-contain" /><span className="block truncate p-2 text-xs text-zinc-200">{asset.title}{asset.archived ? " · Hidden" : ""}</span><span className="block px-2 pb-2 text-[10px] text-zinc-500">{asset.width} × {asset.height} · {Math.max(1, Math.round(asset.byteSize / 1024))} KB</span>
    </button>)}</div>}
    {cursor && !loading && <button type="button" disabled={loadingMore} onClick={() => void loadMore()} className="text-sm text-indigo-300">{loadingMore ? "Loading…" : "Load more images"}</button>}
    {selected && <AssetDetails key={`${selected.id}-${selected.title}-${selected.alt}-${selected.archived}`} asset={selected} busy={busy} onUpdate={changes => update(selected, changes)} onSelect={onSelect} onMessage={setMessage} onRefresh={() => { setSelected(null); setRefresh(r => r + 1); }} />}
  </section>;
}

function AssetDetails({ asset, busy, onUpdate, onSelect, onMessage, onRefresh }: { asset: ImageAssetItem; busy: boolean; onUpdate: (changes: { title?: string; alt?: string; archived?: boolean }) => Promise<void>; onSelect?: (asset: ImageAssetItem) => void; onMessage: (message: string) => void; onRefresh: () => void }) {
  const [title, setTitle] = useState(asset.title), [alt, setAlt] = useState(asset.alt);
  const [showUsage, setShowUsage] = useState(false);
  const [usage, setUsage] = useState<AssetUsage | null>(null);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useWorldGuard({ dirty: title !== asset.title || alt !== asset.alt, busy: deleting }, "asset");

  async function loadUsage() {
    setLoadingUsage(true);
    try {
      const result = await fetch(`/api/assets/${asset.id}/usage`).then(jsonResponse);
      setUsage(result);
    } catch { onMessage("Failed to load usage information."); }
    finally { setLoadingUsage(false); }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const result = await fetch(`/api/assets/${asset.id}/permanent`, { method: "DELETE" }).then(jsonResponse);
      if (result.deleted) { onMessage("Image permanently deleted."); onRefresh(); }
      else if (result.referenced) { setShowDeleteConfirm(false); setShowUsage(true); onMessage(`Cannot delete: used as cover/banner and in ${result.references?.articleCount || 0} articles.`); }
    } catch (error) { onMessage(error instanceof Error ? error.message : "Failed to delete image."); }
    finally { setDeleting(false); setShowDeleteConfirm(false); }
  }

  return <section aria-label="Selected image" className="space-y-4 rounded-xl border border-indigo-800/50 bg-zinc-900 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-sm font-semibold text-zinc-100">{asset.title}</h3>{onSelect && <button type="button" disabled={busy || asset.archived} onClick={() => onSelect({ ...asset, alt })} className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-bold text-zinc-950 disabled:opacity-40">Use image</button>}</div>
    <form onSubmit={e => { e.preventDefault(); void onUpdate({ title, alt }); }} className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-zinc-300">Image title<input aria-label="Selected image title" required maxLength={200} value={title} onChange={e => setTitle(e.target.value)} className={inputClass} /></label><label className="text-xs text-zinc-300">Default alternative text<input aria-label="Selected image alternative text" maxLength={1000} value={alt} onChange={e => setAlt(e.target.value)} className={inputClass} /></label><button type="submit" disabled={busy || !title.trim()} className="justify-self-start rounded-lg border border-zinc-600 px-3 py-2 text-xs disabled:opacity-40">Save image details</button></form>
    <div className="flex flex-wrap gap-4 text-xs"><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(new URL(asset.url, window.location.origin).href); onMessage("Image URL copied."); } catch { onMessage(`Image URL: ${asset.url}`); } }} className="text-indigo-300">Copy image URL</button><button type="button" disabled={busy} onClick={() => void onUpdate({ archived: !asset.archived })} className="text-zinc-400">{asset.archived ? "Restore image" : "Hide from library"}</button><button type="button" disabled={busy} onClick={() => { setShowUsage(true); if (!usage) void loadUsage(); }} className="text-indigo-300">Show usage</button><button type="button" disabled={busy} onClick={() => setShowDeleteConfirm(true)} className="text-red-400">Delete image</button></div>
    {showUsage && <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-3 text-xs">
      <h4 className="mb-2 font-semibold text-zinc-300">Image Usage</h4>
      {loadingUsage ? <p className="text-zinc-500">Loading...</p> : usage ? <div>
        <p className="text-zinc-400">Used as:</p><ul className="mt-1 space-y-1 text-zinc-300">
          {usage.worldCover && <li>• World cover image</li>}
          {usage.worldBanner && <li>• World banner image</li>}
          {usage.worldBackground && <li>• World background image</li>}
          {(usage.worldCover || usage.worldBanner || usage.worldBackground || usage.articleCount > 0) === false && <li className="text-zinc-500">Not referenced anywhere</li>}
        </ul>
        {usage.articleCount > 0 && <div><p className="mt-2 text-zinc-400">Used in {usage.articleCount} article{usage.articleCount !== 1 ? "s" : ""}:</p><ul className="mt-1 max-h-40 space-y-1 overflow-y-auto text-zinc-300">{usage.articles.slice(0, 10).map(a => <li key={a.id}>• {a.title}{a.categoryName ? ` (${a.categoryName})` : ""}</li>)}{usage.articleCount > 10 && <li className="text-zinc-500">...and {usage.articleCount - 10} more</li>}</ul></div>}
      </div> : null}
      <button type="button" onClick={() => setShowUsage(false)} className="mt-2 text-indigo-300">Close</button>
    </div>}
    {showDeleteConfirm && <div className="rounded-lg border border-red-700/50 bg-red-950/30 p-3 text-xs">
      <p className="font-semibold text-red-300">Permanently delete this image?</p>
      {usage && (usage.worldCover || usage.worldBanner || usage.worldBackground || usage.articleCount > 0) ? <p className="mt-1 text-zinc-400">This image is still in use. Remove it from all references first, or use &quot;Hide from library&quot; to archive it.</p>
      : <p className="mt-1 text-zinc-400">This will delete the image file and cannot be undone. Articles using this image will show broken images.</p>}
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={deleting || !!(usage && (usage.worldCover || usage.worldBanner || usage.worldBackground || usage.articleCount > 0))} onClick={() => void confirmDelete()} className="rounded bg-red-600 px-3 py-1 text-zinc-100 disabled:opacity-50">Delete permanently</button>
        <button type="button" disabled={deleting} onClick={() => setShowDeleteConfirm(false)} className="rounded border border-zinc-600 px-3 py-1 text-zinc-300">Cancel</button>
      </div>
    </div>}
  </section>;
}
