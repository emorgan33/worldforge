"use client";
import { useState } from "react";
import type { ImageAssetItem } from "@/lib/assets";
import { AssetPicker } from "./AssetPicker";
import type { StockArtPurpose } from "./StockArtBrowser";

export function ImageSourceField({ worldId, label, name, value, onChange, onAssetSelected, purpose }: {
  worldId?: string; label: string; name?: string; value: string; onChange: (value: string) => void; onAssetSelected?: (asset: ImageAssetItem) => void; purpose?: StockArtPurpose;
}) {
  const [open, setOpen] = useState(false);
  return <div className="space-y-2"><label className="block text-xs text-app-text-dim">{label}<input aria-label={label} name={name} type="text" inputMode="url" value={value} onChange={event => onChange(event.target.value)} maxLength={2048} placeholder="https://… or choose from the library" className="mt-1 w-full rounded-lg border border-app-border-strong bg-app-canvas px-3 py-2 text-sm text-app-text" /></label>
    {worldId && <button type="button" aria-label={`Browse images for ${label}`} onClick={() => setOpen(true)} className="rounded-lg border border-secondary-700/60 px-3 py-2 text-xs text-secondary-300">Browse or upload image</button>}
    {value && <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange("")} className="ml-3 text-xs text-app-muted">Clear</button>}
    {open && worldId && <AssetPicker worldId={worldId} purpose={purpose} onClose={() => setOpen(false)} onSelect={asset => { onChange(asset.url); onAssetSelected?.(asset); }} />}
  </div>;
}
