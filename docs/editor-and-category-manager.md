# Editor and category manager

This milestone follows the authoring and organization workflows identified in the supplied World Anvil tutorials. It does not claim an exact visual reconstruction of its authenticated editor, which was not accessible during the earlier review. D&D 2014 and Pathfinder 2e Remaster profiles remain intact.

## Editor

- Inline + and drag handles follow the hovered or focused top-level block. The handle menu offers move up/down, duplicate and delete; transactions participate in undo/redo.
- Slash commands open near the writing position, support filtering and keyboard selection, and insert text, headings, lists, quotes, callouts, URL images, tables and compendium statblocks.
- Read-aloud, note and GM-note callouts are real schema nodes. GM notes remain visible to the owner. The subsequent [publishing milestone](publishing-and-permissions.md) removes their entire subtree from public readers.
- Tables have row/column controls. Images accept HTTP/HTTPS URLs and alternative text. The subsequent [image library milestone](image-library.md) adds persistent uploads and reuse.
- Embedded statblocks resolve against the world's current compendium in both authoring and article preview. Missing references have an explicit placeholder.
- The editor loads structured JSON where available, falls back to older HTML, and saves both. The preview uses the same block schema, including nested content and rendered variable pills.
- Unsaved changes are indicated, and leaving a dirty article requires a discard decision. The subsequent [autosave and recovery milestone](autosave-and-recovery.md) adds debounced saves and local draft recovery. A successful write remains successful if a subsequent list/detail refresh fails.

## Organization

The sidebar and manager share a nested, collapsible article tree. Search retains matching ancestors. The manager supports category creation, renaming, nesting, sibling ordering, deletion and article reassignment. Drag targets and explicit move controls provide equivalent organization paths. The homepage table of contents follows category and article order and continues to exclude drafts.

`/api/categories` scopes all mutations to a world. Category moves reject self-parenting and descendant cycles. Moves and reorder operations use database transactions. Deleting a category promotes its direct child categories and articles to its parent, preserving descendant relationships and article content.

The additive schema change is `Article.order Int @default(0)`. Existing category hierarchy/order fields are reused. A consistent SQLite backup was saved to `/tmp/worldforge-before-organization-20261014213643.sqlite` before applying the change. Other installations need `pnpm exec prisma db push` and `pnpm exec prisma generate` before running this version; no reseeding is required.

## Verification

Run `pnpm test` for block transaction, table integrity, category hierarchy, rules-profile and legacy-content regression tests. An optional local API integration test runs with `WORLDFORGE_TEST_ORIGIN=http://127.0.0.1:3033 pnpm test`; it creates isolated records and removes them afterward. All 15 tests passed against the production server, alongside TypeScript, focused ESLint and the production build.

Production Chromium checks passed for nested category creation/rename/reparenting, category dragging, rich-block insertion and preview, save failure recovery, successful writes followed by failed refreshes, unsaved navigation protection, reopen/reload persistence, inline move/duplicate/delete/drag and undo, article dropdown and drag reassignment, and content-preserving category deletion. Fixtures were removed afterward.
