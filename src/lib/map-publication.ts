import { isImageReference } from "./assets";

/**
 * The player-facing map projection. A GM publishes an explicit selection of
 * layers, pins and annotations; the snapshot is what campaign readers receive.
 * Editing a map afterwards does not change the snapshot until the GM publishes
 * again.
 */
export const MAP_SNAPSHOT_VERSION = 1 as const;

export const MAP_ELEMENT_KINDS = ["LABEL", "LINE", "CIRCLE", "RECT", "PATH"] as const;

export interface PublishedMapLayer {
  id: string;
  name: string;
  order: number;
  imageUrl: string | null;
}

export interface PublishedMapMarker {
  id: string;
  layerId: string | null;
  title: string;
  description: string | null;
  x: number;
  y: number;
  icon: string | null;
  color: string | null;
  /** Kept as an ID only; each reader resolves whether the article is readable. */
  articleId: string | null;
}

export interface PublishedMapElement {
  id: string;
  layerId: string | null;
  kind: string;
  geometry: string;
  style: string | null;
  order: number;
}

export interface MapSnapshot {
  version: typeof MAP_SNAPSHOT_VERSION;
  title: string;
  description: string | null;
  imageUrl: string;
  width: number;
  height: number;
  defaultZoom: number;
  layers: PublishedMapLayer[];
  markers: PublishedMapMarker[];
  elements: PublishedMapElement[];
}

export interface MapSelection {
  layers: string[];
  markers: string[];
  elements: string[];
}

export interface PublicationSource {
  title: string;
  description?: string | null;
  imageUrl: string;
  width: number;
  height: number;
  defaultZoom?: number | null;
  layers: { id: string; name: string; order: number; imageUrl?: string | null }[];
  markers: {
    id: string;
    layerId?: string | null;
    title: string;
    description?: string | null;
    x: number;
    y: number;
    icon?: string | null;
    color?: string | null;
    articleId?: string | null;
  }[];
  elements: {
    id: string;
    layerId?: string | null;
    kind: string;
    geometry: string;
    style?: string | null;
    order?: number;
  }[];
}

export const SELECTION_LIMITS = { layers: 500, markers: 5_000, elements: 20_000 } as const;

const idPattern = /^[A-Za-z0-9._:-]{1,200}$/;

function uniqueIds(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !idPattern.test(entry)) throw new Error("Choose valid map items to publish.");
    ids.add(entry);
    if (ids.size > limit) throw new Error("Too many map items were selected to publish.");
  }
  return [...ids];
}

/** Normalize and bound the selection sent by the author workspace. */
export function normalizeSelection(input: { layers?: unknown; markers?: unknown; elements?: unknown }): MapSelection {
  return {
    layers: uniqueIds(input.layers, SELECTION_LIMITS.layers),
    markers: uniqueIds(input.markers, SELECTION_LIMITS.markers),
    elements: uniqueIds(input.elements, SELECTION_LIMITS.elements),
  };
}

/**
 * Build the snapshot from the current map, keeping only selected layers and the
 * pins/annotations the reader may see. Items attached to an unselected layer
 * are dropped: a hidden layer must never leak through an individually selected
 * child.
 */
