"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Candidate = { id: string; name: string; type: string; source?: string; supported: boolean; warnings: string[]; category?: string; stats: Record<string, unknown>; level?: string | number; rarity?: string; status?: string; destinationEdited?: boolean };
type Outcome = { candidateId: string; status: "created" | "skipped" | "failed"; blockId?: string; reason?: string };
const PAGE = 50;
const EMPTY_ITEMS: Candidate[] = [];
const input = "mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30";

async function responseJson(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Request failed (${response.status}).`);
  return data;
}

export function FoundryImport({ worldId, onComplete, onOpenBlock }: { worldId: string; onComplete?: () => Promise<void> | void; onOpenBlock?: (id: string) => void }) {
  const [open, setOpen] = useState(false), [files, setFiles] = useState<File[]>([]);
  const [systemVersion, setSystemVersion] = useState("8.6.1"), [foundryVersion, setFoundryVersion] = useState("14.369"), [remaster, setRemaster] = useState("yes"), [namespace, setNamespace] = useState("");
  const [preview, setPreview] = useState<{ id: string; items: Candidate[]; expiresAt: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]), [query, setQuery] = useState(""), [type, setType] = useState("ALL"), [source, setSource] = useState("ALL"), [page, setPage] = useState(0), [detail, setDetail] = useState<Candidate | null>(null);
  const [review, setReview] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [progress, setProgress] = useState(""), [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const session = useRef(0), abort = useRef<AbortController | null>(null), stopAfterBatch = useRef(false), batchKeys = useRef(new Map<string, string>());
  const fileInput = useRef<HTMLInputElement>(null);
  const paused = useWorldGuard({ dirty: open && (files.length > 0 || selected.length > 0), busy }, "foundry");
  const items = preview ? preview.items : EMPTY_ITEMS;
  const types = useMemo(() => [...new Set(items.map(i => i.type))].sort(), [items]);
  const sources = useMemo(() => [...new Set(items.map(i => i.source).filter((v): v is string => !!v))].sort(), [items]);
  const filtered = useMemo(() => items.filter(i => (type === "ALL" || i.type === type) && (source === "ALL" || i.source === source) && [i.name, i.type, i.source, i.category, i.level, i.rarity].join(" ").toLowerCase().includes(query.toLowerCase())), [items, type, source, query]);
  const visible = filtered.slice(page * PAGE, (page + 1) * PAGE);
  const chosen = items.filter(i => selected.includes(i.id));
  const supported = chosen.filter(i => i.supported);
  function reset() { session.current++; abort.current?.abort(); abort.current = null; batchKeys.current.clear(); setBusy(false); setFiles([]); if (fileInput.current) fileInput.current.value = ""; setPreview(null); setSelected([]); setDetail(null); setReview(false); setOutcomes([]); setProgress(""); setError(""); setPage(0); setQuery(""); setType("ALL"); setSource("ALL"); }

  async function upload(event: React.FormEvent) {
    event.preventDefault(); event.stopPropagation(); if (paused || !files.length || !systemVersion.trim() || !foundryVersion.trim() || !namespace.trim() || !remaster) return;
    reset(); setBusy(true); const id = ++session.current, controller = new AbortController(); abort.current = controller;
    try {
      const encoded = await Promise.all(files.map(async file => ({ name: file.name, text: await file.text() })));
      if (id !== session.current) return;
      const data = await responseJson(await fetch(`/api/worlds/${worldId}/foundry/previews`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ files: encoded, metadata: { system: "pf2e", systemVersion: systemVersion.trim(), foundryVersion: foundryVersion.trim(), remaster: remaster === "yes", namespace: namespace.trim() } }) }));
      if (id !== session.current) return;
      if (!Array.isArray(data.items)) throw new Error("Preview response did not include candidate items.");
      setPreview(data);
    } catch (e) { if (!controller.signal.aborted && id === session.current) setError(e instanceof Error ? e.message : "Unable to prepare preview."); }
    finally { if (id === session.current) setBusy(false); }
  }

  async function importIds(ids: string[], retry = false) {
    if (paused || !preview || !ids.length || busy) return;
    setBusy(true); setError(""); setReview(true); setProgress(""); stopAfterBatch.current = false; const id = ++session.current, controller = new AbortController(); abort.current = controller; const done: Outcome[] = [...outcomes];
    try {
      for (let offset = 0; offset < ids.length; offset += PAGE) {
        if (id !== session.current || stopAfterBatch.current) break;
        const batch = ids.slice(offset, offset + PAGE); setProgress(`Importing ${Math.min(offset + PAGE, ids.length)} of ${ids.length}…`);
        const signature = JSON.stringify([preview.id, [...batch].sort()]);
        let idempotencyKey = batchKeys.current.get(signature);
        if (!idempotencyKey || retry) { idempotencyKey = crypto.randomUUID(); batchKeys.current.set(signature, idempotencyKey); }
        const data = await responseJson(await fetch(`/api/worlds/${worldId}/foundry/imports`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ previewId: preview.id, candidateIds: batch, idempotencyKey }) }));
        if (data.status !== "completed") throw new Error("Import response did not confirm completion.");
        if (!Array.isArray(data.outcomes)) throw new Error("Import response did not include outcomes.");
        const returnedIds = data.outcomes.map((outcome: Outcome) => outcome?.candidateId);
        if (returnedIds.some((candidateId: unknown) => typeof candidateId !== "string") || new Set(returnedIds).size !== batch.length || batch.some(candidateId => !returnedIds.includes(candidateId))) throw new Error("Import response outcomes did not match the requested batch.");
        const outcomesById = new Map(done.map(outcome => [outcome.candidateId, outcome]));
        for (const outcome of data.outcomes as Outcome[]) outcomesById.set(outcome.candidateId, outcome);
        done.splice(0, done.length, ...outcomesById.values()); setOutcomes([...done]);
        if (stopAfterBatch.current) { setProgress("Stopped future batches. Entries already committed remain imported."); break; }
      }
      if (!stopAfterBatch.current) setProgress("Import complete.");
    } catch (e) { if (!controller.signal.aborted && id === session.current) { setError(e instanceof Error ? e.message : "Import failed."); setProgress(done.length ? "Some entries completed before the error." : ""); } }
    finally { if (id === session.current) { setBusy(false); if (done.some(o => o.status === "created")) { try { await onComplete?.(); } catch { setError("Import completed, but the compendium could not refresh. Reload the workspace to see new entries."); } } } }
  }

  return <>
    <button type="button" onClick={() => { setOpen(true); setError(""); }} className="min-h-11 rounded-lg border border-violet-500/50 px-3 py-2 text-sm font-semibold text-violet-200 hover:bg-violet-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Import from Foundry</button>
    {open && createPortal(<div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-3" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setOpen(false); }}>
      <section inert={paused || undefined} role="dialog" aria-modal="true" aria-labelledby="foundry-title" className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-xl border border-zinc-700 bg-[#1c2028] p-5 font-sans text-zinc-100 shadow-2xl">
        <header className="mb-5 flex justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-widest text-zinc-400">Foundry VTT · selective item import</p><h2 id="foundry-title" className="mt-1 text-2xl font-semibold text-zinc-50">Preview, select, then import</h2><p className="mt-2 max-w-3xl text-sm text-zinc-300">Upload creates a temporary preview only. Nothing enters your compendium until you review and confirm the exact selection. Images, scripts and linked dependencies are not imported.</p></div><button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-50">Close</button></header>
        {!preview && <form onSubmit={upload} className="space-y-4 rounded-xl border border-zinc-800 bg-zinc-950/60 p-4">
          <label className="block text-sm">Foundry Item JSON exports<input ref={fileInput} aria-label="Foundry Item JSON exports" type="file" accept=".json,application/json" multiple onChange={e => { const next = Array.from(e.target.files ?? []); reset(); setFiles(next); }} className={input} /><span className="mt-1 block text-xs text-zinc-500">Exported Item JSON only; arbitrary world ZIP files are not supported.</span></label>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-sm">System<select aria-label="Foundry system" value="pf2e" disabled className={input}><option value="pf2e">Pathfinder 2e (PF2e)</option></select><span className="mt-1 block text-xs text-zinc-500">The first adapter supports PF2e.</span></label>
            <label className="text-sm">PF2e system version<input required value={systemVersion} onChange={e => setSystemVersion(e.target.value)} placeholder="Version shown by your installation" className={input} /></label>
            <label className="text-sm">Foundry version<input required value={foundryVersion} onChange={e => setFoundryVersion(e.target.value)} placeholder="Version shown by your installation" className={input} /></label>
            <label className="text-sm">Rules content<select required value={remaster} onChange={e => setRemaster(e.target.value)} className={input}><option value="">Choose…</option><option value="yes">Remaster</option><option value="no">Legacy</option></select></label>
            <label className="text-sm sm:col-span-2">Source namespace<input required value={namespace} onChange={e => setNamespace(e.target.value)} placeholder="Campaign, world, or compendium identity" className={input} /><span className="mt-1 block text-xs text-zinc-500">Use a stable source label to distinguish entries from separate sources.</span></label>
          </div>
          <p className="text-xs text-amber-200/80">PF2e 8.6.1 Remaster on Foundry 14.369 is a provisional target based on synthetic fixtures. Compatibility awaits validation against real user exports; unsupported entries remain disabled.</p>
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <button disabled={busy || !files.length || !systemVersion.trim() || !foundryVersion.trim() || !namespace.trim() || !remaster} className="min-h-11 rounded-lg bg-violet-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-40">{busy ? "Preparing preview…" : "Preview files"}</button>
        </form>}
        {preview && <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-700 bg-zinc-950/40 p-3 text-sm"><span>{items.length} candidates · Preview expires {new Date(preview.expiresAt).toLocaleString()}</span><button type="button" disabled={busy} onClick={reset} className="min-h-11 rounded-lg px-3 text-violet-200 hover:bg-violet-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Choose another source</button></div>
          {!review ? <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><label className="text-xs text-zinc-400">Search<input className={input} value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="Name, source, type, level, rarity…" /></label><label className="text-xs text-zinc-400">Type<select className={input} value={type} onChange={e => { setType(e.target.value); setPage(0); }}><option value="ALL">All types</option>{types.map(v => <option key={v}>{v}</option>)}</select></label>{sources.length > 0 && <label className="text-xs text-zinc-400">Source<select className={input} value={source} onChange={e => { setSource(e.target.value); setPage(0); }}><option value="ALL">All sources</option>{sources.map(v => <option key={v}>{v}</option>)}</select></label>}<div className="flex flex-wrap items-end gap-2"><button type="button" onClick={() => setSelected(current => [...new Set([...current, ...visible.filter(i => i.supported).map(i => i.id)])])} className="min-h-11 rounded border border-zinc-700 px-3 text-xs hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Select page</button><button type="button" onClick={() => setSelected(current => [...new Set([...current, ...filtered.filter(i => i.supported).map(i => i.id)])])} className="min-h-11 rounded border border-zinc-700 px-3 text-xs hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Select all matching ({filtered.filter(i => i.supported).length})</button><button type="button" onClick={() => setSelected([])} className="min-h-11 rounded border border-zinc-700 px-3 text-xs hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Clear all</button></div></div>
            <p role="status" className="text-sm text-zinc-300">{selected.length} selected across pages and filters · {filtered.length} matching results</p>
            <div className="overflow-x-auto rounded-lg border border-zinc-700"><table className="w-full text-left text-sm"><thead className="bg-zinc-950 text-xs uppercase text-zinc-400"><tr>{["Select", "Name", "Source", "Type", "Level", "Rarity", "Status"].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{visible.map(item => <tr key={item.id} className="border-t border-zinc-800"><td className="p-3"><input aria-label={`Select ${item.name}`} type="checkbox" checked={selected.includes(item.id)} disabled={!item.supported || busy} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, item.id])] : current.filter(id => id !== item.id))} /></td><td className="p-3"><button type="button" onClick={() => setDetail(item)} className="text-left text-violet-200 hover:text-violet-100 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{item.name}</button></td><td className="p-3">{item.source || "—"}</td><td className="p-3">{item.type}</td><td className="p-3">{item.level ?? "—"}</td><td className="p-3">{item.rarity || "—"}</td><td className="p-3">{!item.supported ? <span className="text-red-300">Unsupported</span> : item.status ? <span className="text-amber-300">{item.status}{item.destinationEdited ? " · local edits" : ""}{item.warnings.length ? ` · ${item.warnings.length} warning${item.warnings.length === 1 ? "" : "s"}` : ""}</span> : item.warnings.length ? <span className="text-amber-300">Warnings</span> : <span className="text-emerald-300">Ready</span>}</td></tr>)}</tbody></table>{!visible.length && <p className="p-6 text-sm text-zinc-400">No matching candidates.</p>}</div>
            <div className="flex justify-between"><button type="button" disabled={!page} onClick={() => setPage(p => p - 1)} className="min-h-11 rounded border border-zinc-700 px-3 text-sm hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40">Previous</button><span className="self-center text-xs text-zinc-400">Page {page + 1} of {Math.max(1, Math.ceil(filtered.length / PAGE))}</span><button type="button" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(p => p + 1)} className="min-h-11 rounded border border-zinc-700 px-3 text-sm hover:border-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 disabled:opacity-40">Next</button></div>
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex justify-end"><button type="button" disabled={!selected.length} onClick={() => setReview(true)} className="min-h-11 rounded-lg bg-violet-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-40">Review selection ({selected.length})</button></div>
          </> : <div className="space-y-3 rounded-xl border border-zinc-700 bg-zinc-950/50 p-4"><h3 className="text-xl font-semibold text-zinc-100">Review exact selection</h3><p className="text-sm text-zinc-300">{chosen.length} selected · {supported.length} supported. Confirming creates only these entries. No dependencies or images are included.</p><ul className="max-h-64 space-y-1 overflow-y-auto text-sm">{chosen.map(i => <li key={i.id} className="flex justify-between"><span>{i.name} · {i.category || i.type}</span><span className={i.supported ? "text-emerald-300" : "text-red-300"}>{i.supported ? "Ready" : "Unsupported"}</span></li>)}</ul>
            {progress && <p role="status" className="text-sm text-amber-200">{progress}</p>}{outcomes.length > 0 && <p className="text-sm">Created {outcomes.filter(o => o.status === "created").length} · Skipped {outcomes.filter(o => o.status === "skipped").length} · Failed {outcomes.filter(o => o.status === "failed").length}</p>}
            {outcomes.length > 0 && <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">{outcomes.map(o => <li key={o.candidateId} className={o.status === "failed" ? "text-red-300" : "text-zinc-300"}>{items.find(i => i.id === o.candidateId)?.name || o.candidateId}: {o.status}{o.reason ? ` · ${o.reason}` : ""}{o.blockId && onOpenBlock ? <> · <button type="button" onClick={() => { onOpenBlock(o.blockId!); setOpen(false); }} className="text-violet-200 underline hover:text-violet-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">View entry</button></> : o.blockId ? ` · block ${o.blockId}` : ""}</li>)}</ul>}
            {outcomes.some(o => o.status === "failed") && <div><button type="button" disabled={busy} onClick={() => importIds(outcomes.filter(o => o.status === "failed").map(o => o.candidateId), true)} className="mt-2 rounded border border-red-800 px-3 py-2 text-xs">Retry failed only</button></div>}
            {error && <p role="alert" className="text-sm text-red-300">{error}</p>}<div className="flex justify-end gap-2">{busy && <button type="button" onClick={() => { stopAfterBatch.current = true; setProgress("Stopping after the current batch…"); }} className="min-h-11 rounded border border-zinc-700 px-4 py-2">Cancel remaining batches</button>}<button type="button" disabled={busy} onClick={() => setReview(false)} className="min-h-11 rounded border border-zinc-700 px-4 py-2">Back</button><button type="button" disabled={busy || !supported.length} onClick={() => importIds(supported.map(i => i.id))} className="min-h-11 rounded-lg bg-violet-400 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:opacity-40">{busy ? "Importing…" : `Import ${supported.length} selected item${supported.length === 1 ? "" : "s"}`}</button></div>
          </div>}
        </div>}
        {detail && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-3" onMouseDown={e => { if (e.target === e.currentTarget) setDetail(null); }}><section role="dialog" aria-modal="true" aria-label={`Preview ${detail.name}`} className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-700 bg-[#1c2028] p-5 font-sans text-zinc-100 shadow-2xl"><div className="flex justify-between gap-4"><div className="min-w-0"><h3 className="break-words text-xl font-semibold">{detail.name}</h3><p className="text-sm text-zinc-400">{detail.type} → {detail.category || "No destination category"}</p></div><button type="button" onClick={() => setDetail(null)} className="min-h-11 shrink-0 rounded-lg px-3 text-sm text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">Close</button></div><p className="mt-4 text-xs font-semibold uppercase tracking-wider text-violet-200">Mapped fields</p><dl className="mt-2 space-y-2">{Object.entries(detail.stats).map(([key, value]) => <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2"><dt className="text-xs text-zinc-400">{key}</dt><dd className="whitespace-pre-wrap break-words text-sm">{typeof value === "string" || typeof value === "number" ? String(value) : JSON.stringify(value, null, 2)}</dd></div>)}</dl>{detail.warnings.length > 0 && <div className="mt-4 rounded-lg border border-amber-800/70 bg-amber-950/20 p-3"><h4 className="text-sm font-semibold text-amber-200">Conversion warnings</h4><ul className="list-inside list-disc text-sm text-amber-100">{detail.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}</section></div>}
      </section>
    </div>, document.body)}
  </>;
}
