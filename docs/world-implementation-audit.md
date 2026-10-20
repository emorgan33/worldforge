# World creation, switching and management: implementation inventory

Inspected October 19, 2026. Read-only application review by the coordinator, GPT-6 Luna (UI inventory) and GPT-6 Astra (critical backend review). This report adds no application changes. Much of the repository was already untracked, so findings come from current files rather than attributing git changes to individual agents.

## Assessment

The original New World/World Switcher feature is substantially implemented but has unresolved acceptance criteria. Later milestones 5–6 added management/deletion code beyond the original four-milestone scope. Milestone 6's “Implementation complete” status is not supported by the current implementation.

| Area | Observed state |
| --- | --- |
| Private world creation | Implemented: validation, bounded request, session ownership, CSRF checks, server slug generation, durable request identity, conflict detection and explicit response projections. |
| Creation recovery/UI | Implemented: form, first-world state, account-scoped pending/confirmed recovery, retry opening and storage-unavailable messaging. Still needs full browser acceptance verification. |
| World switcher | Implemented: owned list, profile labels, current selection, duplicate-title disambiguation, optional search and New world action. |
| Loading and guards | Substantial implementation: parallel loads, epochs, keyed mounted subtree during loads, article/detail stale-response checks, dirty/busy registration for multiple forms. History, failure handling and guard coverage need completion below. |
| Migration state | Local migration status reports up to date. Astra independently applied all five migrations to a fresh isolated database. The similarly named deletion migrations are an empty migration followed by one ALTER, not duplicate column additions. |
| Archive/restore | Broken lifecycle: archive does not set deletedAt and destroys metadata. |
| Duplication | Not exposed through a valid HTTP route. |
| Deleted-world management | Backend pieces exist; UI is absent and active access does not consistently exclude deleted worlds. |
| Export/import | Existing infrastructure exists, but import authorization and backup completeness have gaps. |

## Required corrections, in recommended order

### 1. Correct deletion semantics before adding management controls

- `src/app/api/worlds/[id]/route.ts:17`: archive prefixes the title and clears description, cover, banner and appearance, but **never sets deletedAt**. `deleted/route.ts` and restore/purge query deletedAt, so the normal archive path cannot feed those workflows.
- `src/app/api/worlds/[id]/restore/route.ts:21`: restore only clears deletedAt and cannot reconstruct erased fields. Make archive non-destructive, define whether restoration preserves the prior public setting or remains private, and test the round trip. Previously erased metadata needs recovery from a backup/history if one exists; adding deletedAt will not reconstruct it.
- `src/app/api/worlds/route.ts:18`, `src/lib/auth.ts:29`, `src/lib/access.ts`, `src/lib/public-world.ts:10`: active listing, access and public queries do not consistently filter deletedAt. Add an explicit distinction between active-world access and owner-only trash/restore/purge access. Test nested resources, assets, published pages and existing sessions, not just the switcher list.
- The hard-delete route currently permits active-world deletion; decide whether permanent deletion must require an already archived world, consistently with purge. Add deliberate confirmation in the eventual UI.
- `src/app/api/worlds/[id]/hard/route.ts` and `purge/route.ts`: database asset rows are deleted without removing physical asset files. Use the existing asset removal facility with recoverable cleanup semantics. Consolidate duplicated deletion code and avoid silently swallowing cleanup failures.

### 2. Complete original switching/recovery acceptance criteria

