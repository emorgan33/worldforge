# Candidate stock art (review staging, not shipped)

Status: **preliminary, awaiting human sign-off.** These candidates are staged for
the slice-1 curation gate described in
[`docs/feature-requests/curated-stock-art-library.md`](../../feature-requests/curated-stock-art-library.md).
Nothing in this directory ships at runtime. The live catalog is
`resources/stock-art/manifest.json`, which is still empty.

## What is here

- `manifest.json` — a staging manifest, produced with
  `pnpm stock-art:validate docs/stock-art-review/candidates`. It exists to prove
  the candidates satisfy the catalog contract (digests, crops, allowed uses,
  rights evidence), **not** to approve them.
- `ingest-summary.json` — machine record of the download/normalization step:
  Met Open Access object IDs, source URLs, digests, and dimensions.
- `images/<entry>/1.webp` and `1.thumb.webp` — normalized candidate bytes.
- `evidence/*.txt` — captured Met Open Access object metadata for each item.
- `crops/*-narrow.jpg` (360×600) and `*-wide.jpg` (960×432) — the review-only
  crop cases referenced by the manifest.
- `README.md` — this file.

## Provenance

Every candidate is a public-domain work from The Metropolitan Museum of Art,
retrieved through the Met Open Access API (`/public/collection/v1/objects/{id}`)
on 2026-10-23. The Met dedicates public-domain images under CC0 1.0. The
`rights.evidence.reviewer` and `reviewer` fields in the staging manifest read
`PENDING HUMAN REVIEW` on purpose: a machine check is not a rights sign-off.

## Before these become the live catalog

1. A human reviewer confirms licence, attribution text, and visual/placement
   decisions, then replaces `PENDING HUMAN REVIEW` with their name and date.
2. Approved entries are copied to `resources/stock-art/images/<entry>/` and
   merged into `resources/stock-art/manifest.json`; this staging copy is not
   referenced at runtime.
3. `pnpm stock-art:validate` passes against the live root, and the review sheets
   (contact sheet, coverage sheet, brief) record the admitted subset and the
   rejections.

Do not delete this directory while the review is open: the evidence files are the
supporting material for the entries that do get admitted.
