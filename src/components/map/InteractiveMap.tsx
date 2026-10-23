"use client";
/* Map images are stored assets or remote URLs, not Next-optimized files. */
/* eslint-disable @next/next/no-img-element */

import { useWorldGuard } from "@/components/worlds/WorldGuard";
import { AssetLibrary } from "@/components/assets/AssetLibrary";
import type { ImageAssetItem } from "@/lib/assets";
import type { GuardRegistration } from "@/lib/navigation-guard";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Castle,
  ChevronDown,
  ChevronUp,
  Circle,
  Crown,
  Eraser,
  ExternalLink,
  Eye,
  EyeOff,
  Flag,
  Footprints,
  Gem,
  Home,
  Layers,
  MapPin,
  Maximize2,
  Minus,
  MousePointer2,
  PenLine,
  Plus,
  Skull,
  Square,
  Star,
  Trash2,
  TreePine,
  Type,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

export interface MapLayerData {
  id: string;
  mapId: string;
  name: string;
  order: number;
  isVisible: boolean;
  imageUrl?: string | null;
}

export interface MapMarkerArticle {
  id: string;
  title: string;
  template: string;
  excerpt?: string | null;
  portraitImage?: string | null;
}

export interface MapMarkerData {
  id: string;
  mapId: string;
  layerId?: string | null;
  groupId?: string | null;
  title: string;
  description?: string | null;
  x: number;
  y: number;
  icon?: string | null;
  color?: string | null;
  article?: MapMarkerArticle | null;
}

export interface MapElementData {
  id: string;
  mapId: string;
  layerId?: string | null;
  kind: string;
  geometry: string;
  style?: string | null;
}

export interface MapData {
  id: string;
  worldId: string;
  title: string;
  description?: string | null;
  imageUrl: string;
  width: number;
  height: number;
  defaultZoom?: number | null;
  layers: MapLayerData[];
  markers: MapMarkerData[];
  elements: MapElementData[];
}

export type MapMutation = { action: string } & Record<string, unknown>;
export type MapMutator = (mutation: MapMutation) => Promise<Record<string, unknown>>;

type Tool = "select" | "pin" | "label" | "line" | "circle" | "rect" | "freehand" | "erase";
type Pending = { kind: "pin" | "label"; x: number; y: number };
type Draft =
  | { kind: "LINE" | "CIRCLE" | "RECT"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "PATH"; points: { x: number; y: number }[] };
type Selection = { type: "marker"; id: string } | { type: "element"; id: string } | null;