- `src/components/AuthorWorkspace.tsx:288`: declining a history-driven switch replaces the traversed entry with the current world URL. There is no tracked traversal-index/compensating-traversal mechanism from the plan. This can replace a real destination in browser history. Implement and test canceled Back, Forward, repeated traversal and failed target loads without overwriting history entries.
- `AuthorWorkspace.tsx:258`: an unknown URL world clears the mounted world and forms before the dirty guard runs. Apply the leave/failure boundary before discarding an existing workspace, including inaccessible/deleted URL targets.
- `AuthorWorkspace.tsx:249`: a non-OK world-list response becomes an empty list, potentially showing first-world creation instead of a load error. Distinguish list/session errors from a genuinely empty account. Dataset requests also turn successful non-array responses into empty arrays; validate response shapes before committing a snapshot.
- `AuthorWorkspace.tsx:722` and `:637`: settings and profile saves call setWorld without updating the worlds list. Keep title/profile/summary state synchronized so the switcher does not display stale values or later reload an old summary after a failed picker refresh.
- `src/components/article/ArticleEditorForm.tsx:100` and `:131`: draft keys now contain actor ID, but recovery reads only the new key. The planned compatibility reader for existing world-only draft keys is absent. Add safe migration/preservation of authorized-world legacy drafts; do not silently strand them.
- Fix stale guard registrations: child effects report dirty/busy state but do not unregister on unmount, and the parent registry is not cleared on a world commit. Confirmed-discard navigation can therefore leave a dirty registration behind after its form disappears. Register with cleanup and test view/world changes with other forms still mounted.
- Complete guard coverage end to end. `AssetLibrary.tsx:41` reports upload file/title/alt state and parent busy state, but `AssetDetails` at line 100 holds edited title/alt and its own permanent-delete busy state without reporting them. `FoundryImport.tsx:18` has no guard callback prop, and its call sites in WorldHome/BlockStudio pass none; the parent's foundry registry handler is unused. Wire these states, embedded image pickers, category/secret/session editors, portals and uploads into the transition boundary.
- Verify delayed autosaves and child-owned background writes pause/resume correctly during transitions. The article parent rejects saves while switching, but that does not demonstrate all timers or child writes are paused. Test that failed switching leaves both the form values and dirty indicators intact.
- Initial account identity is fetched from `/api/auth/session` rather than passed from the server page as proposed. This is a design deviation, not by itself a defect; verify failure handling, actor availability before storage access and account-change cleanup.

### 3. Finish management endpoints

- `src/app/api/worlds/[id]/route.ts:35` exports `DUPLICATE`, not a supported HTTP method. There is no `[id]/duplicate/route.ts`. Move the behavior to the documented POST route and add ownership, slug-collision, retry and response tests.
- Define duplication depth honestly. Current unreachable code copies only world metadata and original image references, not campaign content. If offering a full duplicate, implement entity and asset copying/remapping; if metadata-only, label that explicitly.
- `src/lib/auth.ts:118` treats `/api/worlds/import` and POST `/api/worlds/deleted` as path world IDs. Those requests fail ownership checks before their handlers. Add exact-route authorization without weakening nested world ownership. Prefer removing the unnecessary POST listing alias if GET is sufficient.

### 4. Add missing management UI

`src/components/worlds/WorldSwitcher.tsx:48` currently offers selection and New world only. Still absent:

- Archive and duplicate actions with clear scope and confirmations.
- Deleted-world/trash view with restore and permanent purge controls.
- Safe handling of archiving/deleting the selected or last active world, including selection URL, local state and list refresh.
- Busy/dirty integration and useful per-operation errors/retries for these actions.
- User-facing whole-world import/export controls if milestone 5 is intended as a complete management workflow, rather than API-only infrastructure.

Starter-content selection/generation is still described as in progress in milestone 5. It was explicitly outside the original creation/switcher scope; treat it as optional separate work rather than a release blocker for the original feature. Publishing controls are already represented by the existing world settings visibility toggle; reconcile documentation instead of assuming they must be built from scratch.

### 5. Correct backup/restore claims

- Current v1/v2 world backups do not serialize maps, layers or pins, contrary to milestone 5's claim of complete-world export. Add round-trip coverage before describing them as complete backups.
- `src/lib/world-export.ts:474`: restored session entity links keep source entityId values after destination IDs change. Remap by entity kind, and handle missing/unexported targets explicitly.
- Verify internal creation metadata remains excluded, restored worlds get fresh identity, and deletion/duplication does not leave cross-world asset references.

### 6. Close verification and documentation gaps

