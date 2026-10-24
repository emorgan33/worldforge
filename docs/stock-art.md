# Curated stock art

WorldForge supports an optional local fantasy art catalog. Authors browse
it from the existing image picker, inspect its source and rights information,
preview the intended placement, and deliberately copy an image into a world.
Selecting artwork creates an ordinary world-scoped image with durable
provenance; it does not create a global public file or grant player access.

Status: **catalog contract, durable selection, picker/placement integration,
reader credits, portable export/import and advisory tooling implemented; no
artwork approved**. Eight candidates are installed in the development catalog
(`2026-10-23.live-review-state`); all record `reviewStatus: "pending"` and
`PENDING HUMAN REVIEW`. They are selectable in development, labelled **Pending
human review — not verified**, and excluded from production selection. The
[implementation corrections](stock-art-review/fixes-2026-10-23.md) address the
previous review findings. Keep stock selection out of a released build until
the rights/design review and the release-verification gates in
[`stock-art-review/README.md`](stock-art-review/README.md) are complete.

## Terminology

- **World images** — images whose bytes belong to the current world. It includes
  uploads and previously selected stock, with **All saved / Uploaded / Stock**
  filters.
- **Stock art** — entries in the installed catalog. Browsing stock art
  does not create world records.
- **Added to this world** — the artwork's bytes are already stored for this
  world. It does not mean shared with players.
- **Reviewed catalog provenance** — bytes matched an explicitly approved
  manifest entry with a named reviewer/date. **Pending human review — not verified**
  is development-only provenance with no completed sign-off.
  **Imported provenance — not verified** is a claim preserved
  from an import, not a WorldForge rights review.
- **Retired** — removed from new selection, but already selected copies keep
  working. **Disputed** — not selectable, with an owner-visible advisory for
  affected copies. Retirement is not a rights restriction.

Source (uploaded/stock), saved state, and audience access are separate concepts.
Selecting stock art never silently shares it with players.

## Catalog bundle

The reviewed catalog lives in `resources/stock-art/`:

```
manifest.json
images/<entry-id>/<version>.webp
images/<entry-id>/<version>.thumb.webp
evidence/<redistributable-evidence>
```

It is outside `public/` and outside `WORLDFORGE_ASSET_DIR`. The application reads
these local files; it never fetches a source URL while browsing or selecting.
`WORLDFORGE_STOCK_ART_DIR` may point the validator and runtime at an installed
catalog in another location.

The manifest records, per entry:

- stable identity and version, collection, title, subjects, style tags, search
  terms, and default alt text;
- visual placement reviews with narrow/wide crop results and 16/24/32px results
  for category artwork, separate from allowed uses;
- creator, durable source item, original filename, and acquisition date;
- exact license/public-domain basis, evidence file and digest, reviewer, and
  review date;
- explicit allowed/prohibited outcomes for application bundling, standalone
  redistribution, world export, modification, and public display;
- credit text, links, required placement, and modification notice;
- original/delivered/thumbnail digests, dimensions, sizes, normalization recipe,
  and recorded modifications;
- available/retired/disputed lifecycle state, reason, date, and optional
  replacement entry.

An entry is immutable once released. A changed image is a new version; catalog
updates never rewrite titles, alt text, bytes, or selections in existing worlds.
Only entries with every distribution use explicitly allowed can be `available`.
Unknown is not approval. Production selection additionally requires
`rights.reviewStatus: "approved"` and a non-placeholder reviewer/date. Missing
review status is treated as pending; a nonempty reviewer string alone does not
approve artwork. After a human completes review, record the explicit status,
reviewer/date and evidence, then bump `catalogRevision`.

## Validation

```bash
pnpm stock-art:validate [catalog-directory]
```

The validator checks the schema and duplicate identities, confined bundle paths,
required review fields, allowed-use gates, file hashes, WebP decode limits,
dimensions and byte sizes, credit/license links, evidence digests, supported
purpose values, and placement review completeness. It does not prove ownership,
license validity, or visual quality. Recorded human rights and design review
remain release gates.

Curation evidence — collection briefs, contact sheets, subject-by-placement
coverage sheets, and final screenshots — lives in
[`stock-art-review/`](stock-art-review/README.md).

## Durable selection

`POST /api/worlds/[id]/stock-art` accepts only an entry ID and version. It
checks ownership, world activity, current availability, bundle integrity, and
then copies the integrity-checked WebP bytes into world-asset storage. `ImageAsset.source`
becomes `STOCK`, and an `ImageAssetProvenance` row snapshots the catalog
manifest entry with its `manifestDigest` and `verificationOrigin`. Existing
`(worldId, sha256)` deduplication is preserved: matching bytes reuse the image
and append provenance without overwriting author-edited title or alt text, so
repeated selection is idempotent. Concurrent inserts re-read the winning row and
queue cleanup for a losing file.