const COLOR_SWATCHES = ["#eab308", "#ef4444", "#f97316", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#f8fafc", "#111827"];
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f4f4f5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21"/><path d="m5.082 11.09 8.828 8.828"/></svg>')}") 2 21, crosshair`;
type StrokeStyle = { color?: string; strokeWidth?: number; fontSize?: number; erase?: boolean };
const MARKER_ICONS = ["map-pin", "castle", "skull", "zap", "eye", "flag", "star", "gem", "tree-pine", "home", "crown", "footprints"] as const;
const inputClass = "w-full rounded border border-zinc-800 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-100 focus:border-amber-500 focus:outline-none";
const btnClass = "inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-xs font-medium text-zinc-300 shadow-xl backdrop-blur-md hover:bg-zinc-800";

function clampPercent(n: number) {
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function markerIcon(name?: string | null) {
  switch (name?.toLowerCase()) {
    case "castle": return <Castle className="h-3.5 w-3.5" />;
    case "skull": return <Skull className="h-3.5 w-3.5" />;
    case "zap": return <Zap className="h-3.5 w-3.5" />;
    case "eye": return <Eye className="h-3.5 w-3.5" />;
    case "flag": return <Flag className="h-3.5 w-3.5" />;
    case "star": return <Star className="h-3.5 w-3.5" />;
    case "gem": return <Gem className="h-3.5 w-3.5" />;
    case "tree-pine": return <TreePine className="h-3.5 w-3.5" />;
    case "home": return <Home className="h-3.5 w-3.5" />;
    case "crown": return <Crown className="h-3.5 w-3.5" />;
    case "footprints": return <Footprints className="h-3.5 w-3.5" />;
    default: return <MapPin className="h-3.5 w-3.5" />;
  }
}

function layerVisible(layers: MapLayerData[], layerId?: string | null) {
  if (!layerId) return true;
  const layer = layers.find((item) => item.id === layerId);
  return layer ? layer.isVisible : true;
}

function percentFromEvent(rect: DOMRect, clientX: number, clientY: number) {
  return {
    x: clampPercent(((clientX - rect.left) / rect.width) * 100),
    y: clampPercent(((clientY - rect.top) / rect.height) * 100),
  };
}

function strokeStyle(element: MapElementData): StrokeStyle {
  return parseJson<StrokeStyle>(element.style, {});
}

function paintStroke(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kind: string,
  geo: { x1?: number; y1?: number; x2?: number; y2?: number; points?: { x: number; y: number }[] },
  style: StrokeStyle,
  fallbackColor: string,
) {
  const x = (n: number) => (n / 100) * width;
  const y = (n: number) => (n / 100) * height;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = style.color || fallbackColor;
  ctx.lineWidth = style.strokeWidth ?? 3;
  ctx.beginPath();
  if (kind === "LINE") {
    ctx.moveTo(x(geo.x1 ?? 0), y(geo.y1 ?? 0));
    ctx.lineTo(x(geo.x2 ?? 0), y(geo.y2 ?? 0));
  } else if (kind === "CIRCLE") {
    ctx.ellipse(x(geo.x1 ?? 0), y(geo.y1 ?? 0), Math.abs(x(geo.x2 ?? 0) - x(geo.x1 ?? 0)), Math.abs(y(geo.y2 ?? 0) - y(geo.y1 ?? 0)), 0, 0, Math.PI * 2);
  } else if (kind === "RECT") {
    ctx.rect(x(Math.min(geo.x1 ?? 0, geo.x2 ?? 0)), y(Math.min(geo.y1 ?? 0, geo.y2 ?? 0)), Math.abs(x(geo.x2 ?? 0) - x(geo.x1 ?? 0)), Math.abs(y(geo.y2 ?? 0) - y(geo.y1 ?? 0)));
  } else if (kind === "PATH" && Array.isArray(geo.points) && geo.points.length) {
    geo.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(x(point.x), y(point.y));
      else ctx.lineTo(x(point.x), y(point.y));
    });
  } else {
    return;
  }
  ctx.stroke();
}

function paintDraft(ctx: CanvasRenderingContext2D, width: number, height: number, draft: Draft, style: StrokeStyle, color: string) {
  if (draft.kind === "PATH") paintStroke(ctx, width, height, "PATH", { points: draft.points }, style, color);
  else paintStroke(ctx, width, height, draft.kind, draft, style, color);
}

function ColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-label="Color"
        onClick={() => setOpen((current) => !current)}
        className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${open ? "border-amber-400 bg-zinc-800 text-zinc-100" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"}`}
      >
        <span className="h-4 w-4 rounded-full border border-zinc-500" style={{ backgroundColor: value }} />
        Color
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 flex w-44 flex-wrap items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-2xl">
          {COLOR_SWATCHES.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Color ${color}`}
              onClick={() => { onChange(color); setOpen(false); }}
              className={`h-5 w-5 rounded-full border ${value === color ? "border-white ring-2 ring-amber-400" : "border-zinc-600"}`}
              style={{ backgroundColor: color }}
            />
          ))}
          <input aria-label="Custom color" type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-zinc-700 bg-zinc-900" />
        </div>
      )}
    </div>
  );
}

function NewMapModal({
  worldId,
  onClose,
  onCreate,
  busy,
}: {
  worldId: string;
  onClose: () => void;
  onCreate: (input: { title: string; description?: string; imageUrl: string; width?: number; height?: number }) => Promise<void>;
  busy: boolean;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [width, setWidth] = useState("");
  const [height, setHeight] = useState("");
  const [error, setError] = useState("");
  const [showLibrary, setShowLibrary] = useState(true);

  function chooseAsset(asset: ImageAssetItem) {
    setImageUrl(asset.url);
    setWidth(String(asset.width));
    setHeight(String(asset.height));
    if (!title.trim()) setTitle(asset.title);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim() || !imageUrl.trim()) {
      setError("A name and image are required.");
      return;
    }
    setError("");
    try {
      await onCreate({
        title: title.trim(),
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim(),
        width: width ? Number(width) : undefined,
        height: height ? Number(height) : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the map.");
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/70 p-4">
      <div className="w-full max-w-3xl rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">New map</h3>
          <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close"><X className="h-4 w-4" /></button>
        </div>
        {error && <p role="alert" className="mb-3 rounded border border-red-800 bg-red-950/50 px-3 py-2 text-xs text-red-200">{error}</p>}
        <form onSubmit={(e) => void submit(e)} className="grid gap-3 sm:grid-cols-2">
          <label className="text-[11px] text-zinc-400">Map name<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputClass} mt-1`} /></label>
          <label className="text-[11px] text-zinc-400">Image URL<input required value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="/api/assets/…/file or https://…" className={`${inputClass} mt-1`} /></label>
          <label className="sm:col-span-2 text-[11px] text-zinc-400">Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} mt-1`} /></label>
          <label className="text-[11px] text-zinc-400">Width<input type="number" min={1} value={width} onChange={(e) => setWidth(e.target.value)} placeholder="From image" className={`${inputClass} mt-1`} /></label>
          <label className="text-[11px] text-zinc-400">Height<input type="number" min={1} value={height} onChange={(e) => setHeight(e.target.value)} placeholder="From image" className={`${inputClass} mt-1`} /></label>
          <div className="flex items-end gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-black disabled:opacity-40">Create map</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-zinc-700 px-4 py-2 text-xs text-zinc-300">Cancel</button>
            <button type="button" onClick={() => setShowLibrary((open) => !open)} className="ml-auto text-xs text-indigo-300">{showLibrary ? "Hide library" : "Choose from library"}</button>
          </div>
        </form>
        {showLibrary && <div className="mt-4 border-t border-zinc-800 pt-4"><AssetLibrary worldId={worldId} onSelect={chooseAsset} /></div>}
      </div>
    </div>
  );
}

function LayerPanel({
  layers,
  busy,
  onCreate,
  onUpdate,
  onReorder,
  onDelete,
}: {
  layers: MapLayerData[];
  busy: boolean;
  onCreate: (name: string) => Promise<void>;
  onUpdate: (id: string, changes: { name?: string; isVisible?: boolean }) => Promise<void>;
  onReorder: (id: string, direction: "up" | "down") => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  return (
    <div className="absolute right-0 mt-2 w-72 space-y-1 rounded-lg border border-zinc-800 bg-zinc-900 p-2 shadow-2xl">
      <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Layers</div>
      {layers.length === 0 && <p className="px-2 py-1 text-xs text-zinc-500">No layers yet. Pins and drawings without a layer always show.</p>}
      {layers.map((layer, index) => (
        <div key={layer.id} className="flex items-center gap-1 rounded px-1 py-1 hover:bg-zinc-800">
          <button type="button" disabled={busy} onClick={() => void onUpdate(layer.id, { isVisible: !layer.isVisible })} className="p-1 text-zinc-400 hover:text-zinc-100" aria-label={layer.isVisible ? "Hide layer" : "Show layer"}>
            {layer.isVisible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          </button>
          {editingId === layer.id ? (
            <input
              autoFocus
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
              onBlur={() => { if (editingName.trim() && editingName.trim() !== layer.name) void onUpdate(layer.id, { name: editingName.trim() }); setEditingId(null); }}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingId(null); }}
              className={`${inputClass} flex-1`}
            />
          ) : (
            <button type="button" onClick={() => { setEditingId(layer.id); setEditingName(layer.name); }} className="min-w-0 flex-1 truncate text-left text-xs text-zinc-200">{layer.name}</button>
          )}
          <button type="button" disabled={busy || index === 0} onClick={() => void onReorder(layer.id, "up")} className="p-1 text-zinc-500 disabled:opacity-30" aria-label="Move layer up"><ChevronUp className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={busy || index === layers.length - 1} onClick={() => void onReorder(layer.id, "down")} className="p-1 text-zinc-500 disabled:opacity-30" aria-label="Move layer down"><ChevronDown className="h-3.5 w-3.5" /></button>
          <button type="button" disabled={busy} onClick={() => { if (window.confirm(`Delete layer “${layer.name}”? Pins and drawings stay on the map.`)) void onDelete(layer.id); }} className="p-1 text-zinc-500 hover:text-red-400" aria-label="Delete layer"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
      ))}
      <form
        onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; void onCreate(name.trim()).then(() => setName("")); }}
        className="flex gap-1 border-t border-zinc-800 pt-2"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New layer" className={inputClass} />
        <button type="submit" disabled={busy || !name.trim()} className="rounded bg-zinc-800 px-2 text-xs text-zinc-200 disabled:opacity-40">Add</button>
      </form>
    </div>
  );
}

function SelectionPanel({
  map,
  selection,
  articles,
  busy,
  onClose,
  onMutate,
  onSelectArticle,
  onDirtyChange,
}: {
  map: MapData;
  selection: NonNullable<Selection>;
  articles: { id: string; title: string }[];
  busy: boolean;
  onClose: () => void;
  onMutate: MapMutator;
  onSelectArticle?: (articleId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const marker = selection.type === "marker" ? map.markers.find((item) => item.id === selection.id) : null;
  const element = selection.type === "element" ? map.elements.find((item) => item.id === selection.id) : null;
  const geometry = parseJson<Record<string, unknown>>(element?.geometry, {});
  const style = parseJson<{ color?: string; strokeWidth?: number; fontSize?: number }>(element?.style, {});
  const [title, setTitle] = useState(marker?.title ?? "");
  const [description, setDescription] = useState(marker?.description ?? "");
  const [color, setColor] = useState(marker?.color || style.color || "#3b82f6");
  const [icon, setIcon] = useState(marker?.icon || "map-pin");
  const [layerId, setLayerId] = useState(marker?.layerId || element?.layerId || "");
  const [articleId, setArticleId] = useState(marker?.article?.id || "");
  const [text, setText] = useState(typeof geometry.text === "string" ? geometry.text : "");
  const [strokeWidth, setStrokeWidth] = useState(style.strokeWidth ?? 3);
  const [fontSize, setFontSize] = useState(style.fontSize ?? 18);

  const dirty = marker
    ? title !== (marker.title ?? "") || description !== (marker.description ?? "") || color !== (marker.color || "#3b82f6") || icon !== (marker.icon || "map-pin") || layerId !== (marker.layerId || "") || articleId !== (marker.article?.id || "")
    : element
      ? color !== (style.color || "#3b82f6") || layerId !== (element.layerId || "") || (element.kind === "LABEL" ? text !== (typeof geometry.text === "string" ? geometry.text : "") || fontSize !== (style.fontSize ?? 18) : strokeWidth !== (style.strokeWidth ?? 3))
      : false;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);

  if (!marker && !element) return null;

  async function save() {
    if (marker) {
      await onMutate({ action: "updateMarker", mapId: map.id, id: marker.id, title, description, color, icon, layerId: layerId || null, articleId: articleId || null });
    } else if (element) {
      const nextGeometry = element.kind === "LABEL" ? JSON.stringify({ ...geometry, text }) : element.geometry;
      const nextStyle = JSON.stringify(element.kind === "LABEL" ? { color, fontSize } : { color, strokeWidth });
      await onMutate({ action: "updateElement", mapId: map.id, id: element.id, geometry: nextGeometry, style: nextStyle, layerId: layerId || null });
    }
  }

  async function remove() {
    if (!window.confirm("Delete this annotation?")) return;
    if (marker) await onMutate({ action: "deleteMarker", mapId: map.id, id: marker.id });
    else if (element) await onMutate({ action: "deleteElement", mapId: map.id, id: element.id });
    onClose();
  }

  return (
    <div className="absolute bottom-4 right-4 z-30 w-80 rounded-xl border border-zinc-700/80 bg-zinc-900/95 p-4 text-zinc-200 shadow-2xl backdrop-blur-md">
      <div className="mb-3 flex items-start justify-between gap-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">{marker ? "Pin" : element?.kind === "LABEL" ? "Label" : "Drawing"}</h4>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-3">
        {marker && (
          <>
            <label className="block text-[11px] text-zinc-400">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <label className="block text-[11px] text-zinc-400">Description<textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputClass} mt-1`} /></label>
            <div>
              <div className="mb-1 text-[11px] text-zinc-400">Icon</div>
              <div className="flex flex-wrap gap-1">
                {MARKER_ICONS.map((name) => (
                  <button key={name} type="button" onClick={() => setIcon(name)} className={`rounded border p-1.5 ${icon === name ? "border-amber-400 bg-zinc-800" : "border-zinc-800 bg-zinc-950"}`} aria-label={name}>{markerIcon(name)}</button>
                ))}
              </div>
            </div>
            <label className="block text-[11px] text-zinc-400">Linked article
              <select value={articleId} onChange={(e) => setArticleId(e.target.value)} className={`${inputClass} mt-1`}>
                <option value="">None</option>
                {articles.map((article) => <option key={article.id} value={article.id}>{article.title}</option>)}
              </select>
            </label>
            {marker.article && onSelectArticle && (
              <button type="button" onClick={() => onSelectArticle(marker.article!.id)} className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">
                Open article <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </>
        )}
        {element?.kind === "LABEL" && <label className="block text-[11px] text-zinc-400">Text<textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} className={`${inputClass} mt-1`} /></label>}
        {element?.kind === "LABEL" && <label className="block text-[11px] text-zinc-400">Font size<input type="number" min={10} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value) || 18)} className={`${inputClass} mt-1`} /></label>}
        {element && element.kind !== "LABEL" && <label className="block text-[11px] text-zinc-400">Stroke<input type="range" min={1} max={12} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="mt-1 w-full" /></label>}
        <div>
          <div className="mb-1 text-[11px] text-zinc-400">Color</div>
          <ColorControl value={color} onChange={setColor} />
        </div>
        <label className="block text-[11px] text-zinc-400">Layer
          <select value={layerId} onChange={(e) => setLayerId(e.target.value)} className={`${inputClass} mt-1`}>
            <option value="">None</option>
            {map.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
          </select>
        </label>
        <div className="flex gap-2">
          <button type="button" disabled={busy || !dirty} onClick={() => void save()} className="flex-1 rounded bg-amber-500 py-1.5 text-xs font-semibold text-black disabled:opacity-40">Save</button>
          <button type="button" disabled={busy} onClick={() => void remove()} className="rounded border border-red-800 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950">Delete</button>
        </div>
      </div>
    </div>
  );
}

