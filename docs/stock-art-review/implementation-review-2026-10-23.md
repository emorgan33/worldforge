# Issue #7 implementation review — October 23, 2026

Status: the findings below are the original review record. All six are now
addressed by the [implementation corrections](fixes-2026-10-23.md), with
regression coverage; human review gates remain open.

Reviewed the uncommitted working tree based on `95871c9`, with the installed
eight-entry development catalog. This is a code/behavior review, not a human
rights or design sign-off. The happy-path v3 round-trip works, but the feature
still has implementation follow-ups in addition to the declared human gates.

## Findings requiring follow-up

### 1. Imported snapshot contents are not validated before artwork is accepted

`src/lib/world-export.ts` (`normalizeImportedProvenance`) validates outer record
fields and snapshot byte length, but does not parse or validate `snapshotJson`.
An otherwise valid record with `snapshotJson: "not JSON"` imports successfully,
retains the image bytes, and produces no reader credit because
`parseCreditSnapshot()` discards it. The disposable probe returned
`success: true`, `assetRestored: true`, and `readerCredits: []`, with no malformed
snapshot warning. The existing malformed-provenance test only corrupts the
catalog ID, so it does not cover this case.

Validate bounded snapshot structure, credit requirements/links and identity
consistency before writing the image; malformed provenance must not create a
usable uncredited image. Keep `IMPORTED_DECLARATION` as the verification origin.
Add regressions for invalid JSON, missing required credit, mismatched identity,
and partial failures after image-row creation.

### 2. Public/player renderers discard placement descriptions

`src/lib/public-world.ts` does not select the new world/article alt fields.
Public and campaign home/article pages render cover/portrait images with
literal `alt=""`. The author viewer uses `resolvePlacementAlt()`, but those
reader paths do not. Thus a saved informative description becomes decorative
to screen readers after sharing/publication. The author world-home preview
also supplies an empty legacy fallback while its control suggests the title.

Project descriptions through authorized reader data and use the shared helper
in every renderer. Apply global-cover fallback descriptions together with the
fallback image. Verify null/title fallback, explicit decorative empty string,
and custom descriptions through public and campaign HTTP/rendering tests.
The model/helper semantics themselves pass their focused tests.

### 3. The legacy-export guard misses revision-only placement data

`worldNeedsV3()` checks current world/article alt, category images, provenance,
and restrictions, but never checks `ArticleRevision`. A world with a retained
revision containing `coverImageAlt: "Revision-only description"` and no current
new fields returned `false` in a disposable probe. A legacy v1 export can
therefore pass the guard despite dropping the new recoverable placement data.

Include retained revision placement fields in the guard, and test a world whose
current placements are cleared while revision placement fields remain. The
existing guard test creates provenance and does not isolate this case.

### 4. V2 exports silently ignore filtering flags

The export endpoint rejects filters for v3 and tells callers to request v1/v2
for filtered output. Its v2 branch calls `exportWorldV2()` without applying
`includeAssets` or `includePrivate`. A disposable request with
`format=v2&includeAssets=false&includePrivate=false` returned HTTP 200 with one
image and the private draft article still included.

Implement supported v2 filtering or reject those options explicitly and correct
the guidance. Add an HTTP regression that asserts omitted private records and
bytes, rather than only response success.

### 5. Reader credits drop attribution details and additional provenance

`src/lib/stock-credits.ts` keeps only title, credit text and placement, and takes
the first valid provenance row per asset. `ReaderImageCredits.tsx` renders that
text without source/license links or the separate modification notice. The
manifest stores these details separately, so required information can disappear
despite intact provenance in the database/export. Multiple provenance records
on identical bytes are supported by storage but later credit requirements are
ignored by the reader projection.

Project the validated links and modification notice, and preserve all applicable
credit requirements when deduplicating. Cover distinct adjacent/section credit
requirements on the same deduplicated asset. The heading currently says
“Image credits”; the agreed design calls for “Artwork credits”.

### 6. Installed pending candidates are presented as reviewed

All eight installed entries still have reviewer `PENDING HUMAN REVIEW`, but are
`available`; the validator accepts any nonempty reviewer and
`isStockArtSelectable()` checks lifecycle/allowed-use flags only. The inspector
unconditionally says “Reviewed catalog provenance”, and selection writes
`BUNDLED_REVIEW`. The browser smoke test confirmed this behavior with the
development catalog.

This does not establish rights approval. Keep the declared human gates open and
make pending-development status explicit before distributing the image. If the
intended gate must survive packaging, add an explicit review/admission state
and enforce it in the production catalog/build/selection path; do not rely on
the presence of a reviewer string or silently fabricate a reviewer name.

## Checks completed and limits

- Fixed repo-wide ESLint scope mismatch and added three real-config regression
  tests. `pnpm lint` and `pnpm exec tsc --noEmit` exit successfully. ESLint still
  emits an existing nonfatal JSX AST diagnostic.
- Removed the ignored `.tmp-isolated/` scratch directory; root `.tmp-*.mjs`
  scripts were already absent. Scratch scripts used for this review live under
  `/tmp`, outside the repository.
- Updated the stale installed-catalog test and retained empty-catalog fixture
  coverage. The focused lint/placement/catalog/credit/materialization/round-trip
  selection passes 29/29 tests with zero skips.
- Reran the full suite with matching disposable database/asset paths and both
  integration flags enabled: 208/208 tests passed, zero skips. The confirmed
  findings above are gaps in existing coverage, not passing regression tests.
- `pnpm stock-art:validate` validates eight installed entries, revision
  `2026-10-23.live`, manifest digest
  `8f260b83c5f0e4f46f588ab2f447a4b8cf6fb5cd78d7ebc93ad054b799e36df5`.
- Existing materialization tests verify stable world IDs on repeat selection,
  same-world hash deduplication, concurrent selection, title/alt preservation,
  and copied bytes. The v3 happy-path test verifies remapped placements,
  provenance/source preservation, display restrictions and imported origin.
- Imported verification is correctly downgraded to `IMPORTED_DECLARATION` in
  the normal path. Per-version catalog immutability remains a packaging/review
  discipline: validation does not compare a changed manifest against a previous
  release. Existing selected world bytes remain independent of catalog changes.
- Headless Chromium loaded all eight cards/thumbnails, used stock art as a
  world cover, saved it, and confirmed persistence in the disposable database.
  At 320px and 390px, Back restored focus to the selected card and dialog
  `scrollWidth` equaled `clientWidth`; there were no page errors. This is a
  smoke check, not complete mobile/accessibility approval.

The review used `/tmp/worldforge-issue7-review-5zl402ue/` for a disposable project
copy, database, assets, logs, and probes, with a dev server on port 3145. The
user's configured database, account, uploaded assets and server on port 3034
were not modified. Webpack was used because Turbopack rejected the temporary
project's external `node_modules` symlink. Screenshots are linked from
[`screenshots/README.md`](screenshots/README.md).

Existing production/container-build evidence remains historical; it was not
rerun for the ESLint/test/docs changes. Human rights, collection/placement,
full accessibility, and withdrawal-drill sign-offs remain open.
