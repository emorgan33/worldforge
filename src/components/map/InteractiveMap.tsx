"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import React, { useState, useRef } from "react";
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  MapPin,
  Plus,
  Castle,
  Skull,
  Zap,
  Eye,
  X,
  ExternalLink,
} from "lucide-react";

interface MarkerItem {
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
  article?: {
    id: string;
    title: string;
    template: string;
    excerpt?: string | null;
    portraitImage?: string | null;
  } | null;
}

interface LayerItem {
  id: string;
  name: string;
  order: number;
  isVisible: boolean;
}

interface MapProps {
  mapData: {
    id: string;
    title: string;
    description?: string | null;
    imageUrl: string;
    width: number;
    height: number;
    layers: LayerItem[];
    markers: MarkerItem[];
  };
  onSelectArticle?: (articleId: string) => void;
  onAddMarker?: (marker: Partial<MarkerItem>) => void;
  onGuardChange?: (registration: { dirty: boolean; busy: boolean } | null) => void;
}

export function InteractiveMap({ mapData, onSelectArticle, onAddMarker, onGuardChange }: MapProps) {
  const [zoom, setZoom] = useState(1.0);
  const [activeLayers, setActiveLayers] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    mapData.layers.forEach((l) => (initial[l.id] = l.isVisible));
    return initial;
  });
  const [selectedMarker, setSelectedMarker] = useState<MarkerItem | null>(null);
  const [isAddingPin, setIsAddingPin] = useState(false);
  const [newPinCoord, setNewPinCoord] = useState<{ x: number; y: number } | null>(null);
  const [newPinTitle, setNewPinTitle] = useState("");
  const [newPinDesc, setNewPinDesc] = useState("");

  useWorldGuard({ dirty: !!newPinTitle || !!newPinDesc, busy: false }, "map", onGuardChange);

  const mapContainerRef = useRef<HTMLDivElement>(null);

  const toggleLayer = (layerId: string) => {
    setActiveLayers((prev) => ({ ...prev, [layerId]: !prev[layerId] }));
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isAddingPin) {
      setSelectedMarker(null);
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    setNewPinCoord({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  };

  const handleCreatePin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPinCoord || !newPinTitle.trim() || !onAddMarker) return;

    onAddMarker({
      mapId: mapData.id,
      title: newPinTitle,
      description: newPinDesc,
      x: newPinCoord.x,
      y: newPinCoord.y,
      color: "#3b82f6",
      icon: "map-pin",
    });

    setIsAddingPin(false);
    setNewPinCoord(null);
    setNewPinTitle("");
    setNewPinDesc("");
  };

  const getPinIcon = (iconName?: string | null) => {
    switch (iconName?.toLowerCase()) {
      case "castle":
        return <Castle className="w-3.5 h-3.5" />;
      case "skull":
        return <Skull className="w-3.5 h-3.5" />;
      case "zap":
        return <Zap className="w-3.5 h-3.5" />;
      case "eye":
        return <Eye className="w-3.5 h-3.5" />;
      default:
        return <MapPin className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="relative w-full h-[620px] bg-zinc-950 rounded-xl overflow-hidden border border-zinc-800 shadow-2xl flex flex-col select-none">
      {/* Top Map Control Bar */}
      <div className="absolute top-4 left-4 right-4 z-20 flex items-center justify-between pointer-events-none">
        <div className="bg-zinc-900/90 backdrop-blur-md border border-zinc-800 px-4 py-2 rounded-lg shadow-xl pointer-events-auto">
          <h3 className="font-semibold text-zinc-100 text-sm tracking-wide flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            {mapData.title}
          </h3>
          {mapData.description && (
            <p className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{mapData.description}</p>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pointer-events-auto">
          {/* Layer Panel */}
          <div className="group relative">
            <button className="flex items-center gap-1.5 px-3 py-2 bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 text-xs font-medium rounded-lg border border-zinc-800 backdrop-blur-md shadow-xl transition-all">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Layers</span>
            </button>

            <div className="absolute right-0 mt-2 w-56 p-2 bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all space-y-1">
              <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider px-2 py-1">
                Visible Map Layers
              </div>
              {mapData.layers.map((layer) => (
                <label
                  key={layer.id}
                  className="flex items-center gap-2.5 px-2 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={activeLayers[layer.id] ?? true}
                    onChange={() => toggleLayer(layer.id)}
                    className="rounded border-zinc-700 bg-zinc-800 text-indigo-500 focus:ring-0"
                  />
                  <span>{layer.name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Place Pin Toggle */}
          <button
            onClick={() => {
              setIsAddingPin(!isAddingPin);
              setNewPinCoord(null);
            }}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border shadow-xl transition-all ${
              isAddingPin
                ? "bg-amber-500 text-black border-amber-400 font-semibold shadow-amber-500/20"
                : "bg-zinc-900/90 hover:bg-zinc-800 text-zinc-300 border-zinc-800 backdrop-blur-md"
            }`}
          >
            <Plus className="w-4 h-4" />
            <span>{isAddingPin ? "Click Map to Pin" : "Add Pin"}</span>
          </button>

          {/* Zoom In / Out */}
          <div className="flex items-center bg-zinc-900/90 border border-zinc-800 rounded-lg shadow-xl backdrop-blur-md overflow-hidden">
            <button
              onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}
              className="p-2 hover:bg-zinc-800 text-zinc-300 transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom((z) => Math.max(0.6, z - 0.2))}
              className="p-2 hover:bg-zinc-800 text-zinc-300 transition-colors border-l border-zinc-800"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom(1.0)}
              className="p-2 hover:bg-zinc-800 text-zinc-300 transition-colors border-l border-zinc-800"
              title="Reset View"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Map Surface Viewport */}
      <div
        ref={mapContainerRef}
        onClick={handleMapClick}
        className={`relative w-full h-full overflow-hidden flex items-center justify-center bg-zinc-950 ${
          isAddingPin ? "cursor-crosshair" : "cursor-grab"
        }`}
      >
        <div
          style={{
            transform: `scale(${zoom})`,
            transition: "transform 0.15s ease-out",
          }}
          className="relative w-full h-full flex items-center justify-center"
        >
          {/* Map Base Texture / Canvas */}
          <div
            className="relative w-[90%] h-[90%] max-w-[1200px] max-h-[700px] rounded-lg shadow-2xl overflow-hidden border border-zinc-700/60"
            style={{
              backgroundImage: `url(${mapData.imageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          >
            {/* Subtle Vignette Overlay */}
            <div className="absolute inset-0 bg-radial-gradient from-transparent via-transparent to-black/40 pointer-events-none" />

            {/* Pins / Markers */}
            {mapData.markers
              .filter((m) => !m.layerId || activeLayers[m.layerId] !== false)
              .map((marker) => (
                <button
                  key={marker.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedMarker(marker);
                  }}
                  style={{
                    left: `${marker.x}%`,
                    top: `${marker.y}%`,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 group z-10 transition-transform hover:scale-125 focus:outline-none"
                >
                  <div
                    style={{ backgroundColor: marker.color || "#3b82f6" }}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white shadow-lg border-2 border-white/80 ring-2 ring-black/40"
                  >
                    {getPinIcon(marker.icon)}
                  </div>
                  {/* Tooltip Label */}
                  <div className="absolute top-8 left-1/2 -translate-x-1/2 whitespace-nowrap px-2 py-0.5 rounded bg-zinc-900/95 text-zinc-200 border border-zinc-700 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity shadow-xl pointer-events-none">
                    {marker.title}
                  </div>
                </button>
              ))}

            {/* New Pin Coordinate Indicator */}
            {newPinCoord && (
              <div
                style={{
                  left: `${newPinCoord.x}%`,
                  top: `${newPinCoord.y}%`,
                }}
                className="absolute -translate-x-1/2 -translate-y-1/2 z-30"
              >
                <div className="w-8 h-8 rounded-full bg-amber-500 text-black flex items-center justify-center animate-bounce shadow-2xl border-2 border-white">
                  <MapPin className="w-4 h-4" />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Selected Marker Detail Card */}
      {selectedMarker && (
        <div className="absolute bottom-6 left-6 z-30 w-80 bg-zinc-900/95 backdrop-blur-md border border-zinc-700/80 rounded-xl p-4 shadow-2xl text-zinc-200 animate-in fade-in slide-in-from-bottom-4 duration-200">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div
                style={{ backgroundColor: selectedMarker.color || "#3b82f6" }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-white"
              >
                {getPinIcon(selectedMarker.icon)}
              </div>
              <h4 className="font-semibold text-sm text-zinc-100">{selectedMarker.title}</h4>
            </div>
            <button
              onClick={() => setSelectedMarker(null)}
              className="text-zinc-500 hover:text-zinc-300 p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {selectedMarker.description && (
            <p className="text-xs text-zinc-300 mt-2 leading-relaxed">{selectedMarker.description}</p>
          )}

          {selectedMarker.article && (
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-1">
                Linked Article
              </div>
              <div className="flex items-center gap-3">
                {selectedMarker.article.portraitImage && (
                  <img
                    src={selectedMarker.article.portraitImage}
                    alt={selectedMarker.article.title}
                    className="w-10 h-10 rounded object-cover border border-zinc-700"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-zinc-100 truncate">
                    {selectedMarker.article.title}
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase">
                    {selectedMarker.article.template}
                  </div>
                </div>
              </div>

              {onSelectArticle && (
                <button
                  onClick={() => onSelectArticle(selectedMarker.article!.id)}
                  className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-colors"
                >
                  <span>Open Full Article</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Add Pin Modal Form */}
      {isAddingPin && newPinCoord && (
        <div className="absolute bottom-6 right-6 z-30 w-80 bg-zinc-900 border border-amber-500/50 rounded-xl p-4 shadow-2xl text-zinc-200">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              New Pin at ({newPinCoord.x}%, {newPinCoord.y}%)
            </h4>
            <button
              onClick={() => setNewPinCoord(null)}
              className="text-zinc-500 hover:text-zinc-300"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleCreatePin} className="mt-3 space-y-3">
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Pin Title</label>
              <input
                type="text"
                required
                value={newPinTitle}
                onChange={(e) => setNewPinTitle(e.target.value)}
                placeholder="e.g. Ancient Dragon Cavern"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="block text-[11px] text-zinc-400 mb-1">Description (Optional)</label>
              <textarea
                value={newPinDesc}
                onChange={(e) => setNewPinDesc(e.target.value)}
                rows={2}
                placeholder="Notable landmarks, hazards, or lore..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
              />
            </div>
            <button
              type="submit"
              className="w-full py-1.5 text-xs font-semibold rounded bg-amber-500 hover:bg-amber-400 text-black shadow-md transition-colors"
            >
              Save Pin to Map
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
