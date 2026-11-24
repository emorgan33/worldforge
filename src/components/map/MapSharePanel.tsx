"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Globe2, Loader2, Lock, Send, Trash2, X } from "lucide-react";
import type { MapData } from "@/components/map/InteractiveMap";
import { MapPreview } from "@/components/map/MapViewer";
import { ShareResource } from "@/components/campaign/ShareResource";
import { buildMapSnapshot, type MapSelection } from "@/lib/map-publication";

type PublicationState = {
  publishedAt: string | null;
  revision: number;
  summary: { layers: number; markers: number; elements: number; selection: MapSelection } | null;
  imagesReady: boolean;
  imageIssues: string[];
};

function elementLabel(element: MapData["elements"][number]) {
  if (element.kind !== "LABEL") return `${element.kind.toLowerCase()} annotation`;
  try {
    const geometry = JSON.parse(element.geometry || "{}") as { text?: unknown };
    return `Label: ${typeof geometry.text === "string" && geometry.text.trim() ? geometry.text : "untitled"}`;
  } catch { return "Label"; }
}

function toggled(set: Set<string>, id: string, on: boolean) {
  const next = new Set(set);
  if (on) next.add(id); else next.delete(id);
  return next;
}

/**
 * GM publishing workflow: choose exactly which layers, pins and annotations the
 * campaign players receive, preview the result, then publish a snapshot.
 */
