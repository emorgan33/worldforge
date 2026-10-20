# Foundry VTT selective import

Status: selective upload MVP implemented; real-export compatibility validation pending. This plan supersedes the earlier bidirectional sync proposal.

## MVP compatibility and operational boundaries

The initial adapter targets the user's installation: **Foundry 14 build 369, PF2e 8.6.1, Remaster**. This is a provisional, exact-version gate, not a verified compatibility range. Automated fixtures are synthetic; representative equipment, spell and feat exports from that installation are still needed to validate real-world field mapping. Other versions and legacy content remain unsupported rather than being silently interpreted as Remaster.

The MVP accepts Item JSON files and arrays, with no archive, live Foundry connection, image download, overwrite or dependency import. It creates existing private `RpgBlock` records. Dedicated provenance retains selected source documents separately from renderable stats. World backups preserve mapped blocks through the existing statblock export, but intentionally omit temporary previews, import runs and retained Foundry source/provenance. Restoring such a backup therefore does not preserve Foundry duplicate detection. World deletion cascades integration records; block deletion removes its provenance.

Implementation uses the requested GPT-6 Luna subagents for parsing/mapping, backend writes and the picker, followed by GPT-6 Astra review of the concrete integration patch.

### Implemented MVP

- Entry points: world homepage → Edit world & styling → Integrations, and Bestiary & Spellbook → Import from Foundry.
- File preview, source/version declaration, searchable paginated candidates, individual checkboxes, explicit page/matching selection, mapped-field details and warnings, exact selection review, 50-entry browser batches, result navigation, failed-only retry and cancellation of future batches. An in-flight batch finishes; committed entries remain.
- Upload bounds: 100 files, 10 MiB source text total, 1 MiB per document, 1,000 candidates; request bodies are streamed with a separate 12 MiB transport bound. Previews expire after 30 minutes; expired previews are cleaned on subsequent uploads, with at most five active previews retained per author/world in ordinary sequential use.
- PF2e equipment, spell and feat mappings are pure, text-only conversions. Actor exports never expand their inventory. Missing stable source UUID/ID disables import in this MVP; possible-match/create-copy decisions remain deferred. Existing source matches always skip, including changed sources and locally edited destinations.
- Dedicated migration `20261019120000_foundry_import` adds previews, runs, per-entry outcomes and provenance with cascading world deletion. Blocks, provenance and successful outcomes commit atomically. Retries reuse request-bound idempotency keys; explicit failed-only retries start a new run. No overwrite support is exposed.

### MVP verification

GPT-6 Astra reviewed authorization, source identity, migration/cascades, retained-source privacy, atomic outcomes and retry/local-edit behavior; material findings were fixed and verified. `pnpm test` passes 81 tests with 34 existing server-dependent tests skipped. The 21 Foundry parser/service tests include 1,000-candidate selected-only import, malformed/unsupported inputs, Actor inventory exclusion, source identity, expiry, concurrent requests, interrupted runs, local edits and partial failure/retry. TypeScript, changed-file ESLint and the production build pass.

An isolated migrated SQLite database and production server were also used for live authorization/CSRF/cross-world/tampered-ID checks. Chromium selected three entries on different pages of a 1,000-entry upload, changed the search, reviewed and imported exactly those three, retried without duplicates, and opened an imported entry. Previewing created no blocks or image assets. Uploading through the world settings entry point also preserved unsaved world settings without issuing a world update. These checks use synthetic documents; they do not establish compatibility with representative real exports. The additive migration was applied to the local development database after a SQLite backup.

## Goal

Import selected Foundry content into an existing WorldForge world. Users must be able to inspect individual entries and choose exactly which ones are imported. Uploading a source, choosing a pack, or applying a filter never imports content.

First milestone: Foundry Item documents, including equipment, spells and feats. Actors, journals, scenes, export and automatic synchronization are later milestones. Actor-owned inventory is excluded initially because its identity and instance-specific changes need separate handling.

## User workflow

Entry point: world settings → Integrations → Foundry VTT → Import items, with a shortcut from the compendium.