Ordinary asset PATCH requests cannot modify or erase provenance. `source`
(acquisition), saved state, provenance verification, and audience access are
independent.

New provenance defaults to `PENDING_REVIEW`; selection writes `BUNDLED_REVIEW`
only for explicit approved records. The `20261023200000_pending_stock_review`
migration corrects legacy review labels without changing stored snapshots,
image bytes, or imported declarations. Projections and exports also treat old
snapshots lacking explicit approval as pending. Run `pnpm db:deploy`, regenerate
Prisma, rebuild and restart to apply the correction to an existing installation.

## Selection APIs

| Endpoint | Behavior |
| --- | --- |
| `GET /api/worlds/[id]/stock-art` | Bounded search and collection/subject/style filters, validated `purpose` and `recommendedOnly`, deterministic pagination, available entries with safe summaries, saved state, and catalog revision/collections/subjects/styles. |
| `GET /api/worlds/[id]/stock-art/[entryId]/[version]` | Owner-only details: creator, source, rights evidence, allowed uses, derivatives, exact attribution, and placement reviews. |
| `GET /api/worlds/[id]/stock-art/[entryId]/[version]/preview` | Author-only WebP thumbnail or full preview, integrity-checked, `nosniff`, `private, no-store`. |
| `POST /api/worlds/[id]/stock-art` | Copies an entry into the world and returns an `ImageAssetItem` plus a reuse flag. It never grants audience access. |

`GET /api/assets` accepts `source=all|uploaded|stock|imported`, applied before
pagination. Source is derived from persisted acquisition/provenance records, not
filenames or catalog availability.

## Picker integration

The shared picker opens on **World images** with **All saved / Uploaded /
Stock** filters, a prominent upload action, a side inspector on wide screens,
and a mobile detail view with **Back to results** that restores the query,
filters, scroll position, and card focus. The **Stock art** tab defaults to
artwork recommended for the caller's placement purpose, with **Browse all
artwork** for other reviewed entries. Inspection shows full artwork, an
in-placement preview using the renderer's sizing, exact credit, provenance
status, and a single **Use image** action. Selection failures keep the preview
and offer retry; catalog failures offer **Use world images**.

## Placement completeness

Placement vocabulary and geometry live in `src/lib/image-placement.ts` so the
picker preview, author controls and renderers share one definition of each
purpose (`body`, `portrait`, `world-cover`, `article-cover`, `background`,
`category-icon`). `PlacementPreview` renders the stock-art in-placement preview
with the same fitting classes the readers use.

Placement descriptions are stored separately from `ImageAsset.alt`:

- `Article.coverImageAlt` / `Article.portraitImageAlt`
- `World.coverImageAlt` / `World.bannerImageAlt`

A `null` description keeps the renderer's legacy fallback (the article or world
title); an empty string marks the art decorative; any other value is the
author's placement-specific description. `ArticleRevision` snapshots the cover
and portrait URLs and descriptions, so restoring history restores the placement.
Local drafts (`ArticleSaveInput`) carry the same fields, and cloning copies them.
The editor and world settings expose **Describe this image** and **Decorative
image** controls instead of null/empty terminology; selecting new informative
stock art suggests its default alt but never rewrites an existing description.
Author, public, and campaign readers use the same description semantics. When a
global article cover supplies the fallback image, its description supplies the
fallback too; a stale article-specific description is not attached to it.

Category illustrations use a separate nullable `Category.iconImage` referencing
a managed image in the same world; the interface `Category.icon` identifier and
the folder fallback are unchanged. Author and reader trees show the illustration
beside the category name with empty alt, keeping the name and disclosure control
as the accessible label. `PATCH /api/categories` with `action: "setIconImage"`
accepts a library URL or `null` and rejects external URLs.

## Reader credits and reference integrity

Reader credit projection lives in `src/lib/stock-credits.ts` and the renderer in
`src/components/public/ReaderImageCredits.tsx`. `parseCreditSnapshot` decodes the
catalog snapshot stored with each asset's provenance; uploads and malformed
historical snapshots produce no invented credit; new imports reject unusable
snapshots before storing an image. Public/campaign pages collect image IDs from
the actual readable cover, portrait, body, background and displayed categories.
Every applicable provenance record is retained; deduplication includes its
title, links, modifications, placement and review origin. Credits include
creator/source/license links and modification notices, and body/cover/portrait
requirements marked `adjacent` render beneath the figure. Every credit is also
listed in **Artwork credits**. Text wraps at narrow widths.

