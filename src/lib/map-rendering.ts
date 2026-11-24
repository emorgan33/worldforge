/**
 * Rendering primitives shared by the GM map editor and the read-only player
 * viewer. Geometry is percentage based so the same paint code stays aligned at
 * any display size.
 */
export const MAP_FALLBACK_COLOR = "#eab308";

export interface MapStrokeStyle {
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
  erase?: boolean;
}

export interface MapGeometryJson {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: { x: number; y: number }[];
}

export function parseMapJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T;
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Style values are stored per element; malformed values render as defaults. */
export function strokeStyleFor(style: string | null | undefined): MapStrokeStyle {
  return parseMapJson<MapStrokeStyle>(style, {});
}

export function layerIsVisible(layers: { id: string; isVisible?: boolean }[], layerId?: string | null) {
  if (!layerId) return true;
  const layer = layers.find(item => item.id === layerId);
  return layer ? layer.isVisible !== false : true;
}

export function paintMapStroke(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  kind: string,
  geo: MapGeometryJson,
  style: MapStrokeStyle,
  fallbackColor: string = MAP_FALLBACK_COLOR,
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

export interface PaintedElement {
  id: string;
  kind: string;
  geometry: string;
  style?: string | null;
  order?: number;
  createdAt?: string | Date;
}

/**
 * Paint saved annotations in their stored sequence. Eraser strokes subtract ink,
 * so ink added after an erasure remains visible.
 */
export function paintMapElements(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  elements: PaintedElement[],
) {
  const queue = elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => {
      const byOrder = (a.element.order ?? 0) - (b.element.order ?? 0);
      if (byOrder) return byOrder;
      const aTime = a.element.createdAt ? new Date(a.element.createdAt).getTime() : Number.NaN;
      const bTime = b.element.createdAt ? new Date(b.element.createdAt).getTime() : Number.NaN;
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
      return a.index - b.index;
    });
  for (const { element } of queue) {
    const style = strokeStyleFor(element.style);
    const isErase = !!style.erase;
    ctx.globalCompositeOperation = isErase ? "destination-out" : "source-over";
    paintMapStroke(
      ctx, width, height, element.kind,
      parseMapJson<MapGeometryJson>(element.geometry, {}),
      isErase ? { ...style, color: "#000" } : style,
      MAP_FALLBACK_COLOR,
    );
  }
  ctx.globalCompositeOperation = "source-over";
}
