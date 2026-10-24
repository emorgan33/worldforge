# Feature improvement task list

Updated: October 23, 2026.

WorldForge is a block-based campaign authoring site focused on **D&D 5e 2014** and **Pathfinder 2e Remaster**. World Anvil informs its authoring and presentation workflows; exact visual parity with its authenticated editor has not been verified. Reference evidence and its limits are recorded in [the reference review](world-anvil-reference-review.md).

Checked items are implemented and verified in this workspace. Unchecked items are planned work, not existing capabilities. Later enhancements below are proposals to refine as work reaches them; this document does not authorize external publication or rules-content imports.

## Completed improvements

- [x] Separate author workspace, world homepage preview and public reader pages. [Details](publishing-and-permissions.md)
- [x] Night watch author workspace with a compact campaign desk, world settings destination, and responsive navigation. [Design and validation](feature-requests/night-watch-author-workspace.md)
- [x] Block editor: slash commands, inline handles, drag/reorder, duplicate/delete, undo/redo, tables, images, callouts and compendium embeds. [Details](editor-and-category-manager.md)
- [x] Category manager: nested categories, rename/reparent/order, article assignment and content-preserving category deletion. [Details](editor-and-category-manager.md)
- [x] Debounced autosave, save feedback, local draft recovery and unsaved-navigation protection. [Details](autosave-and-recovery.md)
- [x] Searchable ID-based article links, inline navigation and backlinks. [Details](article-links-and-backlinks.md)
- [x] D&D 2014 and PF2e Remaster campaign profiles and structured Character, Creature, Spell, Item and Encounter templates. [Profiles](rpg-systems.md) · [Templates](structured-rpg-templates.md)
- [x] Interactive D&D 2014 and Pathfinder 2e Remaster character sheets with editable statistics, repeatable sections, autosave, and reader-safe projections. [Details](character-sheets.md)
- [x] Interactive map authoring with multiple maps, layers, linked pins, labels, lines, circles, rectangles, freehand drawing, a paint-style eraser, and export/import. [Details](interactive-maps.md)
- [x] Persistent image uploads/library, reusable body images and article/world covers. [Details](image-library.md)
- [x] Local email/password author accounts, owner-only APIs and separate publication status/visibility. [Details](publishing-and-permissions.md)
- [x] Public Share URLs with GM notes, secrets and inaccessible references excluded from reader content. [Details](publishing-and-permissions.md)
- [x] Ctrl/Cmd+K command search for article metadata, categories and workspace tools. [Details](command-search.md)
- [x] World themes, backgrounds, accent colors, reading widths and live author preview. [Details](world-appearance.md)
- [x] Separate D&D 2014 and Pathfinder Remaster book themes and edition-specific statblock presentation. [Details](world-appearance.md#edition-specific-styles)
- [x] Edition-specific statblock emblems and action-cost icons, with accessible text labels. [Details](world-appearance.md#statblock-icons)
- [x] Refine the Pathfinder theme against the supplied pf2e-style reference. [Details](pf2e-style-reference.md)
- [x] Refine the D&D 2014 theme against Homebrewery, including local PHB fonts and textures. [Details](homebrewery-style-reference.md)
- [x] Category-specific Pathfinder creature/NPC, hazard, feat, spell and item formatting, with expanded authoring and preview. [Details](pathfinder-statblock-formats.md)
- [x] Add responsive campaign navigation with a collapsible desktop sidebar, mobile drawer, and scrollable World contents pane without a visible scrollbar.
- [x] Visible category navigation, breadcrumbs and reader search for public worlds and articles. [Details](reader-navigation-and-discovery.md)
- [x] Owner-scoped author search of article bodies, with filters, pagination and category paths. [Details](search-improvements.md)
- [x] **Article revision history and recovery** - Server-side article revisions with full content snapshots, restore functionality, concurrent edit detection via versioning, and owner-only access. [Details](article-revisions.md) (Milestone 4 completed October 15, 2026)

## 1. World themes and backgrounds — completed

- [x] Add persistent world appearance settings: preset theme, page background color/image, accent color and reading width.
- [x] Add appearance controls to world settings and reuse the image library for background selection.
- [x] Apply appearance consistently to public world and article pages, with an author preview.
- [x] Keep homepage cover, global article cover, article-specific cover and page background as distinct settings.
- [x] Provide reset-to-default behavior and readable defaults for worlds without appearance settings.
- [x] Verify persistence, mobile layouts, text contrast, cover precedence and owner/public image access. Ensure a public background is accessible only while its world grants reader access.

Done when an owner can customize and reset a world's appearance, reload it, and see the same presentation on its public pages without exposing private images or changing other worlds.

## 2. Reader navigation and discovery — completed

- [x] Add visible category navigation and breadcrumbs to public readers, preserving category/article ordering.
- [x] Add reader search scoped to published public articles in a public world.
- [x] Keep author search and reader search permissions separate; exclude private titles, excerpts and counts from reader results.
- [x] Add useful empty states and verify nested-category navigation on narrow screens.

Done when readers can find and browse public lore without returning to the author workspace or discovering private entries.

## 3. Search improvements — completed

- [x] Expand author search beyond loaded metadata to article body text using an owner-scoped server query.
- [x] Add article/template/status/category filters and pagination for larger worlds.
- [x] Show category paths to distinguish identically named articles and nested categories.
- [x] Preserve keyboard selection, modal focus behavior and unsaved-edit guards as results become asynchronous.

Done when large-world search finds body text and paginates reliably, with no cross-owner results or stale-query navigation.

## 4. Article history and recovery — completed

- [x] Add server-side article revisions with retention limits and recorded save times.
- [x] Provide revision preview and explicit restore, saving the current version before restoring an older one.
- [x] Detect edits from another tab/session before overwriting newer server content.
- [x] Keep revision access owner-only and distinguish local recovery drafts from saved revisions.

Done when owners can inspect and recover prior saved content, and conflicting edits do not silently overwrite each other.

**Implementation details:**

- Added `ArticleRevision` model to Prisma schema with full content snapshots (title, slug, excerpt, content, metadata, tags, publication state)
- Added `version` field to `Article` model for optimistic concurrency control
- Updated `POST /api/articles` to create initial revision on article creation
- Updated `PATCH /api/articles/[id]` to create revision before each save (snapshots previous state)
- Added `GET /api/articles/[id]/revisions` to list all revisions with timestamps and user info
- Added `POST /api/articles/[id]/revisions` to restore to a specific revision (auto-backs up current version)
- Revision tracking preserves full content state at each save point
- Version-based concurrent edit detection prevents silent overwrites
- All revision endpoints enforce owner-only access via world ownership check
- Local localStorage drafts remain separate from server-side revisions

**Verification:**
- Build successful with no TypeScript errors
- All 56 tests pass (8 skipped, 0 failed)
- Development server running on `http://localhost:3001`
- Login working with seeded user (`lorekeeper@worldforge.dev` / `WorldForge123!`)
- Revisions API tested and working
- Restore functionality tested and working

## 5. Campaign play improvements

- [x] Expand Encounter articles with structured participants linked to the existing compendium.
- [x] Design separate D&D 2014 and PF2e Remaster encounter-planning views, verifying edition-specific calculations against primary references before implementation.
- [x] Improve session preparation with links among adventure outlines, encounters, locations and recaps.
- [x] Preserve each article/statblock's rules profile when the campaign default changes.

Done when a GM can prepare a linked encounter/session using their campaign's edition without manually duplicating compendium data.

**Implementation details:**

- Added 6 participant fields (`pf2eParticipant1-6` / `dnd5eParticipant1-6`) for linking creatures and NPCs from the compendium
- Added environment section with conditions, terrain features, and weather fields
- Encounter participants render as a dedicated section with monster/NPC picker dropdowns
- Linked statblock previews appear inline when participants are selected
- Per-article rules profile stored in metadata (`rulesSystem` field), initialized from world default but changeable per article
- **Session prep cross-linking**: Encounter articles link to setting locations, plot arcs, and session reports
- **Plot Arc templates** include key encounters and sessions run, plus previous/next arc linking
- **Session Report templates** include linked encounters, plot arcs, and key locations, plus recap and next session hooks
- Edition-specific encounter threat/difficulty labels (PF2e: Trivial/Low/Moderate/Severe/Extreme; D&D 2014: Easy/Medium/Hard/Deadly)
- All 60 tests pass, including new tests for session preparation linking fields

## 6. Advanced presentation

- [x] Define a scoped custom-CSS approach after preset themes are stable.
- [x] Add draft preview, validation and a reliable reset before enabling custom styles.
- [x] Verify custom styles cannot affect author controls or other worlds, and account for remote asset loading.

Done when optional custom styling remains confined to a world's reader presentation and can be safely disabled by its owner.

**Implementation details:**

- Added `customCss` field to `WorldAppearance` interface
- Custom CSS validation rejects dangerous patterns: `@import`, `@font-face`, `position: fixed`, `position: sticky`, high `z-index` values
- Balanced braces check ensures valid CSS syntax
- `scopedCustomCss()` function wraps all selectors with `.wf-reader` scope prefix
- Custom CSS is only applied in `WorldPresentation` component with `.wf-reader` class on reader pages
- Author UI includes collapsible "Custom CSS (Advanced)" section with textarea editor
- Reset button clears custom CSS; full appearance reset also clears it
- All 60 tests pass including new custom CSS validation tests

## 7. Library and maintenance improvements

- [x] Show image usage in covers, backgrounds and article bodies before offering permanent deletion.
- [x] Design reference-aware cleanup for orphaned asset files and deleted-world assets.
- [x] Add a documented backup/restore workflow covering both SQLite and asset storage; verify a restore using disposable data.
- [x] Add a portable world export/import design covering article JSON, categories, references, templates and assets, with explicit ID remapping and validation.

Done when owners can identify asset dependencies and recover or move a complete world without broken references or lost files.

**Implementation details:**

### Asset Usage Tracking
- `GET /api/assets/[id]/usage` returns where an asset is referenced: world cover, banner, background, and article bodies
- AssetLibrary UI shows "Show usage" button with expandable panel listing all references
- Usage is checked before permanent deletion, blocking deletion of referenced assets

### Safe Deletion Workflow
- `DELETE /api/assets/[id]` archives the asset (soft delete) without reference checking
- `DELETE /api/assets/[id]/permanent` checks for references before hard deletion
- Permanent deletion returns `{ referenced: true, references: {...} }` if asset is in use
- UI shows confirmation dialog with warning when asset is still referenced

### Orphan Cleanup
- `DELETE /api/worlds/[id]/cleanup` removes orphaned archived assets from database and disk
- Cleans up orphaned files that exist on disk but have no database record
- Returns deleted assets list and any errors encountered

### World Export
- `GET /api/worlds/[id]/export` exports complete world as JSON bundle
- Query params: `includeAssets` (default true), `includePrivate` (default false)
- Includes: world metadata, categories, articles, assets (base64 encoded), statblocks, secrets, timelines, maps, variable collections
- Imported worlds are always set to private; articles become drafts

### World Import
- `POST /api/worlds/import` imports exported JSON bundle
- Generates new UUIDs for all entities (ID remapping)
- Automatically resolves slug conflicts by appending suffix
- Returns import summary with warnings for issues

### Backup/Restore Documentation
- Full documentation at `docs/backup-restore.md`
- Covers SQLite backup using `.backup` command
- Asset backup using tar archives
- Complete backup script with manifest
- Restore procedure with verification steps
- Per-world export/import for live backups

## Verification for each milestone

- [x] Record behavior, compatibility changes and any migration/backup steps in a focused milestone document.
- [x] Run checks appropriate to the change: focused lint, TypeScript/build, meaningful regression tests and browser verification of affected workflows.
- [x] Use isolated test records and remove them afterward; preserve existing campaign content.
- [x] Update this checklist only after implementation and verification are complete. (Milestones 1-7 completed October 15, 2026)
- [x] **Performance optimization** completed October 15, 2026 (see [performance.md](performance.md))

## Future Enhancements

### Player-only account flow (completed October 21, 2026)

The foundation includes `WorldMember` records, owner-managed membership and
audience-policy APIs, and a reader at `/c/[worldSlug]`. New accounts created
by `auth:setup -- --create` remain author accounts. The invitation flow creates
player-only accounts or adds an existing account as a player in one world.

- [x] Add an explicit player-only account capability and an administrator or GM
  path to create or invite a player. Support inviting an existing account without
  changing its ownership of other worlds. Do not turn player invitations into
  open registration or let an invite grant author access.
- [x] Give GMs a membership screen to invite by email, see pending and active
  players, resend or cancel invitations, and revoke membership. Use expiring,
  single-use, email-bound invitation links; validate that only the world owner
  can manage invitations and memberships.
- [x] Let invited players set a password or use an existing account, sign in,
  and land on a player home page listing worlds they can read. Route player-only
  accounts away from the author workspace and block world creation, editing,
  owner APIs, and private GM data on the server.
- [x] Connect GM sharing controls to audience policies and snapshot grants so
  GMs can choose which members see each resource. Keep new content private by
  default, show exactly who has access, and make revocation effective for direct
  links, search, images, and cached sessions.
- [x] Complete player reader navigation and empty states for worlds with no
  shared content. Verify that titles, category paths, search results, counts,
  assets, and links reveal only material the player may read.
- [x] Cover new-player claims, existing-account invitations, duplicate and
  expired links, role transitions, owner isolation, revocation, and cross-world
  access with isolated HTTP integration tests. Document migration and recovery
  behavior for existing installations.

Done when a GM can invite a player from the app, the player can claim or use an
account and find their shared worlds after login, and a player-only account
cannot create or edit worlds or access unshared material. Revoking membership or
a grant must remove access immediately.

Implementation, migration, recovery, and verification details: [Player accounts and invitations](player-accounts.md). Invitation links are generated for the GM to copy and share; this installation has no outbound email service.

### FoundryVTT Integration
A comprehensive proposal for bidirectional Foundry VTT integration has been documented at [foundryvtt-integration.md](foundryvtt-integration.md).

**Overview:**
- Export WorldForge statblocks, items, and journal entries to Foundry compendiums
- Import Foundry actors and items into WorldForge as linked statblocks
- Three-phase implementation: Basic export → Basic import → Advanced sync


## Milestone: GM table-safety foundation (October 2026)

**Status: Complete** — all 12 tasks delivered across 4 phases.

See `.hermes/plans/2026-10-16_063812-worldforge-gm-table-safety.md` for full task list.

### What was built

- Phase 0: Authorization seam with typed Actor kinds, ResourceRef, requireReadableResource
- Phase 1: Prisma models for WorldMember, AudiencePolicy, AudienceGrant, AccessAuditEvent, PreviewSession, CampaignSession, SessionEntityLink
- Phase 2: Membership/audience/audit/preview APIs with immutable audit trail
- Phase 3: Rules/canon badges, session desk UI, entity picker, player reader at /c/[worldSlug]
- Phase 4: Clone endpoint, effective-policy enforcement, v2 export/import, recovery drill tests

## Curated stock-art library (issue #7) — implementation complete; release review open

This is separate from the completed “Library and maintenance improvements”
milestone numbered 7 above. Slices 1–7 are implemented, including the catalog
contract, review scaffolding, validator, durable provenance and selection APIs,
picker integration with source filters, placement completeness, reader credits
and reference integrity, portable v3 export/import, withdrawal tooling, and
automated release verification. Eight candidates are installed in the
development catalog and clearly labelled pending; no artwork is approved, so
production selection remains disabled. Human rights, collection, placement,
browser and accessibility sign-offs remain open. Implementation completion does
not constitute those approvals.

- [x] Define and validate a versioned local catalog manifest with rights
  evidence, allowed-use gates, purpose recommendations, file digests, and
  lifecycle state. Run `pnpm stock-art:validate`.
- [x] Add the collection brief, contact-sheet, and subject-by-placement coverage
  templates under `docs/stock-art-review/`.
- [x] Add durable provenance and world-nested selection APIs that copy reviewed
  bytes into world-asset storage with `(worldId, sha256)` deduplication.
- [x] Add World images/Stock art tabs, All saved/Uploaded/Stock source filters,
  purpose-aware recommendations, placement previews, and the selected-artwork
  inspector with credits and provenance status.
- [x] Add placement description fields (`Article`/`World` alt columns, revision
  and draft snapshots), portrait editing, category illustrations, shared
  placement geometry, and human-readable accessibility controls.
- [x] Add reader credits, reference repairs, and category-image reader fallbacks.
- [x] Add portable v3 export/import, legacy export guards, withdrawal advisories,
  and Docker packaging.
- [ ] Complete item-by-item rights review and the first approved collection.
- [x] Complete automated release verification (suite, build, catalog and
  packaging checks recorded).
- [ ] Complete human release verification (rights, collection/placement,
  browser/accessibility review, screenshots and withdrawal drill).

See [Curated stock art](stock-art.md), the
[release verification record](stock-art-review/release-verification.md), and the
[implementation plan](feature-requests/curated-stock-art-library.md).
