# Installation administration

The `/admin` interface is protected by server-side authorization (`requireAdmin()` in `src/lib/admin-auth.ts`) and operates only against isolated temporary storage during tests. Anonymous requests redirect to `/login`; signed-in non-administrators receive an access-denied page before any account data is exposed. All mutation APIs enforce the same authorization plus strict JSON validation (`src/lib/admin-request.ts`), endpoint-specific success validation, and transactional audit with sanitized details.

## Authorization and lifecycle

- Authorization: `src/lib/admin-auth.ts`, `src/app/admin/layout.tsx`, and every `/api/admin/*` route enforce `requireAdmin()` before reading or writing. The caller matrix (anonymous, AUTHOR, GM, PLAYER, active ADMIN, disabled ADMIN, revoked session, expired session) is covered by browser tests across `/admin/users`, `/admin/users/[id]`, and `/admin/audit`.
- Lifecycle: `src/lib/admin-accounts.ts` uses the `InstallationAdminState` singleton (`P1`) to serialize mutations. Each mutation reloads the actor inside the transaction (`P2.1`) and compares `expectedVersion` for the target (`P2.1`–`P2.6`). Credential invalidation, role/ownership guards, session revocation, deletion blocker recomputation, and audit append are transactional.
- Deletion: the service (`P2.6` at `admin-accounts.ts`) rejects deletion (with `OWNS_WORLDS` or `HAS_DURABLE_RECORDS`) when the account owns worlds, holds durable revisions or foundry import history, or has pending/running/recovery/unknown import states (`loadDeletionPreview` at lines 507–519). Blocker results are returned explicitly; they are not automatically removed. Unrelated world content remains unchanged (verified by service and browser deletion fixtures).

## Evidence mapped to issue criteria

| Criterion | Evidence | Source / test |
|---|---|---|
| 1. Admin authorization covers all callers and pages | 28 browser tests include matrix across Users, detail, and Audit; anonymous redirect, non-admin denial, disabled, revoked, and active ADMIN | `tests/browser/admin.spec.ts` (lines 43, 78, 917) |
| 2. Lifecycle: create/recover/status/role/revoke/deletion audited and non-replayable | Transactional mutation core (`admin-accounts.ts`); audit failure fallback (`admin-audit.ts`); recovery invalidates prior links; disabled target blocked; deletion preview/checks/recompute/blockers audited | `tests/admin-accounts.test.ts`; browser coverage at lines 157, 459, 548, 582, 700 |
| 3. Deletion preserves unrelated records and removes durable/blocking references correctly | `P2.6` service and fixtures; blocked/successful deletion browser tests; audit snapshots survive deletion | `tests/admin-accounts.test.ts`; browser at lines 548, 300 |
| 4. Concurrent mutations are serialized; two-client last-admin race protected; stale versions rejected | `P2.1` singleton; `P2.3`/`P2.4` last-active-admin guard with barrier test; `STALE_ACCOUNT` browser test at line 582 | `tests/admin-accounts.test.ts`; browser at line 582 |
| 5. Operator documentation and commands tested | `P4`: `tests/admin-bootstrap.test.ts`; CLI commands (`admin:bootstrap`, `admin:recover`, `auth:setup`) documented in `CONTRIBUTING.md` and `docs/feature-requests/installation-admin-panel.md` (P4 row) |

## Operator procedures

Use isolated temporary storage for all operator commands. The tests and operator commands use the same isolated SQLite path and asset directory (`CONTRIBUTING.md`, lines 86–104). The public origin for the admin interface must match `WORLDFORGE_ORIGIN`.

### Fresh installation (no active administrator)

1. Consume the initial setup link (`pnpm auth:setup` produces `/setup#token=...`). This creates the first active account with a one-time setup URL.
2. Open the setup URL to set the password; the setup link is consumed atomically and previous links are invalidated.
3. Only after setup consumption, run `pnpm admin:bootstrap` (or `pnpm exec tsx scripts/admin-bootstrap.ts`) with the account email. Bootstrap promotes to `ADMIN` only when no active admin exists (`LAST_ADMIN` guard) and invalidates previous credentials.
4. Sign in at `/login` with the new credentials; the local session cookie must be valid for `/admin/*`.

