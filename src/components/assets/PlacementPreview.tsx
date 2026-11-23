"use client";
/* Placement previews reuse the renderer geometry so the preview cannot drift
   from the reader/author placement it represents. */
/* eslint-disable @next/next/no-img-element */
import { CATEGORY_ICON_SIZES, PLACEMENT_GEOMETRY, PLACEMENT_LABELS, type ImagePlacementPurpose } from "@/lib/image-placement";

export interface PlacementRecommendation {
  purpose: ImagePlacementPurpose;
  recommended: boolean;
  rationale: string;
  reviewedCrops: { width: number; height: number; result: "pass" | "fail"; notes?: string }[];
  categorySizes?: { size: 16 | 24 | 32; readable: boolean; notes?: string }[];
}

export function PlacementPreview({ purpose, title, imageUrl, alt = "", recommendation }: {
  purpose: ImagePlacementPurpose;
  title: string;
  imageUrl: string;
  alt?: string;
  recommendation?: PlacementRecommendation | null;
}) {
  return <section aria-label={`In this placement: ${PLACEMENT_LABELS[purpose]}`} className="rounded-lg border border-app-border-strong bg-app-canvas p-3">
    <h4 className="text-xs font-semibold text-app-text">In this placement: {PLACEMENT_LABELS[purpose]}</h4>
    {recommendation && !recommendation.recommended && <p className="mt-1 rounded bg-primary-950/60 px-2 py-1 text-[11px] text-primary-200">Not recommended for this crop. {recommendation.rationale}</p>}
    {purpose === "portrait" ? <div className="mt-3 flex items-end gap-3"><div className={`${PLACEMENT_GEOMETRY.portrait.frameClassName} w-32 shrink-0`}><img src={imageUrl} alt={alt} className={PLACEMENT_GEOMETRY.portrait.imageClassName} /></div><p className="pb-2 text-sm font-semibold text-app-text-strong">{title}</p></div>
      : purpose === "category-icon" ? <div className="mt-3 flex items-end gap-4">{CATEGORY_ICON_SIZES.map(size => <div key={size} className="text-center"><img src={imageUrl} alt={alt} width={size} height={size} style={{ width: size, height: size }} className="mx-auto rounded object-cover" /><span className="mt-1 block text-[10px] text-app-subtle">{size}px</span></div>)}</div>
      : purpose === "body" ? <div className="mt-3 rounded-lg bg-app-surface p-3"><p className="mb-2 text-xs text-app-muted">Article body</p><div className={PLACEMENT_GEOMETRY.body.frameClassName}><img src={imageUrl} alt={alt} className={PLACEMENT_GEOMETRY.body.imageClassName} /></div><p className="mt-2 text-sm text-app-text-dim">Body copy continues beneath the image.</p></div>
      : <div className={`mt-3 ${purpose === "world-cover" ? PLACEMENT_GEOMETRY["world-cover"].frameClassName : PLACEMENT_GEOMETRY["article-cover"].frameClassName}`}><img src={imageUrl} alt={alt} className={PLACEMENT_GEOMETRY[purpose === "world-cover" ? "world-cover" : "article-cover"].imageClassName} /><div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" /><p className="absolute bottom-3 left-3 right-3 text-lg font-bold text-white">{purpose === "background" ? "Page background" : title}</p></div>}
    {purpose === "background" && <p className="mt-2 text-[11px] text-app-subtle">Backgrounds render as a decorative CSS cover behind the reading surface; the image is not described to readers.</p>}
  </section>;
}
