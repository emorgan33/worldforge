# Implementation plan: curated fantasy stock-art library

Status: Proposed; graphic-designer feedback incorporated into the implementation requirements. Implementation, candidate-artwork review, and visual verification have not started.

Source: [GitHub feature request #7](https://github.com/emorgan33/worldforge/issues/7). Code reviewed at `95871c9` on October 23, 2026. This is distinct from the completed “Library and maintenance improvements” milestone numbered 7 in `docs/feature-improvements.md`.

## Outcome and scope

An author can open an existing image picker, start in **World images**, switch to **Stock art**, inspect an artwork's source and rights information, preview its intended use, and deliberately select it. World images includes **All saved / Uploaded / Stock** filters and a prominent upload action, so saved stock remains discoverable after catalog retirement. The selection becomes an ordinary world-scoped image with durable provenance. Public and campaign readers see only permitted images and the credits associated with the images actually displayed to them.

Deliver a small reviewed collection spanning portraits, locations/landscapes, objects, and category artwork. Prefer one convincing collection, with **painterly fantasy** as the primary sourcing direction if reviewed candidates support it. A separately named **engraved field guide** collection is an optional second direction, not a requirement or a reason to mix incompatible styles. Target roughly 16–24 images, but assess usefulness through an approved subject-by-placement coverage sheet rather than count alone. All four subject groups need useful examples before declaring the request complete; do not admit questionable artwork to meet a quota.

The release includes selection, attribution, portable export/import, category artwork, portrait selection, and a documented withdrawal procedure. It excludes third-party search APIs, arbitrary remote imports, paid catalogs, automatic portraits, generative sourcing, and a new navigation design. [Issue #3](https://github.com/emorgan33/worldforge/issues/3) is already closed; retain its interface icons and Night watch styling. Category artwork is an optional illustration beside a category label, never a replacement for controls or destination icons.

No actual artwork is approved by this plan. Individual source/license review and collection/placement design review are separate implementation deliverables and release gates. Preserve the no-image layout as a supported outcome.

## Existing implementation and implications

| Area | Current code | Consequence for this feature |
| --- | --- | --- |
| Picker | `src/components/assets/AssetPicker.tsx`, `AssetLibrary.tsx`, `ImageSourceField.tsx` | Reuse the native dialog, world navigation guards, uploads, and `ImageAssetItem` selection callback. |
| Image bytes | `src/lib/asset-storage.ts`, `src/app/api/assets/route.ts` | Uploads normalize to WebP, enforce byte/pixel limits, and deduplicate by `(worldId, sha256)`. Selected stock must use the same persistent storage and URL shape. |
| Data | `ImageAsset` in `prisma/schema.prisma`, `src/lib/assets.ts` | There is no provenance/license model. Title and default alt are editable; image bytes are immutable per ID. |
| Placement | `WorldHome.tsx`, `ArticleEditorForm.tsx`, `editor/BlockControls.tsx` | Covers, backgrounds, and body images already use the picker. Body insertion copies default alt; cover settings currently store URLs without placement-specific alt. |
| Portraits | `Article.portraitImage`, `ArticleViewer.tsx` | A portrait field exists and is cloned/exported, but the main editor and reader projections do not provide a complete portrait workflow. |
| Category artwork | `Category.icon`, `CategoryManager.tsx`, `Sidebar.tsx`, `ReaderCategoryTree.tsx` | The existing icon is a string identifier, not a managed image. Add a separate image reference. |
| Reader access | `src/lib/public-world.ts`, `/w/...`, `/c/...`, `/api/assets/[id]/file` | Public access follows publication and visible references. Campaign assets require their own audience grants; sharing an article alone intentionally does not share its images. |
| Recovery | `article-drafts.ts`, article revision routes, `world-export.ts` | New placement fields must participate in drafts, saves, cloning, revision restoration, and portable backups. Existing revision rows do not snapshot cover/portrait fields. |
| Asset maintenance | Asset usage/permanent-delete routes and world cleanup | Usage and deletion handlers currently call `imageAssetId(id)` on a bare UUID; that helper expects a URL. Reference scans also omit relevant locations. These paths need focused repairs before relying on them for withdrawal handling. |
| Packaging | `Dockerfile`, `.dockerignore` | The runtime does not copy a new catalog directory automatically, and `docs` is excluded. Runtime license evidence cannot live only in documentation. |

The image-library documentation predates several maintenance changes. Implement against the current code and update that document as part of delivery.

## Architecture decisions

### 1. Ship a local catalog; copy on selection

Store the reviewed catalog under `resources/stock-art/`, outside `public/` and outside writable uploaded-asset storage. Include a versioned JSON manifest, normalized image files, thumbnails, and distributable license/evidence files. The application reads these local files; it never fetches a source URL during browsing or selection.

Browsing creates no world records. Selecting an entry copies its approved, checksum-verified WebP bytes into `WORLDFORGE_ASSET_DIR` and creates or reuses an `ImageAsset`. Return `/api/assets/{id}/file` through the existing picker contract. Subsequent rendering uses that world copy, without a dependency on catalog availability.

This deliberately spends storage per world to preserve existing ownership, file serving, cleanup, backup, and portability behavior. Do not add global asset IDs to article JSON or grant public access merely because artwork originated in the catalog.

Catalog entry IDs and image versions are immutable. A changed image is a new version. A later catalog update does not replace bytes, titles, alt text, or image selections in existing worlds.

### 2. Separate reviewed provenance from author-editable metadata

Add an `ImageAssetProvenance` relation with proposed fields:

- `id`, `assetId` with cascading deletion, `catalogEntryId`, `catalogVersion`, and `manifestDigest`.
- `snapshotJson`: a validated, bounded snapshot of the distributable manifest entry, including credit and evidence.
- `verificationOrigin`: `BUNDLED_REVIEW` or `IMPORTED_DECLARATION`.
- `createdAt`; uniqueness on `(assetId, catalogEntryId, catalogVersion, manifestDigest)` and an index on catalog identity for affected-use lookup.

Keep existing `(worldId, sha256)` uniqueness. One image can retain multiple provenance records if identical bytes occur in more than one reviewed entry. Do not overwrite an earlier attribution record, or erase it through ordinary asset PATCH requests. If uploaded bytes already match a selected catalog image, reuse the image and append the reviewed provenance; preserve its author-edited title/alt. Repeated selection of the same entry is idempotent.

An imported provenance claim is preserved but is not automatically a WorldForge verification. It may regain `BUNDLED_REVIEW` status only by matching a locally reviewed manifest and the associated byte digest. Sanitizing imported strings does not establish rights.

Extend `ImageAssetItem` with a small credit/source summary and distinct saved-state, provenance-review, and audience-access information where needed by the inspector. Do not collapse these into a generic verified badge: **Added to this world** does not mean shared with players, and a stock source does not establish reviewed provenance. Use **Reviewed catalog provenance** or **Imported provenance — not verified** in details. Keep full evidence and operator review notes out of general client payloads; provide an owner-only details projection. Render strings as text and allow only validated HTTP/HTTPS source/creator/license links.

### 3. Keep accessibility data at the placement

Use `ImageAsset.alt` as an editable default, never a compulsory caption or substitute for credit. Body images retain TipTap's existing per-insertion `alt` attribute.

Add nullable `coverImageAlt` and `portraitImageAlt` to `Article`, and nullable `coverImageAlt` and `bannerImageAlt` to `World`. Add the article image URL and alt fields to revision snapshots. A null value preserves legacy presentation; an empty string explicitly marks decorative artwork. A nonempty value is the author's placement-specific description. Selecting new informative art suggests its default alt; library edits never rewrite existing placements.

Backgrounds remain decorative CSS images. Category images use empty alt because the adjacent visible category name supplies the label. In informative placements, label the controls **Describe this image** and **Decorative image** without exposing null/database terminology. Keep credit, caption, and accessibility description distinct; do not infer a character's name, identity, or campaign lore from generic stock metadata. Do not put license text into alt attributes.

Add a `purpose` prop to the shared picker: body, portrait, world cover, article cover, background, or category icon. Show **Full artwork** and **In this placement** previews using the actual placement's sizing and fitting rules: contain for body art, the renderer's portrait shape, cover for banners, and 16/24/32px previews for category artwork. Reuse presentation geometry between previews and renderers so they cannot drift; include representative title text, overlays, and surrounding content where the actual placement uses them. Version one uses documented centered fitting and does not introduce a crop editor. Review narrow and wide compositions, not just source thumbnails.

Default stock browsing to artwork recommended for the current purpose, with an explicit **Browse all artwork** option. For a mismatched placement, show **Not recommended for this crop** with a brief reason and the actual crop preview; this visual recommendation is distinct from any rights restriction. Only recommend a placement when important faces, hands, landmarks, and silhouettes survive its tested crops. A failed cover crop may still be suitable for body content. The standalone library has no placement preference until the author chooses one for preview.

### 4. Keep category images separate from interface icons

Add nullable `Category.iconImage` containing a same-world asset URL. Keep `Category.icon` and existing folder/template interface icons intact. Validate the image through `validateImageReference()` and limit this new category field to managed local images; existing external cover/body URL support remains unchanged.

The category manager offers choose, preview, and clear actions. Author and reader trees show approved images beside text, preserving the row rhythm and keeping artwork secondary to the category name and disclosure control. Reader data contains an icon URL only when both the category and image are visible to that reader. Missing, failed, unauthorized, or display-blocked category images use the ordinary folder treatment, without a broken-image glyph or a public explanation of private content. A hidden image's title, alt, or credits must not leak through the fallback.

## Rights manifest and curation workflow

Define and validate a manifest schema before sourcing the release bundle. Each entry records:

| Group | Required information |
| --- | --- |
| Identity | Stable ID, image version, collection, title, subject types, style tags, search terms, default alt. |
| Visual suitability | Per-purpose recommendation and rationale, reviewed narrow/wide crop cases, category-size results where applicable, and references to the collection brief/contact sheet and placement coverage review. Keep these distinct from allowed uses. |
| Creator/source | Creator name and optional creator URL, durable original item URL, original filename, acquisition date. |
| Rights evidence | Exact license identifier/version or documented public-domain basis, license URL, dated evidence reference and digest, reviewer and review date. |
| Allowed uses | Explicit review outcomes for application bundling, standalone redistribution, world export, modification/cropping, and public display. Unknown is not approval. |
| Attribution | Credit text, source/license links, whether credit is required, required placement, and modification notice. |
| Derivatives | Original checksum, delivered WebP checksum, thumbnail checksum, dimensions, sizes, normalization recipe, and recorded modifications. |
| Lifecycle | Available/retired/disputed state, reason, date, and optional replacement entry ID. |

Start with individually reviewed CC0/public-domain candidates, as requested in the issue. Review the actual item, creator/source chain, terms, and evidence; a repository-wide or marketplace “free” label is insufficient. Verify suitability for all planned distribution paths, including exporting a world with embedded image bytes. Exclude uncertain candidates and material requiring unsupported distribution restrictions. Official game artwork, recognizable protected character art, fan art, and generated imagery do not acquire approval through inclusion in a collection.

Preserve evidence in a durable review record. Ship only evidence excerpts/documents that can themselves be redistributed; do not indiscriminately bundle third-party web pages. Keep enough distributable license and provenance material in each world snapshot to explain the source after the catalog is gone. Private correspondence stays in the review record, with a non-sensitive evidence identifier in shipped data.

Use a separate review pass for visual coherence and usability. Each collection has a short brief covering palette range, lighting, edge treatment, texture, framing, and level of detail. Produce a contact sheet and a subject-by-placement coverage sheet, recording recommended uses and rejection reasons. Review actual wide/narrow crops, category silhouettes at 16/24/32px, and compositions against supported light/dark reader themes. Portraits should offer varied ages, skin tones, gender presentations, and roles without implying villainy, competence, or status through appearance. Do not impose coherence through recoloring unless rights permit it and the derivative is recorded. Keep briefs, contact sheets, coverage results, and visual review notes under a dedicated `docs/stock-art-review/` directory; runtime placement recommendations belong in the manifest. Review annotations and file digests in the same change as each added image.

A proposed `pnpm stock-art:validate` command checks schema, duplicate identities, paths confined to the bundle, required review fields, allowed-use gates, file hashes, image decode limits, dimensions, credit URLs, and missing evidence. Check valid purpose values and review records for each recommended placement as well. It validates completeness and consistency; it does not independently prove ownership, license validity, or visual quality. The release requires recorded human provenance review and design review as well as passing validation.

## API and selection behavior

Use world-nested routes so the existing `withAuthor()` world-path authorization applies without making the shared catalog public:

| Endpoint | Contract |
| --- | --- |
| `GET /api/worlds/[id]/stock-art` | Bounded search and subject/style/collection filters; optional validated `purpose` and `recommendedOnly` parameters; deterministic pagination; available entries with safe summaries, world-local saved state, and local preview URLs. Include catalog revision and filter context in cursors. |
| `GET /api/worlds/[id]/stock-art/[entryId]/[version]` | Owner-visible artwork details, purpose recommendations/reasons, exact proposed credit including modification notices, and distributable provenance, without unrelated world usage. |
| `GET /api/worlds/[id]/stock-art/[entryId]/[version]/preview` | Validated local thumbnail or detail image; author-only, WebP, nosniff, private/no-store. No arbitrary paths or URLs. |
| `POST /api/worlds/[id]/stock-art` | Accept only entry ID and version. Validate owner, same origin, current availability, bundle integrity, and world activity; materialize and return `ImageAssetItem` plus reuse status. |

Materialization writes a unique file, then creates/reuses the database image and provenance in a transaction. Handle concurrent inserts by re-reading the winning hash record and recording provenance once. Remove a losing/orphan file; enqueue an `AssetCleanupJob` if removal fails. Report success only after both durable bytes and metadata exist. Do not assign image fields or create audience grants in this endpoint.

Reject withdrawn versions or stale selections with an actionable conflict response. Missing/corrupt catalog files disable the affected selection without changing existing world copies. World deletion during selection must fail cleanly and leave no untracked file.

In the UI, **World images** is the initial source, with **All saved / Uploaded / Stock** filters and a prominent upload action. Use the same saved-image browsing behavior in the standalone Image library. Stock art marks available entries **Added to this world** when applicable. Extend `GET /api/assets` with a validated source filter applied before pagination; retain its existing search and hidden-image behavior. Derive source from persisted acquisition/provenance records rather than filenames or catalog availability, preserve it on import, and keep source classification separate from verification. Preserve uncertain legacy/imported origins in All saved without inventing a reviewed-stock claim. Saved retired stock is discoverable in World images even when the installed catalog no longer contains its entry; its saved inspector uses the world copy and provenance snapshot.

Use a shared picker layout with source tabs, search and compact filters, an image grid, and a selected-image inspector with one primary **Use image** action. On wide screens, place the inspector beside the grid. On small screens, use a detail view inside the same dialog with **Back to results**; preserve query, filters, results, scroll position, and focused card when returning. Keep browsing/inspection state separate from the committed placement and reset it on world changes. Routine details must not open another modal.

Keep cards to artwork, title, collection where applicable, and the optional saved-state label. Show selection with an outline and checkmark/text, not color alone. Put creator, source, license, credit requirement, exact credit, provenance status, audience status, and full/placement previews in the inspector. Keep Night watch typography, surfaces, and focus treatment independent of collection art style. Provide an accessible direct route from results to the inspector without tabbing through every thumbnail.

Respect current dirty/busy guards when switching sources, closing the dialog, or changing worlds. Cancel stale requests and ignore late results from a previous world/query. Define these states explicitly:

| State/action | Required behavior |
| --- | --- |
| Empty World images | Keep the upload action and Stock art entry point visible; preserve the no-image option. |
| No matching results | Retain the query; offer **Clear filters** without silently discarding it. |
| Catalog unavailable | Offer **Use world images**; keep saved copies available independently of the catalog. |
| Thumbnail unavailable | Preserve the labeled card and recovery path; use a neutral fallback, never a broken-image glyph. If usable image bytes cannot be loaded, disable selection with an explanation. |
| Selection failed | Retain preview/details and retry action; do not replace the current placement. |
| Back to results | Restore browse state and focus within the existing dialog. |
| Cancel | Leave the placement intact and return focus to its trigger. |
| Clear image | Deliberately remove the placement through its existing editor flow; never use cancellation to clear it. |

Keep keyboard focus visible, tabs correctly labeled, status announcements accessible, and credit details readable without hover. At 320px and approximately 390px viewport widths, 200% zoom, and with a mobile keyboard open, filters, credit links, back/close controls, and Use image must remain reachable without horizontal document scrolling or an obscuring sticky footer. Target 44px touch controls, normal UI/credit text contrast of at least 4.5:1, and meaningful control boundaries/focus indicators at least 3:1 against adjacent colors. Selection and restriction states must remain understandable without color. These targets apply to the interface, not every decorative pixel of artwork. Stock artwork is never applied by opening the picker or changing a filter.

## Reader rendering, credits, and reference tracking

Build shared framework-free extraction helpers for image references, but keep two distinct results:

1. **Owner usage:** all references that should block deletion or appear in a withdrawal report, including private content and retained revisions.
2. **Reader usage:** only references remaining after the existing public/campaign projection, document sanitization, and image authorization.

Never reuse the owner usage list for public credits. A public credits list must not reveal private article names, unused library images, GM-note images, or retained history.

Add a shared `ArtworkCredits` renderer with the visible heading **Artwork credits**, normal readable text contrast, and descriptive links. Render required credit adjacent to the artwork when the manifest requires adjacency; otherwise provide a page-level credit section. Required adjacent credit must survive narrow layouts and long creator names. Category/background credits belong in the relevant reader page's credit section. Include title, creator, source, license link, and modification notice where applicable. Voluntary credit for the initial catalog can use the same section. Deduplicate identical credit records on a page. Keep credits separate from author-editable captions and accessibility descriptions, and show the exact proposed credit in the selection inspector and author preview.

Update public and campaign home/article projections for portraits, placement alt, category images, and filtered credit records. Extend `assetIsPublic()` for the newly rendered public placements; do not grant access from private portraits, invisible categories, or GM-note subtrees. Preserve campaign `readableWhere()` filtering and explicit asset grants. The editor should make an unshared selected image's status visible and link to existing sharing controls; selecting stock must not silently share it with players.

Use the reference collector for usage reports, permanent deletion, and orphan cleanup. Include world cover/banner/background, article cover/portrait, parsed TipTap and legacy HTML images, category artwork, retained revision images, and existing map/layer/timeline image references. Parse references rather than relying only on substring matches. Paginate displayed usages while computing complete counts and deletion decisions independently of page size. Browser-local unsaved drafts cannot be enumerated by the server; document that limit and keep permanent deletion explicit.

Repair the UUID-validation bug in usage/deletion routes. Also cover bodyless DELETE requests through `withAuthor()`; its generic mutation path currently expects JSON. Keep owner checks and same-origin enforcement intact. Ensure a reference cannot be attached concurrently after a successful deletion check by coordinating reference validation and database mutation transactionally. Reuse durable cleanup jobs for post-commit file removal.

Do not silently redefine archived-image access while adding stock. Characterize the current hide/restore behavior with tests, preserve intended authorization, and explicitly document any necessary correction where current behavior conflicts with stable selected references.

## Portability, migration, and withdrawal

### Schema and format evolution

Use an additive Prisma migration for provenance, category image references, placement alt, and article revision image fields. Existing rows retain null/default values; no artwork, rights claims, or publication grants are backfilled. Regenerate Prisma and restart the application after migration. Follow `CONTRIBUTING.md`, not the older `db push` instructions in the image-library milestone.

Introduce `formatVersion: 3` for portable worlds with provenance and the new placement fields. Keep v1/v2 imports supported. New exports include image bytes, distributable evidence, provenance snapshots, alt text, category image references, and revision placement fields. Remap world asset IDs everywhere while retaining catalog identity as provenance, not a dependency on a global catalog.

The current export route defaults to v1 and selects v2 only via `format=v2`; update the UI and default route deliberately to v3. Keep explicitly requested legacy exports for worlds that can be represented losslessly. Reject a legacy export that would silently drop this feature's provenance or placement fields, with guidance to use v3. Define v3 as the complete owner backup, with assets and private data; reject unsupported filtering flags rather than silently ignoring them or presenting a partial backup as complete.

Validate v3 shape, bounded metadata/evidence, image hashes, and credit links before writes. Preserve the existing total request and decoded-image limits. Existing imports normalize images again; record both the source digest and resulting stored digest when bytes change, retaining the provenance chain and modification notice. Never fetch missing images or trust imported catalog IDs as proof of review. Malformed required provenance must not be dropped while its artwork is imported as an ordinary uncredited upload.

Test migration from a populated pre-feature database and restoration on an installation with no matching catalog. Old revision rows with unknown image fields must preserve the current placement on restore; new rows can explicitly restore or clear it. Preserve optimistic version checks and local draft compatibility.

### Catalog lifecycle and disputes

Distinguish ordinary retirement from a rights dispute:

- **Retired:** remove from new catalog selection, keep tombstone metadata, and keep already selected world copies and credits working. Owners can inspect and reuse those copies from World images without a catalog lookup; retirement alone is not a rights restriction.
- **Disputed:** prevent new selection, display an owner-visible warning for affected copies, and produce a complete owner-scoped usage report. Do not erase selected files, silently substitute another image, or quietly relabel a license.
- **Corrected attribution:** append a versioned correction linked to the previous snapshot, preserve original evidence, and render the current reviewed credit. Correction changes are distinct from replacing image bytes.

Add a documented operator workflow for applying a reviewed catalog advisory to installed copies. Self-hosted/offline deployments receive advisories through an application/catalog update or an explicitly installed local advisory; do not imply a real-time remote recall service exists. Maintain tombstones so catalog deletion does not erase the ability to identify affected copies.

Where continued display must be disabled, an explicit operator-applied advisory can mark affected copies unavailable to readers while retaining bytes/provenance for owner review and recovery. Show a neutral unavailable-art placeholder to readers (the ordinary folder fallback for category artwork) and a detailed warning with affected-use actions only to owners. Enforce this at the file endpoint as well as the page projection. Store that restriction separately from normal library hiding, preserve it across export/import, and prevent ordinary asset edits from clearing it. A metadata-only export must not pretend to be a complete backup; if an advisory prohibits redistribution, block the portable export of affected bytes with a specific explanation.

Owners replace affected placements deliberately through their existing editors; do not add a broad automatic replacement engine in version one. Usage reports include revision-only references so owners understand why an old copy remains retained. Document that detached past exports cannot be recalled.

### Packaging and operational checks

Copy the catalog and distributable evidence into the Docker runtime explicitly, with read-only application files and writable world-asset storage kept separate. Validate the catalog during CI/build. Test local development, production build/container startup, and offline selection. Keep thumbnail responses small and lazy-load grids; browsing should never create asset rows or transcode full images on each request.

Update backup documentation to cover provenance in SQLite, copied stock bytes in asset storage, and the versioned catalog/advisories as deployment artifacts. Verify a disposable restore with the catalog absent. A rollback disables new stock selection while preserving schema, copied assets, credits, and reader restrictions; never roll back by deleting provenance or selected artwork.

## Design requirements incorporated from the graphic review

The graphic-designer review establishes a small, art-directed collection inside a practical image picker. The collection should help a GM make a world feel coherent while keeping personal artwork prominent and stock art optional. The requirements below are incorporated into the architecture, API/UI contracts, implementation slices, and acceptance criteria above and below; they are not a separate set of pending suggestions.

Review basis recorded by the designer: the existing workspace screenshot establishes the Night watch visual language; `AssetPicker.tsx`, `AssetLibrary.tsx`, `ImageSourceField.tsx`, `ArticleViewer.tsx`, `ReaderCategoryTree.tsx`, and public/campaign page source establish the current interaction and placement constraints. The screenshot does not show the picker. Incorporating the review does not establish that the new interface or candidate artwork has been visually tested.

### Art direction and useful coverage

- Prefer one convincing collection over two thin ones. Use **painterly fantasy** (atmospheric portraits and places) as the primary sourcing direction if rights-cleared candidates support it. **Engraved field guide** (restrained linework, objects, and emblems) is an optional separately named collection; keep incompatible rendering styles separate. These are sourcing directions, not approved assets or a request to generate artwork.
- Give each collection a short curation brief: palette range, lighting, edge treatment, texture, framing, and level of detail. Review a contact sheet as a family as well as each image individually. Do not impose coherence through recoloring or derivatives unless the rights review permits them and the modifications are recorded.
- Use a subject-by-placement coverage sheet, not only an image count. A landscape can work in body content yet fail as a banner; an object painting can fail as category artwork. Record suitable placements and reasons for rejection. Category art needs a strong silhouette and uncluttered background, not simply a miniature landscape.
- Portrait coverage should offer varied ages, skin tones, gender presentations, and character roles without encoding villainy, competence, or social status through appearance. Avoid a collection consisting only of youthful warriors. Keep portraits optional and preserve the existing no-image layout as a first-class outcome.

### Picker hierarchy and source naming

The existing library puts upload controls above its grid and selected-image details below it (`AssetLibrary.tsx`). Adding filters and provenance to that same vertical stack risks pushing the preview and final action out of sight.

- Within the existing dialog, use a clear sequence: source tabs → search and compact filters → image grid → selected-image preview/details → one primary **Use image** action. On wide screens, place the inspector beside the grid; on small screens, open an in-dialog detail view with **Back to results**, restoring the query, scroll position, and focused card. Do not open a second nested modal for routine details.
- Keep image cards quiet: artwork, title, collection, and an optional **Added to this world** label. Put the full license explanation in the inspector, not a wall of badges on every thumbnail. Use a visible selected outline plus a checkmark/text state, not color alone. Retain Night watch typography, surfaces, and focus treatment; do not theme the application chrome to match each artwork collection.
- Use **World images** and **Stock art**, with **All saved / Uploaded / Stock** filters inside World images and a prominent upload action. Start on World images. This replaces the issue's initial “My uploads” wording so saved stock has a predictable home, including after retirement, without being called an upload.
- Keep three concepts separate in labels: **source** (uploaded/stock), **saved state** (added to this world), and **audience access** (not shared with players). None implies the others. Use **Reviewed catalog provenance** versus **Imported provenance — not verified** in details rather than a generic “safe” or “verified” shield that could imply unrestricted rights or sharing approval.

### Composition, framing, and readable previews

The current author portrait uses a fixed-height `object-cover` frame, while public/campaign cover images have their own fixed-height frames. A generic square thumbnail cannot demonstrate either result.

- Show **Full artwork** and **In this placement** previews, with the latter using the actual renderer's responsive dimensions and fit. For covers/backgrounds, include realistic title text, overlays, and surrounding content where the placement uses them; assess contrast on the final composition, not the source image alone.
- With centered fitting and no crop editor in version one, admit artwork to a recommended placement only if important faces, hands, landmarks, or object silhouettes survive its narrow and wide crops. A failed banner crop need not exclude the image from body use. Prefer purpose-matched results by default, with an explicit way to browse other artwork; distinguish “not recommended for this crop” from a rights restriction.
- Category illustrations must remain secondary to the category name and disclosure control. Preserve the existing navigation icons and row rhythm; reject detail-heavy candidates that become indistinct at the smallest supported size. Missing or unauthorized artwork uses the ordinary folder treatment without a broken-image glyph or a public warning about private content.
- Explain placement alt text in human terms: **Describe this image** or **Decorative image**. Preserve the plan's legacy/null behavior without exposing database terminology. Keep credit, caption, and accessibility description visibly separate, and do not infer a depicted character's identity or lore from generic stock metadata.

### Credit and failure-state presentation

Use a readable **Artwork credits** section with normal text contrast and descriptive links, not tiny low-contrast legal copy. Show the exact proposed credit in the selection inspector and the author preview, including any required modification notice. Required adjacent credit must survive narrow layouts and long creator names. When an advisory blocks display, use the neutral reader placeholder described above; reserve rights-dispute explanations and affected-use actions for the owner.

No-results messaging should retain the current query and offer **Clear filters**. Catalog-unavailable messaging should offer **Use world images** rather than imply the user's saved art is missing. A failed **Use image** action retains the preview and retry path without replacing the current placement. Keep **Cancel** and **Clear image** distinct: cancellation leaves the placement intact, while clearing is deliberate.

### Required design release evidence

The exit criteria for slices 1, 3, 4, and 7 include the following checks. Retain contact/coverage sheets and screenshots/review notes under `docs/stock-art-review/` with the release evidence:

- Approve a collection contact sheet and placement coverage sheet; review each recommended crop at narrow and wide widths, category art at 16/24/32px, and artwork against supported reader themes. Passing the manifest validator alone is not visual approval.
- Exercise browse → inspect → use → replace → cancel → clear, including reuse of a retired saved copy. Test an empty upload library, no search results, long titles/credits, unavailable thumbnails, failed selection, and an unshared player image.
- At 320px and approximately 390px viewport widths, 200% zoom, and with the mobile keyboard open, ensure filters, credit links, close/back controls, and the primary action remain reachable without horizontal document scrolling or an obscuring sticky footer. Target 44px touch controls. Verify keyboard focus restoration and screen-reader announcements without forcing users through every thumbnail to reach the inspector.
- Verify normal UI/credit text contrast of at least 4.5:1 and meaningful control boundaries/focus indicators at least 3:1 against adjacent colors. Keep selection and restriction states understandable without color. These are interface checks, not a claim that every decorative pixel of an illustration needs a contrast ratio.

## Implementation sequence

Each slice includes its focused tests and documentation. These are implementation steps, not completed work.

| Slice | Deliverable and primary touchpoints | Exit condition |
| --- | --- | --- |
| 1. Catalog contract and first review | New catalog types/validator in `src/lib/stock-art.ts`, `resources/stock-art/`, validation script and package command. Establish the collection brief, contact sheet, and subject-by-placement coverage sheet under `docs/stock-art-review/`; encode purpose recommendations/reasons in the manifest. Review a representative set, then complete curation throughout later slices. | Manifest validation rejects incomplete evidence/unsupported uses; representative bytes have provenance review and digest checks. A design review records collection coherence, portrait variety, narrow/wide crops, and 16/24/32px category suitability. |
| 2. Durable selection | Prisma provenance model/migration, `stock-art-storage.ts`/materialization service, world-nested API routes, asset DTO extensions. | Owner can select once or concurrently and receive one stable world image; failures clean up; other owners/players cannot select into the world. |
| 3. Picker integration | New `StockArtBrowser.tsx` and shared inspector; changes to `AssetPicker`, `AssetLibrary`, `ImageSourceField`, existing callers, and asset source filtering. Implement World images/Stock art, full/placement previews, purpose filtering, desktop side inspector, and mobile details/back state. | Browse → inspect → use → replace → cancel → clear works; Back restores results, scroll, and focus. Uploads, retired saved copies, exact credits, empty/error/retry states, and unshared-image status are understandable. Guards survive cancellation/errors; controls work at 320/390px, 200% zoom, and with the mobile keyboard open. |
| 4. Placement completeness | Article/world alt fields; portrait editing; category image schema/API/UI; types, drafts, revisions, clone routes, author viewers; shared placement geometry and human-readable accessibility controls. | Author can select, describe, mark decorative, clear, reload, recover and restore each placement. Full/placement previews match narrow/wide rendering, category art is readable at 16/24/32px, and no-image/folder fallbacks preserve layout and labels. |
| 5. Reader and maintenance integration | Filtered credit projection/renderer, public/campaign pages, reader trees, asset byte authorization, usage/deletion/cleanup helpers. | Only permitted art/credits reach readers; revocation works; all persistent references block accidental deletion. Long adjacent credits remain readable at narrow widths; unavailable category images use folder fallbacks without leaking private details. |
| 6. Portability and lifecycle | v3 export/import, legacy guards, correction/advisory workflow and state, Docker packaging, backup/withdrawal docs. | Round-trip without catalog preserves references/credits; retirement is stable; dispute handling is visible and reversible where permitted. |
| 7. Release verification | Complete reviewed collection; final contact/coverage sheets and placement screenshots; full isolated suite; production packaging check; browser/accessibility review of complete flows and failure states; updated docs/checklist. | Every acceptance criterion has evidence. Each release entry has recorded rights and design review; all four subjects have useful placement coverage. Verify 320/390px, 200% zoom, mobile keyboard, 44px touch controls, text/control contrast targets, focus restoration, and screen-reader announcements. |

Dependency order: 1 → 2 → 3 → 4 → 5 → 6 → 7. Curation can continue alongside implementation after the manifest contract is fixed. Recheck the preliminary placement reviews from slice 1 against the actual previews/renderers in slices 3–5, and record final evidence in slice 7. Keep stock selection unavailable in a released build until reader credits, export preservation, withdrawal handling, and the rights/design release gates are complete.

## Verification and acceptance mapping

| Request criterion | Automated coverage | Manual/release evidence |
| --- | --- | --- |
| Existing pickers support stock and uploads | New stock API/component suites; extend `tests/assets-api.test.tsx` and `tests/assets.test.tsx`; cover World images source filters before pagination, every `ImageSourceField` placement, nested form isolation, and desktop/mobile inspector state. | Browse → inspect → use → replace → cancel → clear → reload, including uploads and retired saved stock. Verify Back restores query/filter/scroll/focus and no-image remains usable. |
| Coherent collection, search/filter, readable previews | Manifest/thumbnail checks; purpose recommendations and browse-all behavior; deterministic search/filter/pagination; stale request/catalog cases; distinguish visual crop warnings from rights restrictions. | Approved collection brief/contact sheet and subject-by-placement coverage sheet; all four subjects, varied portraits, full/placement previews, narrow/wide crops, 16/24/32px icons, and supported reader themes. |
| Provenance and required credits | Reject incomplete manifests; protect stored provenance; reader credit tests after filtering; imported-claim trust tests; source/saved/access states are independent. | Item-by-item review records; exact inspector/author/public/campaign credits; long names and adjacent credits at narrow widths; normal text contrast. A synthetic required-credit fixture tests behavior even if release art needs no mandatory credit. |
| Stable references and editable alt | Dedup/race/failure tests; draft/revision/clone tests; extend `tests/world-export-roundtrip.test.tsx` and `tests/world-export-import-api.test.tsx`. | Restart, catalog removal, private/public changes, import into catalog-free installation, and backup restore. |
| Accessible category artwork | Extend `tests/reader-navigation.test.tsx`; category API validation; missing/failed/unauthorized/blocked-image folder fallbacks; private-category and image filtering; labels and disclosure controls survive image changes. | 16/24/32px readability, secondary visual weight, visible labels, keyboard navigation, screen-reader names, and no private-warning or broken-image glyph in readers. |
| Removed/disputed entries handled explicitly | Advisory, retirement, saved-copy reuse without catalog lookup, correction, blocked bytes, owner usage, revision retention, legacy export guard, and cleanup regressions. | Withdrawal drill with a published placement, private use, player grant, and exported/imported copy; verify owner-only explanations and neutral reader placeholders/folder fallbacks. |
| Responsive picker and recoverable failure states | Interaction coverage for tabs, inspector focus, Back/Cancel, empty library, no results, missing thumbnail, failed selection/retry, unavailable catalog, and unshared asset status. | 320/390px, 200% zoom, mobile keyboard open; no horizontal document scroll or obscuring footer; reachable actions and credits; 44px touch controls; 4.5:1 normal UI/credit text and 3:1 meaningful boundaries/focus indicators; states understandable without color. |

Also extend `tests/auth-publication-api.test.tsx` and `tests/player-access-api.test.tsx` with owner/other-owner/anonymous/player/preview cases. Include an image used only in a GM note, an unreadable portrait/category, a player-visible article without an asset grant, grant revocation, archived/deleted worlds, and a public image viewed while signed in. Test bodyless permanent deletion and reference scans beyond the displayed usage page size.

Run unit checks during each slice and the complete `pnpm lint`, `pnpm build`, and `pnpm test` before release. Follow the isolated setup in [CONTRIBUTING.md](../../CONTRIBUTING.md): a dedicated temporary SQLite database and asset directory, dev server using those same paths, `WORLD_CREATION_TEST_DATABASE_URL` set, and `WORLDFORGE_TEST_ORIGIN` pointing to that server. Do not seed or test against a user's configured database. Production/container checks are additional packaging evidence, not substitutes for the documented dev-server integration suite.

Before framework changes, read the relevant installed Next.js documentation under `node_modules/next/dist/docs/`; the route-handler guide was reviewed while preparing this plan. Keep authorization-sensitive responses uncached across readers and do not introduce static catalog file URLs that bypass access checks.

Update `docs/image-library.md`, `docs/reader-navigation-and-discovery.md`, `docs/backup-restore.md`, and a new `docs/stock-art.md` with implemented behavior and the World images/Stock art terminology. Retain design evidence under `docs/stock-art-review/` and link it from the release verification record alongside provenance review evidence. Add a separate issue #7 entry to `docs/feature-improvements.md`; do not rewrite the completed historical milestone 7 as though it were this request. Mark acceptance criteria complete only after implementation verification, provenance review, and collection/placement design review are recorded.
