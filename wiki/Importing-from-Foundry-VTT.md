# Importing from Foundry VTT

WorldForge supports **selective Item JSON import**, not live synchronization or
whole-world Foundry migration. The provisional gate targets **Foundry 14 build
369 / PF2e 8.6.1 / Remaster**. Synthetic tests pass, but representative real
exports still need compatibility validation; this is not a supported version
range. D&D/legacy Pathfinder conversion is not provided by this MVP.

## Preview and select

1. Open **Bestiary & Spellbook → Import from Foundry**, or world settings'
   **Integrations** entry point.
2. Upload Item JSON files/arrays and declare the source versions. There is no
   archive upload, live database access, or automatic image download.
3. Search/browse candidates and inspect mapped fields/warnings. Nothing imports
   merely because it was uploaded or a search filter changed.
4. Check explicit entries, review the exact selection, and import those items.
5. Inspect results; retry failed entries only. Cancellation stops future batches,
   not an in-flight batch or already committed entries.

Equipment, spells, and supported feats become private compendium blocks. Actor
inventory is not expanded; macros/effects/automation are not executed. Entries
without stable source identity are unavailable. Existing source matches skip
rather than overwrite, even when the source or destination has changed.

## Limits and portability

- 100 files, 10 MiB source text total, 1 MiB/document, 1,000 candidates.
- Previews expire after 30 minutes. Re-upload after expiry and review again.
- Browser import batches contain up to 50 entries. Committed successes remain
  if later entries fail.
- World exports retain mapped statblocks but omit temporary previews, import
  runs, and retained Foundry source/provenance. Restored worlds therefore do not
  retain Foundry duplicate detection. Full installation backups preserve SQLite.

Back up before major imports. Report mapping problems with a minimal synthetic
or rights-cleared example, never private campaign exports or credentials.

**Source owner:** `wiki/Importing-from-Foundry-VTT.md`; implementation:
`docs/foundryvtt-integration.md` (implemented MVP section, not future plan), `src/lib/foundry/`.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
