# Installation administration

The `/admin` interface is protected by server-side authorization (`requireAdmin()` in `src/lib/admin-auth.ts`). Anonymous and disabled callers are redirected to `/login`; signed-in non-administrators receive an access-denied page before account data is exposed. Mutation APIs enforce the same authorization plus strict JSON validation (`src/lib/admin-request.ts`), endpoint-specific success validation, and transactional audit with sanitized details. Isolated temporary storage is for rehearsal and testing only; real operations must use the installed instance's configured database and asset storage.

## Authorization and lifecycle

- Authorization: `src/lib/admin-auth.ts`, `src/app/admin/layout.tsx`, and every `/api/admin/*` route enforce `requireAdmin()` before reading or writing. The caller matrix (anonymous, AUTHOR, GM, PLAYER, active ADMIN, disabled ADMIN, revoked session, expired session) is covered by browser tests across `/admin/users`, `/admin/users/[id]`, and `/admin/audit`.
- Lifecycle: `src/lib/admin-accounts.ts` uses the `InstallationAdminState` singleton (`P1`) to serialize mutations. Each mutation reloads the actor inside the transaction (`P2.1`) and compares `expectedVersion` for the target (`P2.1`–`P2.6`). Credential invalidation, role/ownership guards, session revocation, deletion blocker recomputation, and audit append are transactional.
- Deletion: the service (`P2.6` at `admin-accounts.ts`) rejects deletion (with `OWNS_WORLDS` or `HAS_DURABLE_RECORDS`) when the account owns worlds, holds durable revisions or foundry import history, or has pending/running/recovery/unknown import states (`loadDeletionPreview` at lines 507–519). Blocker results are returned explicitly; they are not automatically removed. An administrator can resolve owned-world blockers through the audited transfer/purge remediation described below, but deletion never silently cascades worlds. Unrelated world content remains unchanged (verified by service and browser deletion fixtures).

## Evidence mapped to issue criteria

| Criterion | Evidence | Source / test |
|---|---|---|
| 1. Admin authorization covers all callers and pages | 28 browser tests include matrix across Users, detail, and Audit; anonymous redirect, non-admin denial, disabled, revoked, and active ADMIN | `tests/browser/admin.spec.ts` (lines 43, 78, 917) |
| 2. Lifecycle: create/recover/status/role/revoke/deletion audited and non-replayable | Transactional mutation core (`admin-accounts.ts`); audit failure fallback (`admin-audit.ts`); recovery invalidates prior links; disabled target blocked; deletion preview/checks/recompute/blockers audited | `tests/admin-accounts.test.ts`; browser coverage at lines 157, 459, 548, 582, 700 |
| 3. Deletion preserves unrelated records and rejects accounts with blockers | `P2.6` recomputes blockers and rejects deletion; it does not remove durable records to make deletion possible | `tests/admin-accounts.test.ts`; browser at lines 548, 300 |
| 4. Concurrent mutations are serialized; two-client last-admin race protected; stale versions rejected | `P2.1` singleton; `P2.3`/`P2.4` last-active-admin guard with barrier test; `STALE_ACCOUNT` browser test at line 582 | `tests/admin-accounts.test.ts`; browser at line 582 |
| 5. Operator documentation and commands tested | `P4`: `tests/admin-bootstrap.test.ts`; CLI commands (`admin:bootstrap`, `admin:recover`, `auth:setup`) documented in `CONTRIBUTING.md` and `docs/feature-requests/installation-admin-panel.md` (P4 row) |

## Operator procedures

### Choose the correct installation

- **Real installation:** run commands inside the deployed container so they use its configured `DATABASE_URL` and `WORLDFORGE_ASSET_DIR`; retain the deployed `WORLDFORGE_ORIGIN` matching the public browser URL. Do not override these values with test paths. Back up the configured database and complete asset directory before account deletion or other destructive maintenance. For Docker Compose, commands below use `docker compose exec worldforge ...` from the installation directory.
- **Local installation:** run `pnpm` commands from the app directory with that installation's `.env` loaded and the same configured database, assets, and `WORLDFORGE_ORIGIN` as the running server.
- **Rehearsal/tests only:** follow the isolated temporary SQLite/assets instructions in `CONTRIBUTING.md` (including `WORLD_CREATION_TEST_DATABASE_URL`). Never point a test or rehearsal command at real installation data.

### Fresh installation (no active administrator)

