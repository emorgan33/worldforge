# Stock-art bundle

This directory is the reviewed, installable artwork catalog. It is deliberately
outside `public/` and outside `WORLDFORGE_ASSET_DIR`: browsing the catalog never
creates world records or exposes a public file URL.

## Layout

```
manifest.json                 versioned catalog manifest
images/<entry-id>/...webp     normalized full artwork
images/<entry-id>/...thumb.webp
evidence/                     redistributable license/provenance excerpts
```

The catalog currently contains **no approved artwork**. The manifest and
validator are in place; entries are added only after individual rights review
and the collection/placement design review described in
[`docs/stock-art-review/`](../../docs/stock-art-review/README.md).

## Adding an entry

1. Record the item, creator/source chain, license, evidence, and all distribution
   uses in the review record.
2. Normalize the artwork to WebP and generate the thumbnail. Record the original,
   delivered, and thumbnail digests, dimensions, byte sizes, recipe, and any
   modifications in the manifest.
3. Add placement reviews for each supported purpose. Recommended placements must
   have reviewed narrow and wide crops; category artwork must have 16, 24, and
   32px results.
4. Run `pnpm stock-art:validate`.
5. Update the contact sheet and subject-by-placement coverage sheet under
   `docs/stock-art-review/`.

A changed image is a new `version`; existing world copies are never rewritten by
a catalog update. Retired entries keep their tombstone metadata and remain
usable by worlds that already selected them. Disputed entries are not selectable
and require an owner-visible advisory workflow.

The validator checks completeness and consistency. It does not prove ownership,
license validity, or visual quality; recorded human review remains a release
gate.
