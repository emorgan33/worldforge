export const MAP_ELEMENT_KINDS = ["LABEL", "LINE", "CIRCLE", "RECT", "PATH"] as const;
export type MapElementKind = (typeof MAP_ELEMENT_KINDS)[number];

export type MapPoint = { x: number; y: number };
export type MapGeometry =
  | { x: number; y: number; text: string }
  | { x1: number; y1: number; x2: number; y2: number }
  | { points: MapPoint[] };
export type MapElementStyle = { color?: string; strokeWidth?: number; fontSize?: number; erase?: boolean; [key: string]: unknown };

export class MapElementContractError extends Error {}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function percent(value: unknown, label: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) throw new MapElementContractError(`${label} must be a number.`);
  return Math.max(0, Math.min(100, n));
}

export function normalizeMapGeometry(kind: string, input: unknown): MapGeometry {
  const normalizedKind = kind.toUpperCase();
  if (!MAP_ELEMENT_KINDS.includes(normalizedKind as MapElementKind)) throw new MapElementContractError("Unknown annotation kind.");
  if (!record(input)) throw new MapElementContractError("Geometry must be a JSON object.");
  if (normalizedKind === "LABEL") {
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 2000) throw new MapElementContractError("Labels need text.");
    return { x: percent(input.x, "Label x"), y: percent(input.y, "Label y"), text: input.text };
  }
  if (normalizedKind === "PATH") {
    if (!Array.isArray(input.points) || input.points.length < 2 || input.points.length > 20_000) throw new MapElementContractError("Paths need between 2 and 20000 points.");
    return { points: input.points.map((point, index) => {
      if (!record(point)) throw new MapElementContractError(`Path point ${index + 1} is invalid.`);
      return { x: percent(point.x, "Point x"), y: percent(point.y, "Point y") };
    }) };
  }
  const label = normalizedKind === "LINE" ? "Line" : normalizedKind === "CIRCLE" ? "Circle" : "Rectangle";
  return {
    x1: percent(input.x1, `${label} x1`), y1: percent(input.y1, `${label} y1`),
    x2: percent(input.x2, `${label} x2`), y2: percent(input.y2, `${label} y2`),
  };
}

export function parseMapGeometry(kind: string, serialized: unknown): string {
  if (typeof serialized !== "string" || !serialized.trim() || serialized.length > 1_000_000) throw new MapElementContractError("Geometry is required.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new MapElementContractError("Geometry must be valid JSON."); }
  return JSON.stringify(normalizeMapGeometry(kind, parsed));
}

export function normalizeMapStyle(kind: string, input: unknown): MapElementStyle | null {
  if (input === undefined || input === null || input === "") return null;
  if (!record(input)) throw new MapElementContractError("Style must be a JSON object.");
  const style: MapElementStyle = { ...input };
  if (input.color !== undefined) {
    if (typeof input.color !== "string" || !input.color.trim() || input.color.length > 128 || !/^[\w#(),.%+\-/ ]+$/.test(input.color)) throw new MapElementContractError("Style color must be a CSS color value.");
    style.color = input.color;
  }
  if (input.strokeWidth !== undefined) {
    if (typeof input.strokeWidth !== "number" || !Number.isFinite(input.strokeWidth) || input.strokeWidth < 1 || input.strokeWidth > 48) throw new MapElementContractError("Stroke width must be between 1 and 48.");
    style.strokeWidth = input.strokeWidth;
  }
  if (input.fontSize !== undefined) {
    if (typeof input.fontSize !== "number" || !Number.isFinite(input.fontSize) || input.fontSize < 10 || input.fontSize > 72) throw new MapElementContractError("Font size must be between 10 and 72.");
    style.fontSize = input.fontSize;
  }
  if (input.erase !== undefined) {
    if (typeof input.erase !== "boolean" || (input.erase && kind.toUpperCase() !== "PATH")) throw new MapElementContractError("Eraser style is only valid for PATH elements.");
    style.erase = input.erase;
  }
  return style;
}

export function parseMapStyle(kind: string, serialized: unknown): string | null {
  if (serialized === undefined || serialized === null || serialized === "") return null;
  if (typeof serialized !== "string" || serialized.length > 10_000) throw new MapElementContractError("Style is too large.");
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new MapElementContractError("Style must be valid JSON."); }
  const normalized = normalizeMapStyle(kind, parsed);
  return normalized ? JSON.stringify(normalized) : null;
}