- Fix `tests/world-creation-migration.test.tsx:38`: the fixture applies only the older migrations but uses the latest generated client, which requests World.deletedAt. Test the intended historical stage with an explicit old-field projection/raw query or apply the full migration chain before latest-client reads. This failure is related to the schema addition and should not simply be labeled unrelated/pre-existing.
- Include `tests/navigation-guard.test.ts`, `world-selection.test.ts` and `world-creation-recovery.test.ts` in the normal test command; package.json currently runs only `tests/*.test.tsx`.
- Add authenticated integration coverage for archive → list deleted → restore → purge, duplicate, deletion access boundaries and physical asset cleanup. No dedicated management/deletion regression tests were found.
- Existing backup HTTP tests can return early on 401 without testing behavior. Replace that with authenticated fixtures and real assertions, or explicit skips.
- `tests/world-switch.test.tsx` checks world-scoped API lists; it does not drive the actual UI, simulate reversed loading responses, or exercise dirty/history behavior. Add production-browser tests for these scenarios and legacy draft recovery.
- Update `docs/world-creation-and-switcher.md` (still “plan only”), `docs/milestone-5.md` and `docs/milestone-6.md` to distinguish implemented, unverified, broken and optional work. Preserve the distinction between the original scope and later additions.

## Verification performed

- TypeScript: passes.
- Production build: passes.
- Targeted ESLint over world API, creation/selection/guard modules, workspace and new-world UI: zero errors, five unused-variable warnings.
- Default `pnpm test` with NODE_ENV=test: **125 tests; 87 pass, 1 fail, 37 skipped**. Failure: creation migration test missing World.deletedAt in its historical fixture.
- Three helper `.test.ts` files omitted by the default script: **15/15 pass** when run explicitly.
- Astra ran the creation service test against an isolated fully migrated database: passes. Fresh application of all current migrations also passes.
- Local `prisma migrate status`: up to date. No migrations, application fixes or user-data operations were performed as part of this inventory. A build and normal tests may update generated artifacts; this is not evidence of deployment.
- No new production-browser acceptance run was performed during this inspection. Passing build/type checks do not validate the lifecycle/UI gaps above.

## Suggested next handoff

First fix deletion semantics/access and original switcher/history/draft regressions. Then implement valid management routes and UI; complete backup round trips before calling milestone 5/6 finished. Use bounded GPT-6 Luna implementation tasks with non-overlapping ownership, and GPT-6 Astra review for deletion/access, retries, recovery and the final integrated patch. Recheck material fixes with focused tests before broader acceptance runs.

## Implementation follow-up (October 19, 2026)

The findings above are the historical inventory. The implementation now archives without erasing settings, filters archived worlds from active and public access, supports private restoration and archived-only purge, and uses durable jobs for physical asset cleanup. Settings-only duplication has an authenticated POST route and a stable retry identity. The switcher, guard registry, history compensation, account-scoped legacy draft recovery, and management controls are wired through the author workspace. Management import and duplicate retries survive closing and reopening the dialog for the same account.

Version 2 backups now round-trip archived images, category and article hierarchy, quick facts, article revisions, article and statblock rich-text links, mention graph edges, maps with layers/pins/groups, sessions and entity links, appearance references, and audience policies. Foreign account IDs are skipped or deidentified; retained grants remain revoked and revision authors are assigned to the importing account. Older version 2 bundles without the new sections still import. Version 1 remains supported with its narrower format. Starter content and bulk operations remain optional future work outside the original creation/switcher scope.

Verification after integration: `pnpm exec tsc --noEmit` and `pnpm build` pass; `NODE_ENV=test pnpm test` reports 146 tests, 108 passed, 0 failed and 38 server-dependent skips. The authenticated production HTTP suite passes 12/12 against an isolated migrated database. The production browser flow passes first-world and second-world creation, reload selection, canceled and failed history traversal, dirty-form retention on failed loads, legacy draft recovery, duplicate/archive/restore/purge, and import retry across dialog closure after a failed list refresh. A second browser flow confirms archiving the last active world opens the first-world state and restoring it allows reopening. A separate Foundry browser regression previews 1,000 entries and imports exactly three selected items while checking auth, CSRF and world isolation. Changed-file ESLint has no errors; three existing warnings remain in unrelated world API routes.

The local `prisma/dev.db` was backed up to `prisma/dev.db.pre-asset-cleanup-20261019.backup`. The cleanup-job table and indexes already matched the new migration exactly; a previous migration attempt had failed because the table existed. The migration was marked applied after schema inspection, and `prisma migrate status` reports the database up to date. The backup file is ignored by Git.