### Existing account recovery

- Normal disabled-account recovery: `pnpm admin:recover disabled@example.com` (positional email, using `localRecoverAccount` in `admin-accounts.ts`). The target must be disabled (`ACCOUNT_DISABLED` if active); recovery clears `disabledAt`, revokes all existing sessions and preview capabilities, invalidates previous setup links, and writes a `LOCAL_RECOVERY` audit event. The user must sign in again with an existing password or receive a new setup link.
- Disabled account: recovery is the only safe recovery path; do not use `bootstrapAdmin` on a disabled account (`ACCOUNT_DISABLED` is returned by the service at `admin-accounts.ts:601`).
- Lost/link-expired setup: issue a new recovery link (`/admin/users/[id]` → Issue recovery link), which invalidates previous unused links (`updateMany` with `usedAt` set); if the previous link was lost, the user consumes the new link before any bootstrap attempt.

### Safe deletion and blockers

Run `pnpm exec tsx scripts/admin-bootstrap.ts` or use the admin panel (`/admin/users/[id]` → Preview deletion blockers). Deletion is blocked (not removed) when any of the following exist (`deleteAccount` at `admin-accounts.ts:492–521`): an owned active world (`OWNS_WORLDS`); durable article revisions or foundry import history (`HAS_DURABLE_RECORDS`); pending/running/recovery/unknown import states (`HAS_DURABLE_RECORDS`). The preview computes blockers inside the transaction; the final delete rechecks them atomically. Deletion requires `confirmEmail` match, `backupAcknowledged: true`, and a matching `expectedVersion`. Before removal, all live preview sessions where the target is subject or issuer are revoked; issuer attribution is cleared with `SetNull` rather than deleting the preview content; the `ACCOUNT_DELETE` audit uses immutable scalar ID snapshots so it survives the deletion.

### Release evidence and operator notes

The operator documentation references `CONTRIBUTING.md` (isolated database setup and server origin) and `docs/feature-requests/installation-admin-panel.md` (P4 operator commands and P8 evidence). The browser regression suite (`tests/browser/admin.spec.ts`, 28 tests) covers keyboard focus return after confirmation, Forward navigation, mutation-after-return, non-self revoke-all conflict/network recovery, barrier-based held responses, and the full caller-state matrix. No runtime services were changed in the documentation-only P8 commit; prior service results (`test:service` 95/95 from P6) and HTTP/browser results (28/28) can be carried forward but were not rerun for this commit.

Release gates not rerun for this follow-up: `pnpm test:service`, `pnpm test:http`, `pnpm test:production-auth`. Complete these before marking P8 approved.

## Release evidence mapping

Evidence remains mapped to the five issue criteria (see Evidence mapped to issue criteria above). The operator guide connects authorization (`P5`), lifecycle (`P2`/`P3`/`P4`), deletion (`P2`/`P6`), concurrency (`P2`), and operator commands (`P4`) to concrete files and tests. Do not approve P8 until the three pending release gates have been executed against isolated temporary storage and their evidence added to this document or `docs/feature-requests/installation-admin-panel.md`.

Isolated checks completed on the current candidate (`d8422f9` plus `934883e` follow-up):

- `pnpm exec playwright test tests/browser/admin.spec.ts`: 28/28 passed (`tests/browser/admin.spec.ts` includes keyboard focus, Forward, full caller matrix, mutation-after-return, non-self revoke-all error/network handling, barrier-based held recovery, truncated create/revoke, deletion, pagination, accessibility, responsive layout, stale-state, and setup clearing).
- `pnpm test:unit`: 218/218 passed.
- `pnpm lint`: 0 errors, 16 warnings (pre-existing).
- `pnpm build`: passed (production build succeeds with Suspense-wrapped authorization).
- `git diff --check`: passed.

Release gates **not rerun** for this follow-up: `pnpm test:service`, `pnpm test:http`, and `pnpm test:production-auth`. Per the P8 plan (`docs/feature-requests/installation-admin-panel.md`), those must be recorded before P8 approval.