Reader category illustrations follow the same publication/visibility rules as
article images. `ReaderCategoryTree` renders the authorized image with empty alt
and falls back to the labelled folder icon when the image is absent, private or
fails to load, so no private URL or broken-image glyph reaches the reader.

Every persistent reference to an image is scanned exhaustively by
`src/lib/asset-references.ts`. The scan covers world cover, banner and
background, category illustrations, article covers, portraits and parsed
bodies, revision snapshots, map canvases, map layers and timeline covers.
`GET /api/assets/[id]/usage` and permanent deletion use the same reference
model, and world cleanup uses its world-wide collector. Archived images that
remain placed keep working; permanent deletion is blocked until every
persistent reference is removed. Article bytes are anonymously fetchable only
while a placement appears in the public reader projection; publication and
visibility revocation removes both the credit and the response from
`/api/assets/[id]/file`.

## Portable export/import (format 3)

Image bytes leave the server only through world export. `src/lib/world-export.ts`
builds format 3, `GET /api/worlds/[id]/export` defaults to it, and the Manage
worlds export button uses the default. Format 3 extends format 2 with image
`source`, `displayRestricted`/`restrictionReason`/`restrictionDate`, the
provenance snapshot list, per-placement alt text (`World.coverImageAlt` /
`bannerImageAlt`, `Article.coverImageAlt` / `portraitImageAlt`, revision
snapshots) and `Category.iconImage`, on top of the existing bytes, members,
audience policies and audit sections.

Format 3 is defined as the complete owner backup. It rejects the filtering flags
`includeAssets` and `includePrivate` with a `400` rather than silently ignoring
them, so a partial export is never mistaken for a complete backup.

Legacy formats stay available for worlds that can be represented losslessly:
`?format=v1` supports filtering. Format 2, like format 3, is a complete backup
and rejects `includeAssets`/`includePrivate` flags explicitly. Both keep their older shapes, but
`worldNeedsV3()` refuses a legacy export when the world has provenance,
restrictions or placement data that the legacy shape would drop, with guidance to
use format 3. The guard checks placement data in retained revisions as well as
current content, including explicit decorative empty descriptions.

On import, provenance is validated before any write: entry id, version, digest
and a bounded (≤ 64 KB) JSON snapshot are checked. The snapshot identity must
match its record, and its credit text, requirement, placement and HTTP/HTTPS
license/source/creator links must be usable. The recorded origin is forced to
`IMPORTED_DECLARATION` — an imported catalog id is never treated as proof of
review. Malformed provenance fails that asset with a warning instead of importing
its artwork as an ordinary uncredited upload. Image and provenance rows are
stored transactionally; a failed provenance write cannot leave a usable image
row behind. A v1 import carrying unsupported provenance is rejected rather than
discarding it. The importer normalizes images
again and, when bytes change, keeps the provenance chain, warns about the
re-encode, and preserves both the original and stored digests. Category
illustrations are remapped only after asset ids are known, and placements that
referenced an unavailable image are cleared with a warning.

## Restriction and withdrawal advisories

Operator advisories live in `src/lib/stock-advisories.ts` and are applied by
`scripts/apply-stock-advisories.ts`. An advisory file matches installed copies by
provenance identity (`catalogEntryId` + `catalogVersion`), so withdrawal works
even when the installed catalog is absent. `restrict` sets `displayRestricted`,
`restrictionReason` and `restrictionDate` on every affected copy; `clear`
reverses it. Restriction keeps bytes and provenance intact for owner review and
recovery, and ordinary library edits cannot clear it.

`displayRestricted` art stops being served to readers: `/api/assets/[id]/file`
returns `404` for non-owners, and the public and campaign reader pages filter it
out (`displayRestricted: false`), falling back to the default empty-alt image or
folder icon. Owners retain access for review. The advisory file defaults to
`resources/stock-art/advisories.json` and can be overridden with
`WORLDFORGE_STOCK_ART_ADVISORY`.

## Roadmap in this repository

The implementation plan is
[`feature-requests/curated-stock-art-library.md`](feature-requests/curated-stock-art-library.md).
Slices 1–6 (contract, durable selection, picker integration, placement
completeness, reader/maintenance integration, and portability/lifecycle) are
implemented. Release verification and the human rights/design sign-off are the
remaining gates.
