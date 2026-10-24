/**
 * Shared image-placement vocabulary and geometry.
 *
 * Previews, author controls and reader renderers all describe placement with
 * these purposes so fitting rules cannot drift between them. Placement
 * descriptions are stored as nullable text: `null` keeps the renderer's legacy
 * fallback, `""` explicitly marks decorative art, and any other value is the
 * author's placement-specific description.
 */
export const IMAGE_PLACEMENT_PURPOSES = ["body", "portrait", "world-cover", "article-cover", "background", "category-icon"] as const;
export type ImagePlacementPurpose = (typeof IMAGE_PLACEMENT_PURPOSES)[number];

export const PLACEMENT_LABELS: Record<ImagePlacementPurpose, string> = {
  body: "Body image",
  portrait: "Portrait",
  "world-cover": "World cover",
  "article-cover": "Article cover",
  background: "Page background",
  "category-icon": "Category illustration",
};

/** Purposes where the image conveys information and therefore needs a description. */
export const INFORMATIVE_PLACEMENTS: ImagePlacementPurpose[] = ["body", "portrait", "world-cover", "article-cover"];

export const CATEGORY_ICON_SIZES = [16, 24, 32] as const;

export const MAX_PLACEMENT_ALT_LENGTH = 300;

/** Renderer geometry keyed by purpose. `fit` documents contain vs cover fitting. */
export const PLACEMENT_GEOMETRY: Record<Exclude<ImagePlacementPurpose, "background" | "category-icon">, { frameClassName: string; imageClassName: string; fit: "contain" | "cover" }> = {
  "article-cover": { frameClassName: "relative h-64 w-full overflow-hidden rounded-2xl border border-zinc-800 shadow-2xl md:h-80", imageClassName: "h-full w-full object-cover", fit: "cover" },
  "world-cover": { frameClassName: "relative h-64 w-full overflow-hidden rounded-xl border border-zinc-800", imageClassName: "h-64 w-full object-cover", fit: "cover" },
  portrait: { frameClassName: "overflow-hidden rounded-xl border border-zinc-800", imageClassName: "h-64 w-full object-cover", fit: "cover" },
  body: { frameClassName: "w-full overflow-hidden rounded-lg", imageClassName: "max-h-96 w-full object-contain", fit: "contain" },
};

/**
 * Resolve an image's alt text for a placement. A null/undefined description
 * keeps the caller's legacy fallback; an empty string is decorative.
 */
export function resolvePlacementAlt(alt: string | null | undefined, fallback = ""): string {
  if (alt === null || alt === undefined) return fallback;
  return alt;
}

export function isDecorativePlacementAlt(alt: string | null | undefined): boolean {
  return alt === "";
}

/** Validate a placement description supplied over the API. */
export function validatePlacementAlt(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return "An image description must be text.";
  if (value.length > MAX_PLACEMENT_ALT_LENGTH) return `Keep the image description under ${MAX_PLACEMENT_ALT_LENGTH} characters.`;
  return null;
}

/** Normalize a validated placement description for storage. */
export function normalizePlacementAlt(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return null;
  return value;
}
