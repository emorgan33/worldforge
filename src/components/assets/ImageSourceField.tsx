"use client";
import { useState } from "react";
import type { ImageAssetItem } from "@/lib/assets";
import { AssetPicker } from "./AssetPicker";

export function ImageSourceField({ worldId, label, name, value, onChange, onAssetSelected }: {
  worldId?: string; label: string; name?: string; value: string; onChange: (value: string) => void; onAssetSelected?: (asset: ImageAssetItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return <div className="space-y-2"><label className="block text-xs text-zinc-300">{label}<input aria-label={label} name={name} type="text" inputMode="url" value={value} onChange={event => onChange(event.target.value)} maxLength={2048} placeholder="https://… or choose from the library" className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200" /></label>
    {worldId && <button type="button" aria-label={`Browse images for ${label}`} onClick={() => setOpen(true)} className="rounded-lg border border-indigo-700/60 px-3 py-2 text-xs text-indigo-300">Browse or upload image</button>}
    {value && <button type="button" aria-label={`Clear ${label}`} onClick={() => onChange("")} className="ml-3 text-xs text-zinc-400">Clear</button>}
    {open && worldId && <AssetPicker worldId={worldId} onClose={() => setOpen(false)} onSelect={asset => { onChange(asset.url); onAssetSelected?.(asset); }} />}
  </div>;
}
