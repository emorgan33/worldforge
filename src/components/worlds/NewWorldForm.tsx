"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { RPG_SYSTEMS } from "@/lib/rpg";
import type { WorldSummary } from "@/components/WorldHome";
import { clearWorldCreationRecovery, readWorldCreationRecovery, sameWorldCreationPayload, writeWorldCreationRecovery, type WorldCreationPayload, type WorldCreationRecovery } from "@/lib/world-creation-recovery";

type Payload = WorldCreationPayload;
type Recovery = WorldCreationRecovery<WorldSummary>;
const MAX_DESCRIPTION = 10000;
const normalize = (value: Omit<Payload, "requestId">): Omit<Payload, "requestId"> => ({
  title: value.title.trim().replace(/\s+/g, " "),
  description: value.description.trim(),
  system: value.system,
});

export function NewWorldForm({ actorId, defaultSystem = "DND_5E", onClose, beforeCreate, onCreated, onBusyChange }: {
  actorId: string;
  defaultSystem?: string;
  onClose: () => void;
  beforeCreate: () => boolean | Promise<boolean>;
  onCreated: (world: WorldSummary) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [system, setSystem] = useState(defaultSystem);
  const [pending, setPending] = useState<Payload | null>(null);
  const [confirmed, setConfirmed] = useState<Recovery["confirmed"]>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [storageAvailable, setStorageAvailable] = useState(true);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const { recovery, storageAvailable: storageOk } = readWorldCreationRecovery<WorldSummary>(actorId);
      setPending(recovery.pending ?? null);
      setConfirmed(recovery.confirmed);
      setStorageAvailable(storageOk);
      if (recovery.pending) {
        setTitle(recovery.pending.title); setDescription(recovery.pending.description); setSystem(recovery.pending.system);
        setNotice("An earlier creation may still be processing. Retry it to reconcile the result.");
      } else if (recovery.confirmed) setNotice("World created; retry opening.");
      setMounted(true);
    }, 0);
    return () => { window.clearTimeout(timer); previousFocus.current?.focus(); };
  }, [actorId]);

  useEffect(() => {
    if (!mounted) return;
    const element = dialogRef.current;
    if (element && !element.open) element.showModal();
    titleRef.current?.focus();
  }, [mounted]);

  const persist = useCallback((next: { pending?: Payload; confirmed?: Recovery["confirmed"] }) => {
    setStorageAvailable(writeWorldCreationRecovery(actorId, next));
  }, [actorId]);

  function setBusyState(value: boolean) { setBusy(value); onBusyChange?.(value); }
  function close() { if (!busy) onClose(); }

  async function openConfirmed(value = confirmed) {
    if (!value) return;
    setBusyState(true); setError("");
    try {
      if (!await beforeCreate()) return;
      await onCreated(value.world);
      setStorageAvailable(clearWorldCreationRecovery(actorId));
    } catch (reason) {
      setError(reason instanceof Error ? `World created, but opening failed: ${reason.message}` : "World created, but opening failed. Retry opening.");
      setNotice("World created; retry opening.");
    } finally { setBusyState(false); }
  }

  async function post(payload: Payload) {
    setBusyState(true); setError(""); setNotice("Creation may continue on the server if this dialog closes after the request completes.");
    let outcomeUncertain = true;
    try {
      const response = await fetch("/api/worlds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json().catch(() => null) as (WorldSummary & { error?: string }) | null;
      if (!response.ok) {
        if (response.status >= 500 || response.status === 408 || response.status === 429) throw new Error(result?.error || "The result is uncertain. Retry to reconcile this request.");
        outcomeUncertain = false;
        setPending(null); persist({});
        throw new Error(result?.error || "Could not create world.");
      }
      if (!result || typeof result.id !== "string") throw new Error("The result is uncertain. Retry to reconcile this request.");
      const success = { world: result, payload };
      setConfirmed(success); setPending(null); persist({ confirmed: success }); setNotice("World created; opening it now.");
      await openConfirmed(success);
    } catch (reason) {
      if (outcomeUncertain) { setPending(payload); persist({ pending: payload }); }
      setError(reason instanceof Error ? reason.message : "Could not confirm whether the world was created. Retry the same request to reconcile it.");
      if (!storageAvailable) setNotice("Recovery lasts only for this page lifetime. Check your authorized world list before starting another creation.");
    } finally { setBusyState(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    if (busy) return;
    const normalized = normalize({ title, description, system });
    if (!normalized.title || normalized.title.length > 200) { setError("Enter a title between 1 and 200 characters."); return; }
    if (normalized.description.length > MAX_DESCRIPTION) { setError("Description must be 10,000 characters or fewer."); return; }
    if (!RPG_SYSTEMS.some(option => option.id === normalized.system)) { setError("Choose a supported rules system."); return; }
    if (confirmed) { await openConfirmed(); return; }
    if (pending) {
      if (!sameWorldCreationPayload(pending, normalized)) {
        setError("Reconcile the earlier request before creating a world with these changed details."); return;
      }
      if (!await allowCreate()) return;
      await post(pending); return;
    }
    if (!await allowCreate()) return;
    const payload: Payload = { ...normalized, requestId: crypto.randomUUID() };
    setPending(payload); persist({ pending: payload });
    await post(payload);
  }

  async function allowCreate() {
    setBusyState(true); setError("");
    try { return await beforeCreate(); } catch { return false; }
    finally { setBusyState(false); }
  }

  async function reconcile() { if (pending && !busy && await allowCreate()) await post(pending); }
  function trapFocus(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === "Escape") { if (busy) event.preventDefault(); else close(); return; }
    if (event.key !== "Tab") return;
    const items = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]') ?? [])];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  if (!mounted) return null;
  return createPortal(<dialog ref={dialogRef} aria-labelledby="new-world-title" onKeyDown={trapFocus} onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget && !busy) close(); }} className="m-auto max-h-[90vh] w-[min(36rem,94vw)] overflow-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-6 text-zinc-100 shadow-2xl backdrop:bg-black/75">
    <header className="mb-5 flex items-start justify-between gap-4"><div><p className="text-xs uppercase tracking-widest text-amber-400">Private campaign</p><h2 id="new-world-title" className="mt-1 font-serif text-2xl text-amber-100">Create a new world</h2></div><button type="button" disabled={busy} onClick={close} aria-label="Close new world form" className="rounded-lg border border-zinc-700 px-3 py-2 text-sm disabled:opacity-50">Close</button></header>
    <p className="mb-5 text-sm text-zinc-300">New worlds start private and empty. You can add articles and content after opening the world.</p>
    {notice && <p role="status" className="mb-3 text-sm text-amber-200">{notice}</p>}
    {!storageAvailable && <p className="mb-3 rounded border border-amber-800 p-3 text-xs text-amber-200">Browser session storage is unavailable. Recovery lasts only for this page lifetime; check your authorized world list if a request has an uncertain result.</p>}
    <form onSubmit={submit} onClick={event => event.stopPropagation()} className="space-y-4">
      <label className="block text-sm">World title<input ref={titleRef} required minLength={1} maxLength={200} disabled={busy} value={title} onChange={event => setTitle(event.target.value)} autoComplete="off" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none disabled:opacity-50" /></label>
      <label className="block text-sm">Rules system<select disabled={busy} value={system} onChange={event => setSystem(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none disabled:opacity-50">{RPG_SYSTEMS.map(option => <option key={option.id} value={option.id}>{option.id === "PF_2E" ? "Pathfinder 2e Remaster" : option.id === "DND_5E" ? "D&D 5e 2014" : option.label}</option>)}</select></label>
      <label className="block text-sm">Description <span className="text-zinc-500">(optional)</span><textarea disabled={busy} rows={4} maxLength={MAX_DESCRIPTION} value={description} onChange={event => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-zinc-100 focus:border-amber-500 focus:outline-none disabled:opacity-50" /></label>
      {error && <p role="alert" className="rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {pending && !confirmed && <div className="space-y-2"><p className="text-xs text-zinc-400">This request may already have created a world. Reconcile it before starting a distinct creation.</p><button type="button" onClick={reconcile} disabled={busy} className="rounded-lg border border-amber-700/70 px-3 py-2 text-xs text-amber-200 disabled:opacity-50">Reconcile earlier request</button></div>}
      {confirmed && <p className="text-xs text-zinc-300">The world is already created. Retry opening it without sending another creation request.</p>}
      <footer className="flex justify-end gap-3 border-t border-zinc-800 pt-4"><button type="button" disabled={busy} onClick={close} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200 disabled:opacity-50">Cancel</button><button type="submit" disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-amber-500 disabled:opacity-50">{busy ? "Working…" : confirmed ? "Retry opening" : pending ? "Reconcile creation" : "Create world"}</button></footer>
  </form>
  </dialog>, document.body);
}
