"use client";
import { WorldGuardProvider, useWorldGuard } from "@/components/worlds/WorldGuard";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageAssetItem } from "@/lib/assets";
import { applyRegistration, type GuardRegistry, type GuardRegistration } from "@/lib/navigation-guard";
import { AssetLibrary } from "./AssetLibrary";

export function AssetPicker({ worldId, onSelect, onClose }: { worldId: string; onSelect: (asset: ImageAssetItem) => void; onClose: () => void }) {
  const [guards, setGuards] = useState<GuardRegistry>(new Map());
  const register = useCallback((id: string, registration: GuardRegistration) => setGuards(previous => applyRegistration(previous, id, registration)), []);
  const busy = [...guards.values()].some(guard => guard.busy);
  const dirty = [...guards.values()].some(guard => guard.dirty);
  const paused = useWorldGuard({ dirty, busy }, "asset");
  const close = () => { if (busy || paused) return; if (dirty && !window.confirm("Discard unsaved image changes?")) return; onClose(); };
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return createPortal(<dialog inert={paused || undefined} ref={dialog} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()} onChange={event => event.stopPropagation()} aria-labelledby="asset-picker-heading" onCancel={event => { event.preventDefault(); close(); }} className="m-auto max-h-[90vh] w-[min(1000px,95vw)] overflow-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-5 text-zinc-100 shadow-2xl backdrop:bg-black/75" onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <div className="mb-5 flex items-center justify-between"><h2 id="asset-picker-heading" className="text-lg font-bold">Choose an image</h2><button type="button" autoFocus aria-label="Close image library" disabled={busy || paused} onClick={close} className="rounded-lg border border-zinc-700 px-3 py-2 text-sm">Close</button></div>
    <WorldGuardProvider onGuardChange={register} paused={paused}><AssetLibrary worldId={worldId} onSelect={asset => { if (busy || paused) return; if (dirty && !window.confirm("Discard unsaved image changes?")) return; onSelect(asset); onClose(); }} /></WorldGuardProvider>
  </dialog>, document.body);
}