1. **Choose source.** Upload one or more exported Item JSON files or a versioned WorldForge interchange bundle containing Item documents. Individual Foundry exports provide the simplest first implementation. A follow-up Foundry helper provides bulk export from world items and chosen compendium packs through Foundry's document APIs. Do not promise arbitrary world ZIP support or read a running Foundry database directly.
2. **Inspect source.** Identify source system/version and validate supported document shapes. Bundle metadata supplies versions; plain exports may require the user to identify the system/version. Unsupported sources show a reason rather than guessing a conversion.
3. **Choose entries.** Show a searchable, filterable list with a checkbox for every importable entry. Nothing is selected initially. Columns: name, source pack/folder, item type, level/rank where available, rarity, and status. Filters: source, type, level/rank, rarity, new/already imported/changed, and mapping warnings. Only expose filters for metadata available in that source.
4. **Preview.** Clicking a row opens the source description, mapped WorldForge fields, destination category, missing images, unresolved references, and conversion warnings. Unsupported entries are visible but disabled with an explanation.
5. **Review selection.** A persistent selection tray shows the total across filters and pages. Users can remove entries individually, select the current page, explicitly select all matching results, or clear everything. Changing a search/filter never silently adds or removes selections. A matching-results action captures explicit IDs at that moment.
6. **Import selected.** Review the exact selected entries and any per-entry update decisions. The button says, for example, “Import 12 selected items.” Run in bounded batches with progress and a result summary. Offer links to imported entries and retry only failed entries.

Example picker:

```text
Source: Campaign equipment bundle        System: Pathfinder 2e
Search: [healing                    ]    Type: [Consumable v]

[ ] Minor Healing Potion     consumable  Level 1  New
[x] Lesser Healing Potion    consumable  Level 3  New
[ ] Moderate Healing Potion  consumable  Level 6  Already imported

1 selected across all pages       [Review selection] [Import 1 selected item]
```

No dependencies are imported implicitly. References to unselected entries remain readable with a warning; offer an explicit “Add referenced entries” action when those entries exist in the source. Rewrite references only when their destinations were successfully imported or already have a known mapping.

## Initial scope and mapping

Use the existing `RpgBlock` model and compendium, rather than introduce a separate item library. Imported blocks are private authoring content under existing world access rules; do not automatically publish articles or create public pages.

| Foundry document | WorldForge category | Policy |
| --- | --- | --- |
| Equipment, weapons, armor, consumables, treasure | ITEM | Preserve original subtype in import metadata |
| Spell | SPELL | Map system-specific spell fields |
| Supported feat | FEAT | Explicit adapter support required |
| Other system-specific Item types | Unsupported initially | Explain reason; preserve source in temporary preview only |

Build separate adapters for `pf2e` → `PF_2E` and `dnd5e` → `DND_5E`. Begin with one adapter as a complete vertical slice, recommended PF2e; add the other after fixture validation. Exact supported Foundry and system versions must be established with representative exports before implementation commits to a compatibility range. D&D 2024 and legacy Pathfinder content must not be silently relabeled as the application's 2014/Remaster profiles. Require compatible interpretation or block the unsupported conversion.

Map descriptions and the existing item/spell/feat fields. Retain the original selected document with provenance for troubleshooting and future remapping, but do not execute imported macros, scripts, rolls, effects or system automation. Sanitize rich text and render unsupported Foundry markup as readable text. Raw source records remain author-only and are never passed directly to public rendering.

Images are optional: copy only supplied, validated assets referenced by selected entries using the existing image library. A Foundry-relative image path is not an accessible image file. Do not fetch arbitrary URLs automatically; report missing images and allow later replacement.

## Architecture

Keep the integration separate from whole-world backup restore, which creates/restores worlds rather than selecting entries for an existing world.

Suggested modules:

- `src/lib/foundry/parse.ts`: bounded source parsing and validation.
- `src/lib/foundry/adapters/{pf2e,dnd5e}.ts`: pure document-to-block conversion and warnings.
- `src/lib/foundry/preview.ts`: normalized candidates, filters and source identities.
- `src/lib/foundry/import.ts`: authorized, selected-only writes, conflict handling and retry.
- Import wizard beside the existing compendium and world settings components.

Proposed world-scoped endpoints:

- `POST /api/worlds/[id]/foundry/previews`: upload and validate source; return preview ID and counts without creating blocks.
- `GET /api/worlds/[id]/foundry/previews/[previewId]/items`: paginated candidates, details and warnings.
- `POST /api/worlds/[id]/foundry/imports`: submit preview ID, explicit candidate IDs, per-entry action and idempotency key.
- `GET /api/worlds/[id]/foundry/imports/[runId]`: progress and per-entry outcomes.

Persist bounded, expiring previews scoped to the initiating author and destination world. Recheck access, selected-ID membership, supported mapping and preview expiry at commit time. Reject IDs absent from the preview. Apply upload/document/asset limits; if bundle archives are added, bound expanded size and reject unsafe paths. Do not trust browser-supplied mapped block fields.

Add dedicated provenance records linking destination blocks to source identity: source namespace, world/pack identity, document UUID or ID, source system/version, source hash, last-imported destination hash and retained source document. Also persist import runs and per-entry outcomes for progress and retries. Confirm backup/export handling and deletion behavior for these records when adding the schema.

