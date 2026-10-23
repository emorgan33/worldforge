<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Tests and database isolation

Read the integration-test setup in [CONTRIBUTING.md](CONTRIBUTING.md) before
running the full suite. Run `pnpm test` only against a dedicated temporary
SQLite database and temporary asset directory, with the dev server pointed at
those same paths. Set `WORLD_CREATION_TEST_DATABASE_URL` as documented so the
world-creation integration test is included rather than skipped. Never run
tests or `pnpm db:seed` against a user's configured database.

## Reader and workspace navigation

Read [reader navigation and discovery](docs/reader-navigation-and-discovery.md) before changing public or player reader navigation, reader search, or the campaign sidebar. The shared reader tree and search live in `src/components/public/ReaderCategoryTree.tsx`, `ReaderMobileBrowse.tsx`, and `ReaderSearch.tsx`; category ordering and reader URL helpers live in `src/lib/category-tree.ts`. Public and campaign routes have separate data projections. Preserve public publication/visibility filters and campaign `readableWhere()` filtering, including the rule that player readers receive only category paths containing readable articles.

Keep reader navigation usable at narrow widths: the browse tree is disclosed in a compact control, category branches can be expanded or collapsed, and the current page remains identifiable to assistive technology. In the author workspace, the desktop sidebar can collapse and mobile navigation opens as a drawer. Hide the World contents scrollbar without disabling scrolling.

When refreshing README screenshots, use the public Aethelgard demo and an isolated temporary database. `pnpm db:seed` replaces database contents; never run it against a user's configured database just to capture screenshots.

## Interactive maps

The **Interactive maps** author view is a GM cartography editor with maps, layers, pins, labels, and canvas drawings. Read [the interactive maps guide](docs/interactive-maps.md) before changing it. The editor lives in `src/components/map/InteractiveMap.tsx`; the workspace mutation handler is in `src/components/AuthorWorkspace.tsx`; persistence and validation are in `src/app/api/maps/route.ts`; ownership resolution is in `src/lib/auth.ts`; export/import lives in `src/lib/world-export.ts`.

Store annotation geometry as percentage JSON and keep the `MapElement` kinds (`LABEL`, `LINE`, `CIRCLE`, `RECT`, `PATH`) and eraser style (`{ "erase": true }`) consistent across the editor, API validation, rendering, and world export/import. Drawings render in chronological order on a canvas: ink uses `source-over` and eraser strokes use `destination-out`. Preserve layer visibility filtering and the rule that unlayered pins/annotations always show. Maps are currently author-only; do not describe them as reader-facing until a reader projection exists.

The focused checks are `tests/interactive-map.test.tsx` (component rendering and tools) and `tests/world-export-roundtrip.test.tsx` (annotation export/import and layer remapping). See `docs/interactive-maps.md` for commands and the isolated-database test setup.

## Interactive character sheets

Character articles use the D&D 5e 2014 or Pathfinder 2e Remaster sheet selected by the article rules profile. Read [the character sheet guide](docs/character-sheets.md) before changing this feature. The profile definitions, row serialization, validation, calculated D&D ability modifiers, and reader projection live in `src/lib/character-sheet.ts`; the shared editable and read-only sheet lives in `src/components/article/CharacterSheet.tsx`.

Keep the two profiles' mechanics and repeatable-row keys separate. Preserve existing article metadata, prose, unknown row extensions, local drafts, revisions, and export/import data. Public and campaign readers must receive only the active profile's known sheet fields and row columns. The current sheets are manual-entry sheets: changing class, level, training, or attributes does not calculate final statistics, aside from D&D ability modifiers. Do not describe them as a full character builder unless that behavior has been implemented and documented.

The focused model and compatibility checks are in `tests/character-sheet.test.tsx`; the server-backed persistence and reader checks are in `tests/character-sheet-api.test.tsx`. Consult `docs/character-sheets.md` for the documented commands and integration-test setup.
