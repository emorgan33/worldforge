"use client";
import { WorldGuardProvider, useWorldGuard } from "@/components/worlds/WorldGuard";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ImageAssetItem } from "@/lib/assets";
import { applyRegistration, type GuardRegistry, type GuardRegistration } from "@/lib/navigation-guard";
import { AssetLibrary } from "./AssetLibrary";
import { StockArtBrowser, type StockArtPurpose } from "./StockArtBrowser";

export function AssetPicker({ worldId, purpose, onSelect, onClose }: { worldId: string; purpose?: StockArtPurpose; onSelect: (asset: ImageAssetItem) => void; onClose: () => void }) {
  const [guards, setGuards] = useState<GuardRegistry>(new Map());
  const [source, setSource] = useState<"world" | "stock">("world");
  const register = useCallback((id: string, registration: GuardRegistration) => setGuards(previous => applyRegistration(previous, id, registration)), []);
  const registerLibraryGuard = useCallback((registration: GuardRegistration) => register("asset-library", registration), [register]);
  const busy = [...guards.values()].some(guard => guard.busy);
  const dirty = [...guards.values()].some(guard => guard.dirty);
  const paused = useWorldGuard({ dirty, busy }, "asset");
  const close = () => { if (busy || paused) return; if (dirty && !window.confirm("Discard unsaved image changes?")) return; onClose(); };
  const switchSource = (next: "world" | "stock") => {
    if (next === source || busy || paused) return;
    if (dirty && !window.confirm("Discard unsaved image changes?")) return;
    setSource(next);
  };
  /* The stock inspector reports its own in-flight selection as busy, so a
     successful commit must not be blocked by that same registration. Buttons
     are disabled while busy; only a paused world transition blocks here. */
  const commit = (asset: ImageAssetItem) => {
    if (paused) return;
    if (dirty && !window.confirm("Discard unsaved image changes?")) return;
    onSelect(asset); onClose();
  };
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return createPortal(<dialog inert={paused || undefined} ref={dialog} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onSubmit={event => event.stopPropagation()} onChange={event => event.stopPropagation()} aria-labelledby="asset-picker-heading" onCancel={event => { event.preventDefault(); close(); }} className="m-auto max-h-[92vh] w-[min(1120px,96vw)] overflow-auto rounded-2xl border border-app-border-strong bg-app-canvas p-4 text-app-text-strong shadow-2xl backdrop:bg-app-scrim sm:p-5" onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close(); } }}>
    <div className="mb-3 flex items-center justify-between gap-3"><h2 id="asset-picker-heading" className="text-lg font-bold">Choose an image</h2><button type="button" aria-label="Close image library" disabled={busy || paused} onClick={close} className="min-h-11 rounded-lg border border-app-border-strong px-3 py-2 text-sm">Close</button></div>
    <WorldGuardProvider onGuardChange={register} paused={paused}>
      <div role="tablist" aria-label="Image sources" onKeyDown={event => { if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return; event.preventDefault(); const next = source === "world" ? "stock" : "world"; if (busy || paused) return; if (dirty && !window.confirm("Discard unsaved image changes?")) return; setSource(next); const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'); tabs[next === "world" ? 0 : 1]?.focus(); }} className="mb-4 flex gap-1 rounded-lg border border-app-border bg-app-surface p-1">
        <button type="button" role="tab" aria-selected={source === "world"} onClick={() => switchSource("world")} className={`min-h-11 rounded-md px-4 text-sm font-semibold ${source === "world" ? "bg-highlight-500/20 text-highlight-200" : "text-app-muted hover:text-app-text"}`}>World images</button>
        <button type="button" role="tab" aria-selected={source === "stock"} onClick={() => switchSource("stock")} className={`min-h-11 rounded-md px-4 text-sm font-semibold ${source === "stock" ? "bg-highlight-500/20 text-highlight-200" : "text-app-muted hover:text-app-text"}`}>Stock art</button>
      </div>
      {source === "world" ? <AssetLibrary worldId={worldId} onSelect={commit} onGuardChange={registerLibraryGuard} /> : <StockArtBrowser worldId={worldId} purpose={purpose} onUse={(asset) => commit(asset)} onBrowseWorldImages={() => switchSource("world")} />}
    </WorldGuardProvider>
  </dialog>, document.body);
}
