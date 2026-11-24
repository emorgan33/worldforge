"use client";
import { MAX_PLACEMENT_ALT_LENGTH } from "@/lib/image-placement";

/**
 * Human-readable accessibility control for an image placement.
 *
 * The value is a placement description: `null` leaves the renderer's default
 * (usually the article title), `""` marks the image decorative, and any other
 * value is the author's description. The control avoids exposing database
 * null/empty terminology.
 */
export function PlacementAltField({ id, label, value, onChange, fallback }: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  fallback?: string;
}) {
  const decorative = value === "";
  return <fieldset className="space-y-2 rounded-lg border border-app-border bg-app-surface/40 p-3 text-xs text-app-text-dim">
    <legend className="px-1 font-semibold">{label}</legend>
    <label className="flex min-h-11 cursor-pointer items-center gap-2">
      <input type="checkbox" checked={decorative} onChange={event => onChange(event.target.checked ? "" : null)} />
      <span>Decorative image <span className="text-app-subtle">(no description needed)</span></span>
    </label>
    <label htmlFor={id} className="block">
      Describe this image
      <input
        id={id}
        type="text"
        maxLength={MAX_PLACEMENT_ALT_LENGTH}
        disabled={decorative}
        value={decorative ? "" : value ?? ""}
        placeholder={fallback ? `Uses “${fallback}” when left blank` : "What does the image show?"}
        onChange={event => onChange(event.target.value ? event.target.value : null)}
        className="mt-1 w-full rounded-lg border border-app-border-strong bg-app-canvas px-3 py-2 text-sm text-app-text disabled:opacity-50"
      />
    </label>
    <p className="text-app-subtle">Leave blank to keep the existing description{fallback ? ` (“${fallback}”)` : ""}. Mark the image decorative when it adds no information.</p>
  </fieldset>;
}