export function MapSharePanel({ worldId, map, onClose }: { worldId: string; map: MapData; onClose: () => void }) {
  const [state, setState] = useState<PublicationState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [layers, setLayers] = useState<Set<string>>(new Set());
  const [markers, setMarkers] = useState<Set<string>>(new Set());
  const [elements, setElements] = useState<Set<string>>(new Set());
  const [shareImages, setShareImages] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  const endpoint = `/api/maps/publish?worldId=${encodeURIComponent(worldId)}&mapId=${encodeURIComponent(map.id)}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load map sharing.");
        if (controller.signal.aborted) return;
        setState(data);
        if (data.summary?.selection) {
          setLayers(new Set(data.summary.selection.layers));
          setMarkers(new Set(data.summary.selection.markers));
          setElements(new Set(data.summary.selection.elements));
        }
        setError("");
      })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not load map sharing."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [endpoint]);

  // A pin or annotation is only publishable when its layer is published too.
  const effective = useMemo(() => {
    const layerOn = (layerId?: string | null) => !layerId || layers.has(layerId);
    return {
      layers: map.layers.filter(layer => layers.has(layer.id)).map(layer => layer.id),
      markers: map.markers.filter(marker => markers.has(marker.id) && layerOn(marker.layerId)).map(marker => marker.id),
      elements: map.elements.filter(element => elements.has(element.id) && layerOn(element.layerId)).map(element => element.id),
    } satisfies MapSelection;
  }, [map, layers, markers, elements]);

  const total = effective.layers.length + effective.markers.length + effective.elements.length;
  const empty = total === 0;

  const previewSnapshot = useMemo(() => {
    if (!previewOpen || empty) return null;
    try { return buildMapSnapshot(map, effective); } catch { return null; }
  }, [previewOpen, empty, map, effective]);

  function selectAll() {
    setLayers(new Set(map.layers.map(layer => layer.id)));
    setMarkers(new Set(map.markers.map(marker => marker.id)));
    setElements(new Set(map.elements.map(element => element.id)));
  }

  function clearAll() {
    setLayers(new Set());
    setMarkers(new Set());
    setElements(new Set());
  }

  async function publish() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/maps/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          worldId,
          mapId: map.id,
          layers: effective.layers,
          markers: effective.markers,
          elements: effective.elements,
          shareImages,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error([data.error, ...(Array.isArray(data.issues) ? data.issues : [])].filter(Boolean).join(" "));
      setState(previous => ({
        publishedAt: data.publishedAt,
        revision: data.revision,
        summary: data.summary,
        imagesReady: true,
        imageIssues: previous?.imageIssues ?? [],
      }));
      setNotice(data.imagesShared > 0 ? `Published. ${data.imagesShared} map image${data.imagesShared === 1 ? "" : "s"} shared with campaign players.` : "Published. Campaign players now see this selection.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not publish this map."); }
    finally { setBusy(false); }
  }

  async function unpublish() {
    if (!window.confirm("Stop sharing this map with campaign players? They will lose access until you publish again.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/maps/publish", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worldId, mapId: map.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not stop sharing this map.");
      setState(previous => ({ publishedAt: null, revision: 0, summary: null, imagesReady: previous?.imagesReady ?? true, imageIssues: previous?.imageIssues ?? [] }));
      setNotice("Sharing stopped. Campaign players can no longer open this map.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not stop sharing this map."); }
    finally { setBusy(false); }
  }

  const rowClass = "flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm text-app-text-dim hover:bg-app-raised/60";
  const checkboxClass = "mt-0.5 accent-primary-500";

  function childRows(kind: "markers" | "elements") {
    const items = kind === "markers"
      ? map.markers.map(marker => ({ id: marker.id, layerId: marker.layerId, label: marker.title }))
      : map.elements.map(element => ({ id: element.id, layerId: element.layerId, label: elementLabel(element) }));
    const selected = kind === "markers" ? markers : elements;
    return (
      <div className="ml-5 border-l border-app-border pl-2">
        {items.map(item => {
          const layerOn = !item.layerId || layers.has(item.layerId);
          return (
            <label key={item.id} className={`${rowClass} ${layerOn ? "" : "opacity-40"}`}>
              <input
                type="checkbox"
                className={checkboxClass}
                checked={layerOn && selected.has(item.id)}
                disabled={!layerOn}
                onChange={event => {
                  const next = toggled(selected, item.id, event.target.checked);
                  if (kind === "markers") setMarkers(next); else setElements(next);
                }}
              />
              <span className="min-w-0 truncate">{item.label}</span>
            </label>
          );
        })}
        {items.length === 0 && <p className="px-2 py-1 text-xs text-app-subtle">None yet.</p>}
      </div>
    );
  }

  const unlayeredMarkers = map.markers.filter(marker => !marker.layerId);
  const unlayeredElements = map.elements.filter(element => !element.layerId);

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center overflow-y-auto bg-app-scrim p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="map-share-heading" className="w-full max-w-2xl space-y-4 rounded-xl border border-app-border-strong bg-app-surface p-5 text-app-text shadow-2xl">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="map-share-heading" className="font-serif text-xl text-app-text-strong">Share “{map.title}” with players</h2>
            <p className="mt-1 text-xs leading-relaxed text-app-subtle">Choose exactly what campaign players receive. They see this published selection until you publish again, so later edits stay private.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close map sharing" className="text-app-subtle hover:text-app-text"><X className="h-4 w-4" /></button>
        </header>

        {loading ? <p role="status" className="flex items-center gap-2 text-sm text-app-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading sharing state…</p> : <>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-app-border bg-app-canvas/40 px-3 py-2 text-xs">
            {state?.publishedAt ? <><Globe2 className="h-3.5 w-3.5 text-success-300" /><span className="text-success-300">Published rev {state.revision}</span><span className="text-app-subtle">· {new Date(state.publishedAt).toLocaleString()}</span></> : <><Lock className="h-3.5 w-3.5 text-app-subtle" /><span className="text-app-subtle">Only the GM can open this map.</span></>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={selectAll} className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text hover:bg-app-raised">Select all</button>
            <button type="button" onClick={clearAll} className="rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text hover:bg-app-raised">Clear</button>
            <button type="button" onClick={() => setPreviewOpen(value => !value)} aria-expanded={previewOpen} disabled={empty} className="inline-flex items-center gap-1 rounded-lg border border-app-border px-3 py-1.5 text-xs text-app-text hover:bg-app-raised disabled:opacity-40"><Eye className="h-3.5 w-3.5" />{previewOpen ? "Hide preview" : "Preview as player"}</button>
            <span className="ml-auto text-xs text-app-subtle">{total} item{total === 1 ? "" : "s"} selected</span>
          </div>

          {previewOpen && (previewSnapshot ? <MapPreview snapshot={previewSnapshot} /> : <p className="text-xs text-app-subtle">Select something to preview.</p>)}

          <div className="max-h-72 space-y-3 overflow-y-auto rounded-lg border border-app-border bg-app-canvas/30 p-2">
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Layers</p>
              {map.layers.map(layer => (
                <label key={layer.id} className={rowClass}>
                  <input type="checkbox" className={checkboxClass} checked={layers.has(layer.id)} onChange={event => setLayers(toggled(layers, layer.id, event.target.checked))} />
                  <span className="min-w-0 truncate">{layer.name}</span>
                </label>
              ))}
              {map.layers.length === 0 && <p className="px-2 py-1 text-xs text-app-subtle">No layers on this map.</p>}
            </div>
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Pins without a layer</p>
              {unlayeredMarkers.length === 0 && <p className="px-2 py-1 text-xs text-app-subtle">None.</p>}
              {unlayeredMarkers.map(marker => (
                <label key={marker.id} className={rowClass}>
                  <input type="checkbox" className={checkboxClass} checked={markers.has(marker.id)} onChange={event => setMarkers(toggled(markers, marker.id, event.target.checked))} />
                  <span className="min-w-0 truncate">{marker.title}</span>
                </label>
              ))}
            </div>
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Pins on layers</p>
              {childRows("markers")}
            </div>
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Labels and drawings without a layer</p>
              {unlayeredElements.length === 0 && <p className="px-2 py-1 text-xs text-app-subtle">None.</p>}
              {unlayeredElements.map(element => (
                <label key={element.id} className={rowClass}>
                  <input type="checkbox" className={checkboxClass} checked={elements.has(element.id)} onChange={event => setElements(toggled(elements, element.id, event.target.checked))} />
                  <span className="min-w-0 truncate">{elementLabel(element)}</span>
                </label>
              ))}
            </div>
            <div>
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Labels and drawings on layers</p>
              {childRows("elements")}
            </div>
          </div>

          <label className="flex items-start gap-2 rounded-lg border border-app-border bg-app-canvas/40 px-3 py-2 text-xs text-app-text-dim">
            <input type="checkbox" className={checkboxClass} checked={shareImages} onChange={event => setShareImages(event.target.checked)} />
            <span>Also share this map&apos;s images with all campaign players. Publishing a map written on a spoiler image reveals that image.</span>
          </label>

          {state?.imageIssues && state.imageIssues.length > 0 && (
            <div className="rounded-lg border border-primary-700/50 bg-primary-950/20 px-3 py-2 text-xs text-primary-200">
              <p className="font-semibold">Image check</p>
              <ul className="mt-1 list-disc pl-4">{state.imageIssues.map(issue => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => void publish()} disabled={busy || empty} className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-app-on-accent hover:bg-primary-500 disabled:opacity-50"><Send className="h-4 w-4" />{busy ? "Publishing…" : state?.publishedAt ? "Publish changes" : "Publish to players"}</button>
            {state?.publishedAt && <button type="button" onClick={() => void unpublish()} disabled={busy} className="inline-flex items-center gap-2 rounded-lg border border-app-border px-3 py-2 text-sm text-danger-300 hover:bg-app-raised disabled:opacity-50"><Trash2 className="h-4 w-4" />Stop sharing</button>}
            {error && <p role="alert" className="text-sm text-danger-300">{error}</p>}
            {notice && <p role="status" className="flex items-center gap-1 text-xs text-success-300"><Check className="h-3.5 w-3.5" />{notice}</p>}
          </div>

          <ShareResource kind="maps" resourceId={map.id} title={map.title} />
        </>}
      </section>
    </div>
  );
}
