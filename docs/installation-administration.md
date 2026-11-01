# Installation administration

The `/admin` interface is protected by server-side authorization (`requireAdmin()` in `src/lib/admin-auth.ts`) and operates only against isolated temporary storage during tests. Anonymous requests redirect to `/login`; signed-in non-administrators receive an access-denied page before any account data is exposed. All mutation APIs enforce the same authorization plus strict JSON validation (`src/lib/admin-request.ts`), endpoint-specific success validation, and transactional audit with sanitized details.

## Authorization and lifecycle

- Authorization: `src/lib/admin-auth.ts`, `src/app/admin/layout.tsx`, and every `/api/admin/*` route enforce `requireAdmin()` before reading or writing. The caller matrix (anonymous, AUTHOR, GM, PLAYER, active ADMIN, disabled ADMIN, revoked session, expired session) is covered by browser tests across `/admin/users`, `/admin/users/[id]`, and `/admin/audit`.
- Lifecycle: `src/lib/admin-accounts.ts` uses the `InstallationAdminState` singleton (`P1`) to serialize mutations. Each mutation reloads the actor inside the transaction (`P2.1`) and compares `expectedVersion` for the target (`P2.1`–`P2.6`). Credential invalidation, role/ownership guards, session revocation, deletion blocker recomputation, and audit append are transactional.
- Deletion: `P2.6` preserves unrelated world content, uses `RESTRICT` for durable records and `SetNull` for nullable attribution, clears terminal temporary request records, revokes previews before clearing issuer attribution, and writes immutable audit snapshots.

## Evidence mapped to issue criteria

| Criterion | Evidence | Source / test |
|---|---|---|
| 1. Admin authorization covers all callers and pages | 28 browser tests include matrix across Users, detail, and Audit; anonymous redirect, non-admin denial, disabled, revoked, and active ADMIN | `tests/browser/admin.spec.ts` (lines 43, 78, 917) |
| 2. Lifecycle: create/recover/status/role/revoke/deletion audited and non-replayable | Transactional mutation core (`admin-accounts.ts`); audit failure fallback (`admin-audit.ts`); recovery invalidates prior links; disabled target blocked; deletion preview/checks/recompute/blockers audited | `tests/admin-accounts.test.ts`; browser coverage at lines 157, 459, 548, 582, 700 |
| 3. Deletion preserves unrelated records and removes durable/blocking references correctly | `P2.6` service and fixtures; blocked/successful deletion browser tests; audit snapshots survive deletion | `tests/admin-accounts.test.ts`; browser at lines 548, 300 |
| 4. Concurrent mutations are serialized; two-client last-admin race protected; stale versions rejected | `P2.1` singleton; `P2.3`/`P2.4` last-active-admin guard with barrier test; `STALE_ACCOUNT` browser test at line 582 | `tests/admin-accounts.test.ts`; browser at line 582 |
| 5. Operator documentation and commands tested | `P4`: `tests/admin-bootstrap.test.ts`; CLI commands (`admin:bootstrap`, `admin:recover`, `auth:setup`) documented in `CONTRIBUTING.md` and `docs/feature-requests/installation-admin-panel.md` (P4 row) |

## Validation status

Isolated checks completed on the current candidate (`d8422f9` plus `934883e` follow-up):

- `pnpm exec playwright test tests/browser/admin.spec.ts`: 28/28 passed (`tests/browser/admin.spec.ts` includes keyboard focus, Forward, full caller matrix, mutation-after-return, non-self revoke-all error/network handling, barrier-based held recovery, truncated create/revoke, deletion, pagination, accessibility, responsive layout, stale-state, and setup clearing).
- `pnpm test:unit`: 218/218 passed.
- `pnpm lint`: 0 errors, 16 warnings (pre-existing).
- `pnpm build`: passed (production build succeeds with Suspense-wrapped authorization).
- `git diff --check`: passed.

Release gates **not rerun** for this follow-up: `pnpm test:service`, `pnpm test:http`, and `pnpm test:production-auth`. Per `docs/feature-requests/installation-admin-panel.md`, `P7` requires those to be recorded before `P8` is considered complete. `P8` is started here with documentation and evidence mapping; do not claim full release readiness until the required service, HTTP, and production-auth gates have been rerun and recorded.