export function InteractiveMap({
  maps,
  worldId,
  articles = [],
  onSelectArticle,
  onMutate,
  onGuardChange,
}: {
  maps: MapData[];
  worldId: string;
  articles?: { id: string; title: string }[];
  onSelectArticle?: (articleId: string) => void;
  onMutate: MapMutator;
  onGuardChange?: (registration: GuardRegistration) => void;
}) {
  const [selectedMapId, setSelectedMapId] = useState(maps[0]?.id ?? "");
  const [zoom, setZoom] = useState(1);
  const [tool, setTool] = useState<Tool>("select");
  const [drawColor, setDrawColor] = useState("#eab308");
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [eraserSize, setEraserSize] = useState(16);
  const [fontSize, setFontSize] = useState(18);
  const [eraserPos, setEraserPos] = useState<{ x: number; y: number } | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [pendingTitle, setPendingTitle] = useState("");
  const [pendingDesc, setPendingDesc] = useState("");
  const [pendingText, setPendingText] = useState("");
  const [pendingLayerId, setPendingLayerId] = useState("");
  const [pendingIcon, setPendingIcon] = useState("map-pin");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [panelDirty, setPanelDirty] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const erasing = useRef(false);

  const map = maps.find((item) => item.id === selectedMapId) ?? maps[0] ?? null;

  const dirty = !!pending || panelDirty || renameOpen || newMapOpen;
  useWorldGuard({ dirty, busy: mutating }, "map", onGuardChange);

  const mutate = useCallback(async (mutation: MapMutation) => {
    setMutating(true);
    setError("");
    try {
      return await onMutate(mutation);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update the map.";
      setError(message);
      throw err;
    } finally {
      setMutating(false);
    }
  }, [onMutate]);

  const getPercent = useCallback((clientX: number, clientY: number) => {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return percentFromEvent(rect, clientX, clientY);
  }, []);

  function clearTransient() {
    setPending(null);
    setPendingTitle("");
    setPendingDesc("");
    setPendingText("");
    setDraft(null);
    drawing.current = false;
    erasing.current = false;
    setEraserPos(null);
  }

  function handleSurfaceClick(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget && !(event.target as HTMLElement).closest("[data-map-surface]")) return;
    if (tool === "select") {
      setSelection(null);
      return;
    }
    if (tool === "erase") return;
    if (tool !== "pin" && tool !== "label") return;
    const point = getPercent(event.clientX, event.clientY);
    setSelection(null);
    setPending({ kind: tool, ...point });
    setPendingTitle("");
    setPendingDesc("");
    setPendingText("");
    setPendingLayerId("");
    setPendingIcon("map-pin");
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if (tool !== "line" && tool !== "circle" && tool !== "rect" && tool !== "freehand" && tool !== "erase") return;
    if (!imageRef.current?.contains(event.target as Node)) return;
    event.preventDefault();
    const point = getPercent(event.clientX, event.clientY);
    drawing.current = true;
    erasing.current = tool === "erase";
    setSelection(null);
    if (tool === "freehand" || tool === "erase") setDraft({ kind: "PATH", points: [point] });
    else setDraft({ kind: tool === "line" ? "LINE" : tool === "rect" ? "RECT" : "CIRCLE", x1: point.x, y1: point.y, x2: point.x, y2: point.y });
  }

  function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
    if (tool === "erase") setEraserPos(getPercent(event.clientX, event.clientY));
    if (!drawing.current || !draft) return;
    const point = getPercent(event.clientX, event.clientY);
    if (draft.kind === "PATH") {
      const last = draft.points[draft.points.length - 1];
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.15) return;
      setDraft({ kind: "PATH", points: [...draft.points, point] });
    } else {
      const rect = imageRef.current?.getBoundingClientRect();
      if (event.shiftKey && rect?.width && rect?.height) {
        const dxPx = ((point.x - draft.x1) / 100) * rect.width;
        const dyPx = ((point.y - draft.y1) / 100) * rect.height;
        const size = Math.max(Math.abs(dxPx), Math.abs(dyPx));
        point.x = clampPercent(draft.x1 + ((size * (dxPx < 0 ? -1 : 1)) / rect.width) * 100);
        point.y = clampPercent(draft.y1 + ((size * (dyPx < 0 ? -1 : 1)) / rect.height) * 100);
      }
      setDraft({ ...draft, x2: point.x, y2: point.y });
    }
  }

  async function handleMouseUp() {
    if (!drawing.current || !draft || !map) { drawing.current = false; erasing.current = false; return; }
    drawing.current = false;
    const hole = erasing.current;
    erasing.current = false;
    const style = JSON.stringify(hole ? { erase: true, strokeWidth: eraserSize } : { color: drawColor, strokeWidth });
    try {
      if (draft.kind === "PATH") {
        const points = draft.points.length === 1 ? [draft.points[0], { x: clampPercent(draft.points[0].x + 0.05), y: draft.points[0].y }] : draft.points;
        if (points.length < 2) { setDraft(null); return; }
        await mutate({ action: "createElement", mapId: map.id, kind: "PATH", geometry: JSON.stringify({ points }), style, layerId: pendingLayerId || null });
      } else {
        await mutate({ action: "createElement", mapId: map.id, kind: draft.kind, geometry: JSON.stringify({ x1: draft.x1, y1: draft.y1, x2: draft.x2, y2: draft.y2 }), style, layerId: pendingLayerId || null });
      }
    } catch { /* error already surfaced */ }
    setDraft(null);
  }

  async function savePending(event: React.FormEvent) {
    event.preventDefault();
    if (!pending || !map) return;
    try {
      if (pending.kind === "pin") {
        if (!pendingTitle.trim()) return;
        await mutate({ action: "createMarker", mapId: map.id, title: pendingTitle.trim(), description: pendingDesc, x: pending.x, y: pending.y, color: drawColor, icon: pendingIcon, layerId: pendingLayerId || null });
      } else {
        if (!pendingText.trim()) return;
        await mutate({ action: "createElement", mapId: map.id, kind: "LABEL", geometry: JSON.stringify({ x: pending.x, y: pending.y, text: pendingText.trim() }), style: JSON.stringify({ color: drawColor, fontSize }), layerId: pendingLayerId || null });
      }
      clearTransient();
    } catch { /* error already surfaced */ }
  }

  async function createMap(input: { title: string; description?: string; imageUrl: string; width?: number; height?: number }) {
    const created = await mutate({ action: "createMap", title: input.title, description: input.description ?? null, imageUrl: input.imageUrl, width: input.width, height: input.height });
    if (typeof created.id === "string") setSelectedMapId(created.id);
    setNewMapOpen(false);
  }

  async function renameMap(event: React.FormEvent) {
    event.preventDefault();
    if (!map || !renameTitle.trim()) return;
    await mutate({ action: "updateMap", id: map.id, title: renameTitle.trim() });
    setRenameOpen(false);
  }

  async function deleteMap() {
    if (!map) return;
    if (!window.confirm(`Delete map “${map.title}”? This cannot be undone.`)) return;
    await mutate({ action: "deleteMap", id: map.id });
    setSelection(null);
  }

  function activate(target: { type: "marker" | "element"; id: string }) {
    if (tool === "erase") return;
    setSelection(target);
  }

  const visibleMarkers = useMemo(() => map ? map.markers.filter((marker) => layerVisible(map.layers, marker.layerId)) : [], [map]);
  const visibleElements = useMemo(() => map ? map.elements.filter((element) => layerVisible(map.layers, element.layerId)) : [], [map]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = imageRef.current;
    if (!canvas || !wrap) return;
    const redraw = () => {
      const cssWidth = wrap.clientWidth;
      const cssHeight = wrap.clientHeight;
      if (!cssWidth || !cssHeight) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round(cssHeight * dpr));
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      for (const element of visibleElements) {
        if (element.kind === "LABEL") continue;
        const style = strokeStyle(element);
        const isErase = !!style.erase;
        ctx.globalCompositeOperation = isErase ? "destination-out" : "source-over";
        paintStroke(ctx, cssWidth, cssHeight, element.kind, parseJson(element.geometry, {}), isErase ? { ...style, color: "#000" } : style, "#eab308");
      }
      if (draft && (erasing.current || tool === "erase")) {
        if (draft.kind === "PATH") {
          ctx.globalCompositeOperation = "destination-out";
          paintDraft(ctx, cssWidth, cssHeight, draft, { erase: true, strokeWidth: eraserSize, color: "#000" }, "#000");
        }
      } else if (draft) {
        ctx.globalCompositeOperation = "source-over";
        paintDraft(ctx, cssWidth, cssHeight, draft, { color: drawColor, strokeWidth }, drawColor);
      }
      ctx.globalCompositeOperation = "source-over";
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [visibleElements, draft, drawColor, strokeWidth, eraserSize, tool]);

  const cursor = tool === "select" ? "cursor-grab" : tool === "erase" ? "" : "cursor-crosshair";

  return (
    <div className="relative flex h-[720px] w-full select-none flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
      <div className="z-20 flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/80 px-3 py-2">
        <select aria-label="Choose map" value={map?.id ?? ""} onChange={(e) => { setSelectedMapId(e.target.value); setSelection(null); clearTransient(); }} className="max-w-[220px] rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100">
          {maps.length === 0 && <option value="">No maps</option>}
          {maps.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
        <button type="button" onClick={() => setNewMapOpen(true)} className={btnClass}><Plus className="h-3.5 w-3.5" />New map</button>
        {map && <button type="button" onClick={() => { setRenameTitle(map.title); setRenameOpen(true); }} className={btnClass}>Rename</button>}
        {map && <button type="button" onClick={() => void deleteMap()} className={`${btnClass} text-red-300`}><Trash2 className="h-3.5 w-3.5" />Delete</button>}
        <div className="mx-1 h-6 w-px bg-zinc-800" />
        {([
          ["select", MousePointer2, "Select"],
          ["pin", MapPin, "Pin"],
          ["label", Type, "Label"],
          ["line", Minus, "Line"],
          ["circle", Circle, "Circle"],
          ["rect", Square, "Rectangle"],
          ["freehand", PenLine, "Freehand"],
          ["erase", Eraser, "Eraser"],
        ] as const).map(([id, Icon, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setTool(id); clearTransient(); if (id !== "select") setSelection(null); }}
            title={id === "circle" ? "Circle (hold Shift for a perfect circle)" : id === "rect" ? "Rectangle (hold Shift for a square)" : label}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs ${tool === id ? "border-amber-400 bg-amber-500 text-black" : "border-zinc-800 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"}`}
          >
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
        {tool !== "select" && tool !== "erase" && (
          <>
            <div className="mx-1 h-6 w-px bg-zinc-800" />
            <ColorControl value={drawColor} onChange={setDrawColor} />
          </>
        )}
        {(tool === "line" || tool === "circle" || tool === "rect" || tool === "freehand") && (
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">Stroke<input type="range" min={1} max={12} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value))} className="w-20" /></label>
        )}
        {tool === "erase" && (
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">Size<input type="range" min={4} max={48} value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} className="w-20" /></label>
        )}
        {tool === "label" && (
          <label className="flex items-center gap-1 text-[11px] text-zinc-400">Size<input type="number" min={10} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value) || 18)} className="w-14 rounded border border-zinc-800 bg-zinc-950 px-1 py-1 text-xs" /></label>
        )}
        <div className="relative ml-auto">
          <button type="button" onClick={() => setLayersOpen((open) => !open)} className={btnClass}><Layers className="h-4 w-4 text-indigo-400" />Layers</button>
          {layersOpen && map && (
            <LayerPanel
              layers={map.layers}
              busy={mutating}
              onCreate={async (name) => { await mutate({ action: "createLayer", mapId: map.id, name }); }}
              onUpdate={async (id, changes) => { await mutate({ action: "updateLayer", mapId: map.id, id, ...changes }); }}
              onReorder={async (id, direction) => { await mutate({ action: "reorderLayer", mapId: map.id, id, direction }); }}
              onDelete={async (id) => { await mutate({ action: "deleteLayer", mapId: map.id, id }); }}
            />
          )}
        </div>
        <div className="flex overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
          <button type="button" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))} className="p-2 text-zinc-300 hover:bg-zinc-800" title="Zoom in"><ZoomIn className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))} className="border-l border-zinc-800 p-2 text-zinc-300 hover:bg-zinc-800" title="Zoom out"><ZoomOut className="h-4 w-4" /></button>
          <button type="button" onClick={() => setZoom(1)} className="border-l border-zinc-800 p-2 text-zinc-300 hover:bg-zinc-800" title="Reset view"><Maximize2 className="h-4 w-4" /></button>
        </div>
      </div>

      {error && <p role="alert" className="border-b border-red-900 bg-red-950/40 px-4 py-2 text-xs text-red-200">{error}</p>}

      {!map ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <MapPin className="h-8 w-8 text-zinc-600" />
          <h3 className="text-sm font-semibold text-zinc-200">No maps yet</h3>
          <p className="max-w-sm text-xs text-zinc-400">Upload a map image, name it, then add layers, pins, labels, and drawings.</p>
          <button type="button" onClick={() => setNewMapOpen(true)} className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-black">Create your first map</button>
        </div>
      ) : (
        <div
          className={`relative flex flex-1 items-center justify-center overflow-hidden bg-zinc-950 ${cursor}`}
          style={tool === "erase" ? { cursor: ERASER_CURSOR } : undefined}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={() => void handleMouseUp()}
          onMouseLeave={() => { setEraserPos(null); if (drawing.current) void handleMouseUp(); }}
          onClick={handleSurfaceClick}
        >
          <div style={{ transform: `scale(${zoom})`, transition: "transform 0.15s ease-out" }} className="flex h-full w-full items-center justify-center">
            <div
              ref={imageRef}
              data-map-surface="true"
              className="relative max-h-[92%] w-[min(92%,1100px)] overflow-hidden rounded-lg border border-zinc-700/60 shadow-2xl"
              style={{ aspectRatio: `${map.width} / ${map.height}` }}
            >
              <img src={map.imageUrl} alt={map.title} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" style={{ pointerEvents: "none" }}>
                {visibleElements.map((element) => {
                  if (element.kind === "LABEL" || strokeStyle(element).erase) return null;
                  const geo = parseJson<{ x1?: number; y1?: number; x2?: number; y2?: number; points?: { x: number; y: number }[] }>(element.geometry, {});
                  const st = strokeStyle(element);
                  const selected = selection?.type === "element" && selection.id === element.id;
                  const common = { stroke: "transparent", strokeWidth: Math.max(st.strokeWidth ?? 3, 8), fill: "none" as const, style: { pointerEvents: tool === "select" ? "stroke" as const : "none" as const, cursor: "pointer" }, onClick: (e: React.MouseEvent) => { e.stopPropagation(); activate({ type: "element", id: element.id }); }, opacity: selected ? 1 : 0 };
                  if (element.kind === "LINE") return <line key={element.id} x1={geo.x1} y1={geo.y1} x2={geo.x2} y2={geo.y2} strokeLinecap="round" {...common} />;
                  if (element.kind === "CIRCLE") return <ellipse key={element.id} cx={geo.x1} cy={geo.y1} rx={Math.abs((geo.x2 ?? 0) - (geo.x1 ?? 0))} ry={Math.abs((geo.y2 ?? 0) - (geo.y1 ?? 0))} {...common} />;
                  if (element.kind === "RECT") return <rect key={element.id} x={Math.min(geo.x1 ?? 0, geo.x2 ?? 0)} y={Math.min(geo.y1 ?? 0, geo.y2 ?? 0)} width={Math.abs((geo.x2 ?? 0) - (geo.x1 ?? 0))} height={Math.abs((geo.y2 ?? 0) - (geo.y1 ?? 0))} {...common} />;
                  if (element.kind === "PATH" && Array.isArray(geo.points)) return <polyline key={element.id} points={geo.points.map((p) => `${p.x},${p.y}`).join(" ")} strokeLinejoin="round" strokeLinecap="round" {...common} />;
                  return null;
                })}
              </svg>
              {visibleElements.filter((element) => element.kind === "LABEL").map((element) => {
                const geo = parseJson<{ x?: number; y?: number; text?: string }>(element.geometry, {});
                const st = parseJson<{ color?: string; fontSize?: number }>(element.style, {});
                return (
                  <button
                    key={element.id}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); activate({ type: "element", id: element.id }); }}
                    style={{ left: `${geo.x ?? 0}%`, top: `${geo.y ?? 0}%`, color: st.color || "#f8fafc", fontSize: st.fontSize ?? 18 }}
                    className={`absolute z-10 max-w-[40%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap text-left font-semibold drop-shadow ${tool === "erase" ? "pointer-events-none" : ""} ${selection?.type === "element" && selection.id === element.id ? "ring-1 ring-amber-400" : ""}`}
                  >
                    {geo.text || "Label"}
                  </button>
                );
              })}
              {visibleMarkers.map((marker) => (
                <DraggablePin
                  key={marker.id}
                  marker={marker}
                  selected={selection?.type === "marker" && selection.id === marker.id}
                  getPercent={getPercent}
                  onSelect={() => activate({ type: "marker", id: marker.id })}
                  onMove={tool === "erase" ? undefined : (x, y) => { void mutate({ action: "updateMarker", mapId: map.id, id: marker.id, x, y }); }}
                  locked={tool === "erase"}
                />
              ))}
              {tool === "erase" && eraserPos && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/80 bg-white/10"
                  style={{ left: `${eraserPos.x}%`, top: `${eraserPos.y}%`, width: eraserSize, height: eraserSize }}
                />
              )}
              {pending && (
                <div style={{ left: `${pending.x}%`, top: `${pending.y}%` }} className="absolute z-30 -translate-x-1/2 -translate-y-1/2">
                  <div className="flex h-8 w-8 animate-bounce items-center justify-center rounded-full border-2 border-white bg-amber-500 text-black shadow-2xl">
                    {pending.kind === "label" ? <Type className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {pending && map && (
        <div className="absolute bottom-4 left-4 z-30 w-80 rounded-xl border border-amber-500/50 bg-zinc-900 p-4 text-zinc-200 shadow-2xl">
          <div className="mb-2 flex items-center justify-between border-b border-zinc-800 pb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">{pending.kind === "pin" ? "New pin" : "New label"}</h4>
            <button type="button" onClick={clearTransient} className="text-zinc-500 hover:text-zinc-200"><X className="h-4 w-4" /></button>
          </div>
          <form onSubmit={(e) => void savePending(e)} className="space-y-3">
            {pending.kind === "pin" ? (
              <>
                <label className="block text-[11px] text-zinc-400">Title<input required value={pendingTitle} onChange={(e) => setPendingTitle(e.target.value)} className={`${inputClass} mt-1`} /></label>
                <label className="block text-[11px] text-zinc-400">Description<textarea rows={2} value={pendingDesc} onChange={(e) => setPendingDesc(e.target.value)} className={`${inputClass} mt-1`} /></label>
                <div className="flex flex-wrap gap-1">
                  {MARKER_ICONS.map((name) => (
                    <button key={name} type="button" onClick={() => setPendingIcon(name)} className={`rounded border p-1.5 ${pendingIcon === name ? "border-amber-400 bg-zinc-800" : "border-zinc-800"}`}>{markerIcon(name)}</button>
                  ))}
                </div>
              </>
            ) : (
              <label className="block text-[11px] text-zinc-400">Text<textarea required rows={2} value={pendingText} onChange={(e) => setPendingText(e.target.value)} className={`${inputClass} mt-1`} /></label>
            )}
            <label className="block text-[11px] text-zinc-400">Layer
              <select value={pendingLayerId} onChange={(e) => setPendingLayerId(e.target.value)} className={`${inputClass} mt-1`}>
                <option value="">None</option>
                {map.layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}
              </select>
            </label>
            <button type="submit" disabled={mutating} className="w-full rounded bg-amber-500 py-1.5 text-xs font-semibold text-black disabled:opacity-40">Save</button>
          </form>
        </div>
      )}

      {map && selection && tool !== "erase" && (
        <SelectionPanel
          key={`${selection.type}-${selection.id}`}
          map={map}
          selection={selection}
          articles={articles}
          busy={mutating}
          onClose={() => setSelection(null)}
          onMutate={mutate}
          onSelectArticle={onSelectArticle}
          onDirtyChange={setPanelDirty}
        />
      )}

      {renameOpen && map && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
          <form onSubmit={(e) => void renameMap(e)} className="w-80 space-y-3 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <h3 className="text-sm font-semibold text-zinc-100">Rename map</h3>
            <input autoFocus required value={renameTitle} onChange={(e) => setRenameTitle(e.target.value)} className={inputClass} />
            <div className="flex gap-2">
              <button type="submit" disabled={mutating} className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black">Save</button>
              <button type="button" onClick={() => setRenameOpen(false)} className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {newMapOpen && <NewMapModal worldId={worldId} busy={mutating} onClose={() => setNewMapOpen(false)} onCreate={createMap} />}
    </div>
  );
}

function DraggablePin({
  marker,
  selected,
  getPercent,
  onSelect,
  onMove,
  locked = false,
}: {
  marker: MapMarkerData;
  selected: boolean;
  getPercent: (clientX: number, clientY: number) => { x: number; y: number };
  onSelect: () => void;
  onMove?: (x: number, y: number) => void;
  locked?: boolean;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);
  const display = pos ?? marker;

  return (
    <button
      type="button"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, y: e.clientY };
        last.current = { x: marker.x, y: marker.y };
        moved.current = false;
      }}
      onPointerMove={(e) => {
        if (!start.current || !onMove) return;
        if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) < 4 && !moved.current) return;
        moved.current = true;
        const next = getPercent(e.clientX, e.clientY);
        last.current = next;
        setPos(next);
      }}
      onPointerUp={() => {
        start.current = null;
        const commit = onMove;
        if (moved.current && last.current && commit) commit(last.current.x, last.current.y);
        else onSelect();
        setPos(null);
        moved.current = false;
      }}
      style={{ left: `${display.x}%`, top: `${display.y}%` }}
      className={`group absolute z-10 -translate-x-1/2 -translate-y-1/2 focus:outline-none ${locked ? "pointer-events-none" : ""} ${selected ? "scale-125" : "hover:scale-125"}`}
    >
      <div style={{ backgroundColor: marker.color || "#3b82f6" }} className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white/80 text-white shadow-lg ring-2 ring-black/40">
        {markerIcon(marker.icon)}
      </div>
      <div className="pointer-events-none absolute left-1/2 top-8 -translate-x-1/2 whitespace-nowrap rounded bg-zinc-900/95 px-2 py-0.5 text-[11px] font-semibold text-zinc-200 opacity-0 shadow-xl group-hover:opacity-100">{marker.title}</div>
    </button>
  );
}