Identity must include its source namespace; names alone never identify duplicates. For plain JSON without reliable provenance, flag possible matches and ask the user to choose skip or create separately. Do not auto-merge same-named entries.

## Re-import and recovery

- Already imported and unchanged: skip by default.
- Source changed: offer an explicit update preview of the linked block.
- Destination edited since the previous import: show a conflict; require explicit replace or create-copy choice. Default to skip.
- Recheck destination versions during commit so edits made after preview cannot be overwritten silently.
- Commit each entry and its provenance atomically. Make retries idempotent within the import run. A deliberate create-copy action receives its own identity.
- Failures do not undo unrelated successful entries. Summary distinguishes created, updated, skipped and failed, with actionable reasons.
- Cancel stops future batches; committed entries remain. State this in the progress screen. Bulk undo is deferred until safe handling of subsequent edits is designed.

## Delivery sequence

1. **Compatibility spike:** collect representative Item exports for the user's Foundry/system versions; confirm metadata, subtypes, descriptions, images and references. Record the compatibility matrix and mapping gaps.
2. **Selective upload MVP:** parser, first adapter, preview list, per-entry checkbox selection, details, selected-only create, provenance and result summary. No overwrite support yet; imported matches skip.
3. **Campaign-scale import:** searchable filters, explicit bulk selection across pages, persisted previews/runs, bounded batches, retry and reviewed re-import updates. Add the second system adapter.
4. **Foundry export helper:** browse permitted world items and pack indexes inside Foundry, select entries, retrieve only selected full documents and download a versioned interchange bundle. Include source identity and versions. Images require a separately validated packaging approach.
5. **Optional connected integration:** reuse the same preview/selection/import contract through a companion module. Design pairing and authorization separately. Actors, journals and outbound export each receive their own scope and mapping plan.

## Implementation model assignments and delegation

User instruction: when implementation begins, use subagents with the following model assignments. The coordinating agent must read this section before starting implementation, divide work into bounded milestones, integrate the results, and verify the acceptance criteria. This planning update does not start implementation.

- **GPT-6 Luna (`gpt-6-luna`) implementation subagents:** upload parsing, checkbox picker, item previews, system mapping fixtures, and selected-only import. Start with one supported system, file uploads, preview, explicit selection, and create-only import. Give each subagent concrete inputs, expected outputs, relevant existing code, and acceptance criteria. Assign separate file ownership when running independent tasks concurrently.
- **GPT-6 Astra (`gpt-6-astra`) review subagent:** review authorization and preview ownership, duplicate/source identity, database migrations and provenance, and protection of local edits during re-import. Review the concrete patch and relevant tests before considering each affected milestone complete. Resolve material findings and verify the fixes before shipping.
- **GPT-5.6 Terra:** a possible alternative for bounded implementation work, not the default assignment. Do not silently substitute it for Luna. If an assigned model is unavailable, report that limitation and agree on a replacement before delegating its work.

Use Luna for focused implementation and Astra for the higher-risk review; do not hand the entire integration to one subagent in a single task. Delegation does not replace integration testing or the coordinator's responsibility for the final result. Avoid parallel edits to the same files and unnecessary repeated reviews.

These assignments are a workflow preference, not a guarantee of relative implementation quality or allowance savings. API pricing does not establish Codex plan allowance consumption.

## Acceptance criteria

- Given 1,000 candidates, selecting three imports exactly those three, including when selected on different pages.
- Filtering, previewing and canceling before commit create no blocks or permanent image assets.
- Unselected dependencies and assets are never imported silently.
- Unsupported types/versions and lossy mappings are visible before commit.
- PF2e and D&D mappings use representative fixtures; unsupported editions cannot silently enter the wrong rules profile.
- Same-name distinct source documents remain distinct; repeat imports do not create accidental duplicates.
- Local edits survive default re-import behavior, including concurrent edits after preview.
- Selected-ID tampering, cross-world preview access, malformed documents and oversized uploads fail safely.
- Retrying a partially failed run creates no duplicate successful entries.
- Imported content remains private under the current access model; scripts and unsafe HTML do not execute.

## Technical references

Foundry exposes compendium index loading separately from full document retrieval, supporting a future index-first picker and selected-document export. Version-specific APIs must be checked against the supported installation:

- [Foundry v13 CompendiumCollection](https://foundryvtt.com/api/v13/classes/foundry.documents.collections.CompendiumCollection.html)
- [Foundry v14 CompendiumCollection](https://foundryvtt.com/api/v14/classes/foundry.documents.collections.CompendiumCollection.html)

Local foundations: `prisma/schema.prisma` (`RpgBlock`), `src/lib/rpg.ts`, existing statblock routes, image validation/storage, and [campaign rules profiles](rpg-systems.md).
