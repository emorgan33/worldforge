# Stock-art release verification

This is the release-verification record for the curated stock-art library
(issue #7). It maps each acceptance criterion to automated coverage and to the
release evidence that must be recorded before stock selection ships.

Status: **implementation corrections verified; human review gates open.**
The [implementation review](implementation-review-2026-10-23.md) is historical;
its findings are addressed by the [corrections](fixes-2026-10-23.md) with
regression coverage. The rights review, the
collection/placement visual approval, the browser/accessibility review, and the
final screenshots are **not** done and are marked `OPEN`. Stock selection stays
out of a released build until those gates close. The development catalog
(`resources/stock-art/manifest.json`) now contains eight selectable candidates;
all still record `PENDING HUMAN REVIEW` and explicit `reviewStatus: "pending"`.
Production catalog selection excludes them. Development selection records
`PENDING_REVIEW` and the inspector identifies it as unverified. Installation and selection do not
constitute human rights or design approval.

## Automated evidence

| Check | Command | Result | Date |
| --- | --- | --- | --- |
| Installed development catalog validates | `pnpm stock-art:validate` | valid, 8 pending entries, revision `2026-10-23.live-review-state`, manifest `8f8b7b274d460c5c67aebbaeebe4880558bd4cfb96b5e700b65fd2a17a3c8e19` | 2026-10-23 |
| Staged candidates validate | `pnpm stock-art:validate docs/stock-art-review/candidates` | valid, 8 pending entries, revision `2026-10-23.candidates-review-state`, manifest `4e169284d26459831dcc403a4e9fdf9d5b4b62429c2ad33d22c87624e6acf55d` | 2026-10-23 |
| Type check | `pnpm exec tsc --noEmit` | exit 0 | 2026-10-23 |
| Repo-wide lint | `pnpm lint` | exit 0 after scoping the hooks override to Next-supported file types and excluding `.tmp-*/**`; JSX AST utility emits a nonfatal diagnostic | 2026-10-23 |
| Focused review regressions | `node --import tsx --test --test-concurrency=1` on ESLint config, placement, catalog, credits, materialization, and round-trip suites | 29 / 29 pass, 0 skipped | 2026-10-23 |
| Headless picker smoke check | Disposable project copy, dev server, SQLite database and asset directory | all 8 cards/thumbnails loaded; pending label and stored `PENDING_REVIEW` verified; cover selection persisted; 320/390px Back restored card focus; no dialog horizontal overflow or page errors | 2026-10-23 |
| Focused lint (changed/new files) | `pnpm exec eslint <files>` | 0 errors (only expected `@next/next/no-img-element` warnings) | 2026-10-23 |
| Production build | `pnpm build` | exit 0 | 2026-10-23 |
| Full isolated suite (after corrections) | `pnpm test` against a temp SQLite DB + asset dir and a dev server on the same paths (`WORLDFORGE_TEST_ORIGIN`, `WORLD_CREATION_TEST_DATABASE_URL`) | 220 / 220 pass, 0 skipped; isolated server on port 3146 | 2026-10-23 |
| Review-state migration regression | `node --import tsx --test tests/stock-review-migration.test.ts` | pass; malformed legacy JSON/reviewers corrected, imported claims and evidence preserved, default pending | 2026-10-23 |
| Container packaging | `docker build .` | exit 0; build stage runs `pnpm stock-art:validate && pnpm build` | 2026-10-23 |
| Container runtime | run the image with `DATABASE_URL` + `WORLDFORGE_ASSET_DIR` | migrations applied; `GET /setup` = 200; `GET /api/worlds` = 401 unauthenticated; `resources/stock-art/` and `scripts/` present in the image | 2026-10-23 |

The repo-wide lint failure was a flat-config scope mismatch: Next registers
`react-hooks` for `js/jsx/mjs/ts/tsx/mts/cts`, while the unscoped local override
also applied to CommonJS files in scratch copies. The override now matches
Next's file scope and scratch copies are globally ignored. Regression tests
cover CommonJS config resolution, the retained hooks warning in application
components, and ignored scratch paths. The old catalog-scaffold test also
expected zero installed entries; it now validates installed bytes/evidence and
retains empty-catalog coverage through a disposable fixture.

The production build, full suite, type check, catalog validation and repo-wide
lint were rerun after the corrections. Container results remain historical;
container packaging was not rerun for these changes. Headless screenshots and smoke results supplement
the human browser/accessibility gate; they do not close it.

## Acceptance-criterion coverage

| Request criterion | Automated coverage | Release evidence |
| --- | --- | --- |
| Existing pickers support stock and uploads | `stock-art-picker.test.tsx`, `assets.test.tsx`, `assets-api.test.tsx` (source filters before pagination, placements, inspector state) | `OPEN` — browse → inspect → use → replace → cancel → clear → reload, including retired saved stock |
| Coherent collection, search/filter, readable previews | `stock-art.test.ts`, `stock-art-picker.test.tsx`, `image-placement.test.ts` | `OPEN` — approved brief/contact sheet and subject-by-placement coverage sheet |
| Provenance and required credits | `stock-art-storage.test.ts`, `stock-credits.test.ts`, `reader-credits-api.test.tsx` | `OPEN` — item-by-item rights records; exact inspector/reader credits; long adjacent credits at narrow widths |
| Stable references and editable alt | `placement-api.test.tsx`, `article-drafts.test.tsx`, `world-export-roundtrip.test.tsx`, `world-export-import-api.test.tsx`, `world-backup-restore.test.tsx`, `character-sheet-api.test.tsx` | `OPEN` — restart/catalog-removal/import-into-catalog-free drill |
| Accessible category artwork | `reader-navigation.test.tsx`, `placement-api.test.tsx` | `OPEN` — 16/24/32px readability, folder fallbacks, labels and disclosure controls |
| Removed/disputed entries handled explicitly | `stock-advisories.test.ts`, `stock-art-storage.test.ts`, `world-export-roundtrip.test.tsx`, `assets-api.test.tsx`, `world-export-import-api.test.tsx` | `OPEN` — withdrawal drill with a published placement, private use, player grant, and an exported/imported copy |
| Responsive picker and recoverable failure states | `stock-art-picker.test.tsx` | `OPEN` — 320/390px, 200% zoom, mobile keyboard, 44px targets, contrast, focus restoration, screen-reader announcements |
| Authorization across actors | `auth-publication-api.test.tsx`, `player-access-api.test.tsx`, `reader-credits-api.test.tsx`, `assets-api.test.tsx` | `OPEN` — GM-note-only image, unreadable portrait/category, player article without a grant, grant revocation, archived/deleted worlds, public image while signed in |

## Manual and accessibility gates (open)

These require a human reviewer and a real browser; they cannot be proven by the
automated suite. Record findings against the dated screenshots under
[`screenshots/`](screenshots/README.md).

- [ ] **Rights review** — for every admitted entry, record item, creator/source
  chain, license basis, dated evidence, reviewer, and all distribution uses
  (bundling, standalone redistribution, world export, modification, public
  display). Replace `PENDING HUMAN REVIEW` in the review records and, only after
  actual approval, set `rights.reviewStatus: "approved"` and bump catalog revision.
- [ ] **Collection review** — approve the brief and contact sheet as a family.
- [ ] **Placement review** — approve the coverage sheet against the actual
  renderer geometry; review narrow and wide crops, category art at 16/24/32px,
  and light/dark reader themes.
- [ ] **Interface review at 320px and ~390px**, 200% zoom, and with the mobile
  keyboard open: filters, credit links, close/back controls, and the primary
  action reachable with no horizontal document scroll and no obscuring sticky
  footer; target 44px touch controls.
- [ ] **Focus and announcements** — keyboard focus restoration after Back/Cancel
  and after use/replace/clear; screen-reader names for the tree, inspector and
  credit; no forced traversal of every thumbnail to reach the inspector.
- [ ] **Contrast** — normal UI/credit text ≥ 4.5:1; meaningful control boundaries
  and focus indicators ≥ 3:1 against adjacent colors; selection and restriction
  states understandable without color.
- [ ] **Withdrawal drill** — restrict a catalog id with a published placement
  using `pnpm stock-art:advisories`, confirm reader bytes stop and owner-only
  explanation remains, then `clear` and confirm recovery.
- [ ] **Screenshots** — picker (desktop + mobile), each placement preview,
  category art at 16/24/32px, reader credits, and failure/empty states.

## Sign-off

| Gate | Reviewer | Date | Result |
| --- | --- | --- | --- |
| Automated suite + build | implementation | 2026-10-23 | pass; 220 tests, regression and browser evidence in corrections record |
| Container packaging | implementation | 2026-10-23 | historical pass; not rerun for corrections |
| Rights review | PENDING HUMAN REVIEW | — | open |
| Collection/placement design review | PENDING HUMAN REVIEW | — | open |
| Browser/accessibility review | PENDING HUMAN REVIEW | — | open |

Mark an acceptance criterion complete only after its automated coverage passes
**and** its rights, design, and interface evidence is recorded.
