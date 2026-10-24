"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { WorldSummary } from "@/components/WorldHome";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

type DeletedWorld = Pick<WorldSummary, "id" | "slug" | "title" | "system" | "description"> & { deletedAt?: string | null };
type ManagementAction = "archive" | "duplicate" | "restore" | "purge" | "export" | "import";
const pendingImports = new Map<string, string>();
const pendingDuplicates = new Map<string, string>();
const importKey = (actorId: string) => `worldforge:pending-import:${actorId}`;
const duplicateKey = (actorId: string, worldId: string) => `worldforge:pending-duplicate:${actorId}:${worldId}`;
function readPendingImport(actorId: string | null) {
  if (!actorId) return null;
  const inMemory = pendingImports.get(actorId);
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try { return sessionStorage.getItem(importKey(actorId)); } catch { return null; }
}

export function WorldManagement({ worlds, currentWorldId, actorId, onClose, onRefresh, onBeforeAction, onActionComplete }: {
  worlds: WorldSummary[];
  currentWorldId: string | null;
  actorId: string | null;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
  onBeforeAction: () => boolean;
  onActionComplete: (action: ManagementAction, worldId?: string, summary?: WorldSummary) => void;
}) {
  const [deleted, setDeleted] = useState<DeletedWorld[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [pendingImportId, setPendingImportId] = useState<string | null>(() => readPendingImport(actorId));
  const duplicateRequests = useRef(new Map<string, string>());
  const [completedActions, setCompletedActions] = useState<ReadonlySet<string>>(new Set());
  const closeButton = useRef<HTMLButtonElement>(null);
  useWorldGuard({ dirty: false, busy: !!busy }, "world-management");

  function rememberImport(id: string) {
    if (actorId) {
      pendingImports.set(actorId, id);
      try { sessionStorage.setItem(importKey(actorId), id); } catch { /* in-memory recovery remains */ }
    }
    setPendingImportId(id);
  }
  function clearImport() {
    if (actorId) {
      pendingImports.delete(actorId);
      try { sessionStorage.removeItem(importKey(actorId)); } catch { /* storage unavailable */ }
    }
    setPendingImportId(null);
  }
  function duplicateRequestId(worldId: string) {
    const key = actorId ? duplicateKey(actorId, worldId) : null;
    let id = duplicateRequests.current.get(worldId) ?? (key ? pendingDuplicates.get(key) : undefined);
    if (!id && key) { try { id = sessionStorage.getItem(key) ?? undefined; } catch { /* in-memory retry remains */ } }
    if (!id) id = crypto.randomUUID();
    duplicateRequests.current.set(worldId, id);
    if (key) { pendingDuplicates.set(key, id); try { sessionStorage.setItem(key, id); } catch { /* in-memory retry remains */ } }
    return id;
  }
  function clearDuplicateRequest(worldId: string) {
    if (actorId) {
      const key = duplicateKey(actorId, worldId);
      pendingDuplicates.delete(key);
      try { sessionStorage.removeItem(key); } catch { /* storage unavailable */ }
    }
    duplicateRequests.current.delete(worldId);
  }

  function trapFocus(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const items = [...(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))];
    if (!items.length) return;
    const first = items[0]; const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  async function refreshDeleted() {
    const response = await fetch("/api/worlds/deleted");
    if (!response.ok) throw new Error(response.status === 401 ? "Sign in again to manage worlds." : "Could not load archived worlds.");
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || !Array.isArray((body as { worlds?: unknown }).worlds)) throw new Error("Archived-world response was invalid.");
    setDeleted((body as { worlds: DeletedWorld[] }).worlds);
  }

  useEffect(() => {
    const task = window.setTimeout(() => { void refreshDeleted().catch(reason => setError(reason instanceof Error ? reason.message : "Could not load archived worlds.")); }, 0);
    return () => window.clearTimeout(task);
  }, []);

  useEffect(() => {
    closeButton.current?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent) { if (event.key === "Escape" && !busy) onClose(); }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function perform(label: string, action: ManagementAction, worldId: string | undefined, task: () => Promise<WorldSummary | void>) {
    setError(""); setStatus("");
    if (action !== "export" && !onBeforeAction()) return;
    setBusy(label);
    try {
      const summary = await task();
      if (action !== "export") setCompletedActions(previous => new Set(previous).add(`${action}:${worldId ?? ""}`));
      onActionComplete(action, worldId, summary || undefined);
      setStatus(`${label} complete.`);
      try {
        await Promise.all([Promise.resolve(onRefresh()), refreshDeleted()]);
        setCompletedActions(new Set());
        if (action === "duplicate" && worldId) clearDuplicateRequest(worldId);
        if (action === "import") clearImport();
      } catch {
        setError(`${label} completed, but the world lists could not be refreshed. Retry the refresh; the action will not be repeated.`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${label} failed. Try again.`);
    } finally { setBusy(""); }
  }

  async function refreshLists() {
    setError(""); setStatus(""); setBusy("Refresh lists");
    try {
      if (pendingImportId) {
        const response = await fetch("/api/worlds");
        const list: unknown = response.ok ? await response.json() : null;
        if (!Array.isArray(list) || !list.some(item => item && typeof item === "object" && (item as { id?: unknown }).id === pendingImportId)) throw new Error("Import already completed. Retry after the imported world appears in your list.");
      }
      await Promise.all([Promise.resolve(onRefresh()), refreshDeleted()]);
      setCompletedActions(new Set()); clearImport();
      setStatus("World lists refreshed.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh world lists."); }
    finally { setBusy(""); }
  }

  async function jsonMutation(url: string, method: string, body?: unknown) {
    const response = await fetch(url, { method, ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
    const result: unknown = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "World action failed.");
    return result as Record<string, unknown>;
  }

  function archive(world: WorldSummary) {
    if (!window.confirm(`Archive “${world.title}”? You can restore it from Archived worlds.`)) return;
    void perform("Archive", "archive", world.id, async () => { await jsonMutation(`/api/worlds/${world.id}`, "DELETE"); });
  }
  function duplicate(world: WorldSummary) {
    void perform("Duplicate", "duplicate", world.id, async () => {
      const requestId = duplicateRequestId(world.id);
      const result = await jsonMutation(`/api/worlds/${world.id}/duplicate`, "POST", { requestId });
      return result as unknown as WorldSummary;
    });
  }
  function restore(world: DeletedWorld) {
    void perform("Restore", "restore", world.id, async () => { await jsonMutation(`/api/worlds/${world.id}/restore`, "POST"); });
  }
  function purge(world: DeletedWorld) {
    const confirmation = window.prompt(`Permanently erase “${world.title}” and its content? Type PURGE to confirm.`);
    if (confirmation !== "PURGE") return;
    void perform("Purge", "purge", world.id, async () => { await jsonMutation(`/api/worlds/${world.id}/purge`, "POST"); });
  }
  function exportWorld(world: WorldSummary) {
    void perform("Export", "export", world.id, async () => {
      const response = await fetch(`/api/worlds/${world.id}/export`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body && typeof body.error === "string" ? body.error : "World export failed.");
      }
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const anchor = document.createElement("a"); anchor.href = href; anchor.download = `${world.slug}-export.json`; anchor.click();
      URL.revokeObjectURL(href);
    });
  }
  function importWorld() {
    if (pendingImportId) {
      void perform("Refresh imported world", "import", undefined, async () => {
        const response = await fetch("/api/worlds");
        if (!response.ok) throw new Error("Import already completed. World list refresh failed; retry to finish without importing again.");
        const list: unknown = await response.json();
        if (!Array.isArray(list)) throw new Error("World list response was invalid.");
        const summary = (list as WorldSummary[]).find(item => item.id === pendingImportId);
        if (!summary) throw new Error("Import already completed. The world is not visible in the active list yet; retry refresh.");
        return summary;
      });
      return;
    }
    if (!importFile) { setError("Choose a JSON world backup to import."); return; }
    void perform("Import", "import", undefined, async () => {
      let bundle: unknown;
      try { bundle = JSON.parse(await importFile.text()); } catch { throw new Error("That file is not valid JSON."); }
      const result = await jsonMutation("/api/worlds/import", "POST", bundle);
      if (typeof result.worldId !== "string") throw new Error("The import response did not include a world ID.");
      rememberImport(result.worldId);
      const response = await fetch("/api/worlds");
      if (!response.ok) throw new Error("Import completed, but the world list refresh failed. Retry to refresh without importing again.");
      const list: unknown = await response.json();
      if (!Array.isArray(list)) throw new Error("World list response was invalid.");
      const summary = (list as WorldSummary[]).find(item => item.id === result.worldId);
      if (!summary) throw new Error("Import completed, but the new world is not visible yet. Retry to refresh without importing again.");
      return summary;
    });
  }

  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section role="dialog" aria-modal="true" aria-labelledby="world-management-title" onKeyDown={trapFocus} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl">
      <header className="flex items-center justify-between border-b border-zinc-800 p-5"><div><h2 id="world-management-title" className="text-lg font-semibold">Manage worlds</h2><p className="mt-1 text-xs text-zinc-400">Copies contain world settings only. Export a backup to copy campaign content.</p></div><button ref={closeButton} type="button" onClick={onClose} disabled={!!busy} aria-label="Close world management" className="rounded px-2 py-1 text-zinc-400 hover:bg-zinc-800">✕</button></header>
      <div className="min-h-0 space-y-6 overflow-y-auto p-5">
        {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}{status && <p role="status" className="text-sm text-emerald-300">{status}</p>}
        <section><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">Active worlds</h3><button type="button" disabled={!!busy} onClick={() => void refreshLists()} className="text-xs text-indigo-300 underline disabled:opacity-50">Refresh lists</button></div><div className="space-y-2">{worlds.map(world => <div key={world.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{world.title}{world.id === currentWorldId && <span className="ml-2 text-xs text-amber-300">Current</span>}</p><p className="text-xs text-zinc-500">{world.system}</p></div><button type="button" disabled={!!busy} onClick={() => exportWorld(world)} className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">Export</button><button type="button" disabled={!!busy || completedActions.has(`duplicate:${world.id}`)} onClick={() => duplicate(world)} className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">{completedActions.has(`duplicate:${world.id}`) ? "Copied" : "Duplicate settings"}</button><button type="button" disabled={!!busy || completedActions.has(`archive:${world.id}`)} onClick={() => archive(world)} className="rounded border border-zinc-700 px-2 py-1 text-xs text-amber-300 hover:bg-zinc-800">{completedActions.has(`archive:${world.id}`) ? "Archived" : "Archive"}</button></div>)}{!worlds.length && <p className="text-sm text-zinc-500">No active worlds.</p>}</div></section>
        <section><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Archived worlds</h3><div className="space-y-2">{deleted.map(world => <div key={world.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{world.title}</p><p className="text-xs text-zinc-500">{world.system}{world.deletedAt ? ` · archived ${new Date(world.deletedAt).toLocaleDateString()}` : ""}</p></div><button type="button" disabled={!!busy || completedActions.has(`restore:${world.id}`)} onClick={() => restore(world)} className="rounded border border-zinc-700 px-2 py-1 text-xs hover:bg-zinc-800">{completedActions.has(`restore:${world.id}`) ? "Restored" : "Restore"}</button><button type="button" disabled={!!busy || completedActions.has(`purge:${world.id}`)} onClick={() => purge(world)} className="rounded border border-red-900 px-2 py-1 text-xs text-red-300 hover:bg-red-950">{completedActions.has(`purge:${world.id}`) ? "Erased" : "Permanently erase"}</button></div>)}{!deleted.length && <p className="text-sm text-zinc-500">No archived worlds.</p>}</div></section>
        <section className="border-t border-zinc-800 pt-4"><h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-zinc-400">Import a world backup</h3><div className="flex flex-wrap items-center gap-2"><input type="file" accept="application/json,.json" disabled={!!busy || !!pendingImportId} onChange={event => setImportFile(event.target.files?.[0] ?? null)} className="min-w-0 flex-1 text-xs text-zinc-400 file:mr-3 file:rounded file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-zinc-200"/><button type="button" disabled={!!busy} onClick={importWorld} className="rounded bg-amber-600 px-3 py-2 text-xs font-semibold text-zinc-950 disabled:opacity-50">{pendingImportId ? "Refresh imported world" : "Import backup"}</button></div></section>
      </div>
      {busy && <p role="status" className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-400">{busy}…</p>}
    </section>
  </div>;
}