1. Choose the administrator email and use it for both commands below. Generate its initial setup link with `docker compose exec worldforge pnpm auth:setup -- --create admin@example.com` (local: `pnpm auth:setup -- --create admin@example.com`). The explicit `--create` form creates that exact email as an active `AUTHOR`; without it, zero-argument `auth:setup` instead creates `lorekeeper@worldforge.dev` on an empty installation.
2. Open the printed setup URL and set the password using **the same `admin@example.com` address**. The setup link is consumed atomically and previous links are invalidated.
3. Only after setup consumption, promote that same account: `docker compose exec worldforge pnpm admin:bootstrap -- admin@example.com` (local: `pnpm admin:bootstrap -- admin@example.com`). Bootstrap promotes to `ADMIN` only when no active admin exists (`LAST_ADMIN` guard) and invalidates existing sessions and outstanding setup links.
4. Sign in at `/login` with the new credentials; the local session cookie must be valid for `/admin/*`.

Fresh-install sequence verified on isolated SQLite storage: `auth:setup -- --create admin@example.com` issued the link, consuming it with `admin@example.com` returned HTTP 200, and `admin:bootstrap -- admin@example.com` promoted that same persisted account to `ADMIN` with its password set. The regression test `tests/admin-bootstrap.test.ts` also runs both CLI commands against one isolated account and verifies the identity/role match.

### Promote an existing account when no active administrator exists

Confirm the target account is active and that the installation has no active `ADMIN`. Run `docker compose exec worldforge pnpm admin:bootstrap -- existing@example.com` (local: `pnpm admin:bootstrap -- existing@example.com`). The command refuses if another active administrator exists or if the target is disabled. Promotion invalidates that account's sessions, setup links, and preview capabilities; the operator must have the account consume any needed setup link before promotion, then sign in again afterward. If the target is disabled, use the disabled-account recovery procedure below first.

### Existing account recovery

- Active account password recovery: `docker compose exec worldforge pnpm auth:setup -- admin@example.com` (local: `pnpm auth:setup -- admin@example.com`). This issues a one-time password-setup link for the existing account; send the link privately and have the user consume it. The password change invalidates prior sessions/links. This command does not promote the account.
- Disabled-account recovery: `docker compose exec worldforge pnpm admin:recover -- admin@example.com` (local: `pnpm admin:recover -- admin@example.com`; positional email). The target must be disabled; it clears `disabledAt`, revokes sessions and preview capabilities, invalidates outstanding setup links, and writes a `LOCAL_RECOVERY` audit event. If invoked for an already-active account it returns `INVALID_INPUT: Account is not disabled.` The user must sign in again. Do not use bootstrap on disabled accounts.
- Lost or expired setup link: reissue using `auth:setup -- email@example.com` for an active account, or the admin panel's **Issue recovery link** action for an eligible account. A newly issued link invalidates prior unused links; send it privately and have the user consume it before any bootstrap attempt. Bootstrap invalidates outstanding setup links and sessions, so operators must consume the initial setup link first and then sign in again after bootstrap.

### Safe deletion and blockers

1. Make and verify a backup of the installation's configured database **and** full asset directory before starting; see [Backup and restore](backup-restore.md). Do not use `admin-bootstrap` for deletion: it only promotes an account.
2. In `/admin/users/[id]`, inspect **Preview deletion blockers**. The target must first be disabled; active accounts are not eligible. The preview and final delete both recompute blockers transactionally.
3. Deletion is rejected (not auto-cleaned) if the account owns any world, including archived worlds (`OWNS_WORLDS`), has durable article revisions/foundry import history, or pending/running/recovery/unknown import states (`HAS_DURABLE_RECORDS`). Resolve world ownership from the blocked preview (see below) only after deciding to retain or permanently remove that content and confirming a backup. Do not delete histories merely to bypass a blocker. Then re-preview.
4. Confirm the account email and acknowledge the backup in the panel's delete flow. The service requires the matching `expectedVersion`, exact email, and backup acknowledgement. Before removal, live preview sessions are revoked; nullable issuer attribution is cleared without deleting preview content; the `ACCOUNT_DELETE` audit retains immutable ID snapshots.

### Resolve owned worlds before deletion

A disabled account can own active or archived worlds. The blocked deletion preview lists each world and offers per-world remediation through audited admin endpoints; the source account may stay disabled throughout.