export function buildMapSnapshot(source: PublicationSource, selection: MapSelection): MapSnapshot {
  const layerIds = new Set(selection.layers);
  const markerIds = new Set(selection.markers);
  const elementIds = new Set(selection.elements);
  const layers = source.layers
    .filter(layer => layerIds.has(layer.id))
    .sort((a, b) => a.order - b.order)
    .map(layer => ({ id: layer.id, name: layer.name, order: layer.order, imageUrl: layer.imageUrl ?? null }));
  const readableLayer = (layerId: string | null) => layerId === null || layerIds.has(layerId);
  const markers = source.markers
    .filter(marker => markerIds.has(marker.id) && readableLayer(marker.layerId ?? null))
    .map(marker => ({
      id: marker.id,
      layerId: marker.layerId ?? null,
      title: marker.title,
      description: marker.description ?? null,
      x: marker.x,
      y: marker.y,
      icon: marker.icon ?? null,
      color: marker.color ?? null,
      articleId: marker.articleId ?? null,
    }));
  const elements = source.elements
    .filter(element => elementIds.has(element.id) && readableLayer(element.layerId ?? null))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(element => ({
      id: element.id,
      layerId: element.layerId ?? null,
      kind: element.kind,
      geometry: element.geometry,
      style: element.style ?? null,
      order: element.order ?? 0,
    }));
  return {
    version: MAP_SNAPSHOT_VERSION,
    title: source.title,
    description: source.description ?? null,
    imageUrl: source.imageUrl,
    width: source.width,
    height: source.height,
    defaultZoom: source.defaultZoom ?? 1,
    layers,
    markers,
    elements,
  };
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function percentage(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

/**
 * Parse a stored snapshot defensively. Unknown versions, missing required
 * fields, or malformed records are rejected rather than partially rendered.
 */
export function parseMapSnapshot(value: string | null | undefined): MapSnapshot | null {
  if (!value) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const raw = parsed as Record<string, unknown>;
  if (raw.version !== MAP_SNAPSHOT_VERSION) return null;
  const title = text(raw.title, 200);
  const imageUrl = text(raw.imageUrl, 2048);
  const width = typeof raw.width === "number" && Number.isInteger(raw.width) && raw.width > 0 ? raw.width : null;
  const height = typeof raw.height === "number" && Number.isInteger(raw.height) && raw.height > 0 ? raw.height : null;
  if (!title || !imageUrl || !isImageReference(imageUrl) || !width || !height) return null;
  const defaultZoom = typeof raw.defaultZoom === "number" && raw.defaultZoom >= 0.1 && raw.defaultZoom <= 5 ? raw.defaultZoom : 1;
  if (!Array.isArray(raw.layers) || !Array.isArray(raw.markers) || !Array.isArray(raw.elements)) return null;

  const layers: PublishedMapLayer[] = [];
  for (const entry of raw.layers) {
    if (!entry || typeof entry !== "object") return null;
    const layer = entry as Record<string, unknown>;
    const id = text(layer.id, 200);
    const name = text(layer.name, 200);
    const order = typeof layer.order === "number" && Number.isFinite(layer.order) ? layer.order : 0;
    const layerImage = layer.imageUrl === null || layer.imageUrl === undefined ? null : text(layer.imageUrl, 2048);
    if (!id || !name || (layerImage !== null && !isImageReference(layerImage))) return null;
    layers.push({ id, name, order, imageUrl: layerImage });
  }

  const layerIds = new Set(layers.map(layer => layer.id));
  const markers: PublishedMapMarker[] = [];
  for (const entry of raw.markers) {
    if (!entry || typeof entry !== "object") return null;
    const marker = entry as Record<string, unknown>;
    const id = text(marker.id, 200);
    const titleValue = text(marker.title, 200);
    const x = percentage(marker.x);
    const y = percentage(marker.y);
    const layerId = marker.layerId === null || marker.layerId === undefined ? null : text(marker.layerId, 200);
    if (!id || !titleValue || x === null || y === null || (layerId !== null && !layerIds.has(layerId))) return null;
    const description = marker.description === null || marker.description === undefined ? null : text(marker.description, 2000);
    if (description === null && marker.description != null) return null;
    markers.push({
      id, layerId, title: titleValue, description, x, y,
      icon: text(marker.icon, 100),
      color: text(marker.color, 100),
      articleId: text(marker.articleId, 200),
    });
  }

  const elements: PublishedMapElement[] = [];
  for (const entry of raw.elements) {
    if (!entry || typeof entry !== "object") return null;
    const element = entry as Record<string, unknown>;
    const id = text(element.id, 200);
    const kind = text(element.kind, 20);
    const geometry = text(element.geometry, 2_000_000);
    const style = element.style === null || element.style === undefined ? null : text(element.style, 100_000);
    const layerId = element.layerId === null || element.layerId === undefined ? null : text(element.layerId, 200);
    if (!id || !kind || !(MAP_ELEMENT_KINDS as readonly string[]).includes(kind) || !geometry) return null;
    if (style === null && element.style != null) return null;
    if (layerId !== null && !layerIds.has(layerId)) return null;
    const order = typeof element.order === "number" && Number.isFinite(element.order) ? element.order : 0;
    elements.push({ id, layerId, kind, geometry, style, order });
  }

  return {
    version: MAP_SNAPSHOT_VERSION,
    title,
    description: raw.description === null || raw.description === undefined ? null : text(raw.description, 2000),
    imageUrl, width, height, defaultZoom, layers, markers, elements,
  };
}

/** Recover the GM's selection from a stored snapshot for the share panel. */
export function snapshotSelection(snapshot: MapSnapshot): MapSelection {
  return {
    layers: snapshot.layers.map(layer => layer.id),
    markers: snapshot.markers.map(marker => marker.id),
    elements: snapshot.elements.map(element => element.id),
  };
}

/** Every image reference in a snapshot; readers must verify each one. */
export function snapshotImageReferences(snapshot: MapSnapshot): string[] {
  return [snapshot.imageUrl, ...snapshot.layers.map(layer => layer.imageUrl)].filter((url): url is string => !!url);
}
