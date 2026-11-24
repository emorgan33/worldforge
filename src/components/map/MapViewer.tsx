"use client";
/* Player map images are stored or remote references, not Next-optimized files. */
/* eslint-disable @next/next/no-img-element */

import {
  layerIsVisible,
  paintMapElements,
  parseMapJson,
} from "@/lib/map-rendering";
import type { MapSnapshot } from "@/lib/map-publication";
import { MapMarkerIcon } from "@/components/map/MapMarkerIcon";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Locate, Minus, Plus } from "lucide-react";
import Link from "next/link";

const controlClass = "inline-flex h-10 w-10 items-center justify-center border-app-border text-app-text-dim hover:bg-app-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300";

/**
 * Read-only player map. The snapshot is already limited to the content the GM
 * published, so nothing here can reveal an unpublished layer, pin or drawing.
 */
export function MapViewer({ snapshot, articleLinks = {} }: { snapshot: MapSnapshot; articleLinks?: Record<string, string> }) {
  const [zoom, setZoom] = useState(snapshot.defaultZoom || 1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  const visibleElements = useMemo(
    () => snapshot.elements.filter(element => layerIsVisible(snapshot.layers, element.layerId)),
    [snapshot],
  );
  const visibleMarkers = useMemo(
    () => snapshot.markers.filter(marker => layerIsVisible(snapshot.layers, marker.layerId)),
    [snapshot],
  );
  const labels = useMemo(() => visibleElements.filter(element => element.kind === "LABEL"), [visibleElements]);
  const ink = useMemo(() => visibleElements.filter(element => element.kind !== "LABEL"), [visibleElements]);
  const selected = visibleMarkers.find(marker => marker.id === selectedId) ?? null;

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
      paintMapElements(ctx, cssWidth, cssHeight, ink);
      ctx.globalCompositeOperation = "source-over";
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [ink]);

  function resetView() {
    setZoom(snapshot.defaultZoom || 1);
    setOffset({ x: 0, y: 0 });
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button, a")) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: offset.x, originY: offset.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const active = drag.current;
    if (!active || active.pointerId !== event.pointerId) return;
    setOffset({ x: active.originX + (event.clientX - active.startX), y: active.originY + (event.clientY - active.startY) });
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="overflow-hidden rounded-xl border border-app-border bg-app-canvas">
        <div className="flex flex-wrap items-center gap-2 border-b border-app-border bg-app-surface/80 px-3 py-2">
          <div className="flex overflow-hidden rounded-lg border border-app-border bg-app-canvas">
            <button type="button" onClick={() => setZoom(value => Math.min(4, value + 0.2))} className={controlClass} aria-label="Zoom in"><Plus className="h-4 w-4" /></button>
            <button type="button" onClick={() => setZoom(value => Math.max(0.4, value - 0.2))} className={`${controlClass} border-l`} aria-label="Zoom out"><Minus className="h-4 w-4" /></button>
            <button type="button" onClick={resetView} className={`${controlClass} border-l`} aria-label="Reset view"><Locate className="h-4 w-4" /></button>
          </div>
          <p className="text-xs text-app-subtle">Drag to pan · {Math.round(zoom * 100)}%</p>
        </div>
        <div
          className="relative flex h-[560px] cursor-grab touch-none items-center justify-center overflow-hidden bg-app-canvas active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          data-testid="player-map-viewport"
        >
          <div style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }} className="flex h-full w-full items-center justify-center transition-transform duration-150 ease-out">
            <div
              ref={imageRef}
              className="relative max-h-[92%] w-[min(92%,1100px)] overflow-hidden rounded-lg border border-app-border-strong/60 shadow-2xl"
              style={{ aspectRatio: `${snapshot.width} / ${snapshot.height}` }}
            >
              <img src={snapshot.imageUrl} alt={snapshot.title} draggable={false} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
              <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
              {labels.map(element => {
                const geo = parseMapJson<{ x?: number; y?: number; text?: string }>(element.geometry, {});
                const style = parseMapJson<{ color?: string; fontSize?: number }>(element.style, {});
                return (
                  <span
                    key={element.id}
                    aria-hidden="true"
                    style={{ left: `${geo.x ?? 0}%`, top: `${geo.y ?? 0}%`, color: style.color || "#f8fafc", fontSize: style.fontSize ?? 18 }}
                    className="pointer-events-none absolute z-10 max-w-[40%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap text-left font-semibold drop-shadow"
                  >
                    {geo.text || ""}
                  </span>
                );
              })}
              {visibleMarkers.map(marker => {
                const isSelected = marker.id === selectedId;
                return (
                  <button
                    key={marker.id}
                    type="button"
                    onClick={() => setSelectedId(marker.id)}
                    aria-pressed={isSelected}
                    aria-label={`${marker.title}${marker.description ? `: ${marker.description}` : ""}`}
                    title={marker.title}
                    style={{ left: `${marker.x}%`, top: `${marker.y}%`, backgroundColor: marker.color || "#3b82f6" }}
                    className={`absolute z-20 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-app-on-strong shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-200 ${isSelected ? "border-app-on-strong ring-2 ring-primary-400" : "border-app-on-strong/80"}`}
                  >
                    <MapMarkerIcon name={marker.icon} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <aside aria-label="Map pins" className="rounded-xl border border-app-border bg-app-surface/40 p-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-app-muted">Places</h2>
        {selected ? (
          <section aria-live="polite" className="mt-3 rounded-lg border border-app-border bg-app-canvas/60 p-3">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-primary-300"><MapMarkerIcon name={selected.icon} className="h-4 w-4" /></span>
              <div className="min-w-0">
                <h3 className="font-semibold text-app-text-strong">{selected.title}</h3>
                {selected.description && <p className="mt-1 whitespace-pre-wrap text-sm text-app-muted">{selected.description}</p>}
                {articleLinks[selected.id] && <Link href={articleLinks[selected.id]} className="mt-2 inline-block text-sm text-secondary-300 underline">Read the article</Link>}
              </div>
            </div>
            <button type="button" onClick={() => setSelectedId(null)} className="mt-3 text-xs text-app-subtle hover:text-app-text">Close</button>
          </section>
        ) : (
          <p className="mt-2 text-xs text-app-subtle">Choose a pin to read its notes.</p>
        )}
        <ul className="mt-3 space-y-1">
          {visibleMarkers.map(marker => (
            <li key={marker.id}>
              <button
                type="button"
                onClick={() => setSelectedId(marker.id)}
                aria-pressed={marker.id === selectedId}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300 ${marker.id === selectedId ? "bg-app-raised text-app-text-strong" : "text-app-text-dim hover:bg-app-raised/60"}`}
              >
                <span style={{ color: marker.color || "#3b82f6" }}><MapMarkerIcon name={marker.icon} /></span>
                <span className="min-w-0 truncate">{marker.title}</span>
              </button>
            </li>
          ))}
          {visibleMarkers.length === 0 && <li className="px-2 text-xs text-app-subtle">No pins have been shared yet.</li>}
        </ul>
      </aside>
    </div>
  );
}

/** Static map surface used by the GM's publish preview. */
export function MapPreview({ snapshot }: { snapshot: MapSnapshot }) {
  const ink = snapshot.elements.filter(element => element.kind !== "LABEL" && layerIsVisible(snapshot.layers, element.layerId));
  const labels = snapshot.elements.filter(element => element.kind === "LABEL" && layerIsVisible(snapshot.layers, element.layerId));
  const markers = snapshot.markers.filter(marker => layerIsVisible(snapshot.layers, marker.layerId));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const wrap = imageRef.current;
    if (!canvas || !wrap) return;
    const redraw = () => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (!width || !height) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      paintMapElements(ctx, width, height, ink);
    };
    redraw();
    const observer = new ResizeObserver(redraw);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [ink]);
  return (
    <div ref={imageRef} className="relative w-full overflow-hidden rounded-lg border border-app-border-strong/60" style={{ aspectRatio: `${snapshot.width} / ${snapshot.height}` }}>
      <img src={snapshot.imageUrl} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-cover" />
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
      {labels.map(element => {
        const geo = parseMapJson<{ x?: number; y?: number; text?: string }>(element.geometry, {});
        const style = parseMapJson<{ color?: string; fontSize?: number }>(element.style, {});
        return <span key={element.id} aria-hidden="true" style={{ left: `${geo.x ?? 0}%`, top: `${geo.y ?? 0}%`, color: style.color || "#f8fafc", fontSize: style.fontSize ?? 18 }} className="pointer-events-none absolute z-10 max-w-[40%] -translate-x-1/2 -translate-y-1/2 whitespace-pre-wrap font-semibold drop-shadow">{geo.text || ""}</span>;
      })}
      {markers.map(marker => (
        <span key={marker.id} title={marker.title} style={{ left: `${marker.x}%`, top: `${marker.y}%`, backgroundColor: marker.color || "#3b82f6" }} className="absolute z-20 flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-app-on-strong text-app-on-strong shadow-lg"><MapMarkerIcon name={marker.icon} /></span>
      ))}
    </div>
  );
}