- **Transfer ownership:** choose another active account whose role is `ADMIN`, `AUTHOR`, or `GM`. The recipient cannot be the source, disabled, or a `PLAYER`. Transfer changes only `World.ownerId`; articles, revisions, maps, categories, assets, publication state, archive state, memberships, and audience grants remain with the world. The transfer is audited as `WORLD_TRANSFER` with world and recipient ID snapshots.
- **Permanently purge an archived world:** archive the world first in its workspace. In the blocked preview, expand **Permanently purge world**, type the exact world title, and acknowledge the backup. Purging removes the world and its content through the existing cascade and durable asset-cleanup path, after which the route drains cleanup jobs. It is audited as `WORLD_PURGE`. Active worlds cannot be purged from this panel.
- Both actions recheck the authenticated administrator and target `expectedVersion`, scope their writes to the owner read in the same transaction, and return `STALE_ACCOUNT` or `STALE_WORLD` rather than overwriting concurrent account or ownership changes. They are rejected with `HAS_DURABLE_RECORDS` while the source account has a pending, running, recovering, or unknown import, because import recovery can remove deterministic asset files for a world it can no longer find under that owner. Resolve or discard those imports first. Re-preview after each action; final deletion still recomputes every blocker and remains blocked until no owned worlds or durable records remain.

The transfer-target list (`GET /api/admin/users/[id]/world-transfer-targets`) exposes only safe account fields for eligible recipients.

### Release evidence and operator notes

The full browser suite (`pnpm test:browser`) and the HTTP suite (`pnpm test:http`) are distinct gates. The targeted admin-browser result of 28/28 is historical and is not used as a substitute for the full browser gate.

## Release evidence mapping

Evidence maps to the five issue criteria above: authorization (`P5`), lifecycle (`P2`/`P3`/`P4`), deletion (`P2`/`P6`), concurrency (`P2`), and operator commands (`P4`).

Release gates passed on the candidate based at `a1134ad` plus the P8 working changes, using isolated storage under `/tmp/user/1000/opencode/p8-d3-validation` (SQLite database and assets). Commands were run serially; the dev server and all integration/browser tests used the same storage and origin (`http://127.0.0.1:3162`); production auth used the production server at `http://127.0.0.1:3163`. After adding the fresh-install CLI regression test, `pnpm test:service` was rerun against fresh isolated storage at `/tmp/user/1000/opencode/p8-fresh-service` and passed 96/96; all other gates below cover unchanged runtime/test surfaces:

- `pnpm build`: passed.
- `pnpm lint`: 0 errors, 16 warnings.
- `pnpm test:unit`: 218/218 passed.
- `pnpm test:service`: 96/96 passed (rerun after the fresh-install regression test was added).
- `pnpm test:http`: 111/111 passed.
- `pnpm test:browser`: full suite, 62/62 passed (includes all 28 admin browser tests).
- `pnpm test:production-auth`: 1/1 passed against the production build, including anonymous/non-admin/disabled/active-admin page and API checks.
- `git diff --check`: passed.

These are validation results for the listed working candidate, not a committed release SHA. Do not claim release evidence for any later source changes unless the affected gates are rerun.

Follow-up review at `5f668c8` found two UI error-handling defects: a malformed successful account-detail response could replace valid detail and crash rendering, and a failed filtered pagination request could replace the list with unfiltered results. The follow-up candidate validates detail before replacing it, keeps the last valid detail with a retry option, and preserves the current list/cursor on a failed pagination request. Browser regressions cover both cases. The CI workflow now triggers pull-request checks regardless of the target branch. The gate results above predate this follow-up; release remains on hold until validation and CI on the updated PR #11 head are assessed.

Follow-up local evidence on the updated working candidate (not yet a release SHA): production build passed; lint 0 errors/16 warnings; unit 218/218; service 96/96; HTTP 111/111; production-auth 1/1; full browser 65/65 on fresh isolated SQLite/assets at `/tmp/user/1000/opencode/p8-candidate.*` with the dev server at `http://127.0.0.1:3175`. After strengthening the pagination cursor assertion, the three focused admin browser regressions passed 3/3 on the same isolated storage. HTTP ran on separate isolated SQLite/assets under `/tmp/user/1000/opencode/p8-http.*` with the dev server at `http://127.0.0.1:3177`. The browser and HTTP suites ran in detached checkouts at the same base commit with candidate runtime files copied in; test servers were stopped after testing. Updated PR-head CI must still be assessed separately.

CI on `7ba36ef` passed lint/build, unit, service, and production auth, but its browser step failed because the new detail-refresh test selected a role before initial detail requests had settled; a late request reset the draft and left the action disabled. The test now waits for network idle before selecting the role and passed five consecutive focused runs on isolated storage. CI must be rerun on the revised test before release approval.
