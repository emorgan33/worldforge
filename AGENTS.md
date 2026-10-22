<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Interactive character sheets

Character articles use the D&D 5e 2014 or Pathfinder 2e Remaster sheet selected by the article rules profile. Read [the character sheet guide](docs/character-sheets.md) before changing this feature. The profile definitions, row serialization, validation, calculated D&D ability modifiers, and reader projection live in `src/lib/character-sheet.ts`; the shared editable and read-only sheet lives in `src/components/article/CharacterSheet.tsx`.

Keep the two profiles' mechanics and repeatable-row keys separate. Preserve existing article metadata, prose, unknown row extensions, local drafts, revisions, and export/import data. Public and campaign readers must receive only the active profile's known sheet fields and row columns. The current sheets are manual-entry sheets: changing class, level, training, or attributes does not calculate final statistics, aside from D&D ability modifiers. Do not describe them as a full character builder unless that behavior has been implemented and documented.

The focused model and compatibility checks are in `tests/character-sheet.test.tsx`; the server-backed persistence and reader checks are in `tests/character-sheet-api.test.tsx`. Consult `docs/character-sheets.md` for the documented commands and integration-test setup.
