# Installation administration implementation plan

Status: proposed implementation contract; no feature code implemented by this document.
Tracks [GitHub issue #8](https://github.com/emorgan33/worldforge/issues/8).

This plan divides the work into bounded packages for smaller coding models. Implement packages in order, with a separate reviewed commit for each. A model should read this document and the files named in its package, implement that package, and report evidence before proceeding. The security and migration review gates require deliberate review even when all tests pass.

## Repository findings

- `User.role` is a string with ADMIN, AUTHOR, GM, and PLAYER conventions. There is no disabled status or enforced installation admin capability today.
- `authorization-core.ts:sessionUser()` resolves a database session on each request. `auth.ts:withAuthor()` protects author APIs and preserves world ownership checks. ADMIN currently behaves as an author, with no installation privilege implementation.
- `AuthSession` stores a token hash, user ID, creation time, and expiry. No reliable device, last activity, or last sign-in history exists.
- `scripts/auth-setup.ts` creates AUTHOR accounts and issues 24-hour setup links. Setup consumption can currently change the account email and issues a session after its password transaction.
- Invitation claim can create a PLAYER account. `access.ts:resolveActor()` also accepts a separate preview capability cookie; disabling normal sessions alone is insufficient.
- `World.owner` currently cascades on user deletion. Other user relations can delete revisions and Foundry import history. Account deletion must account for every relation.
- `AccessAuditEvent` belongs to a world and is unsuitable as an installation audit log.
- HTTP fixtures often rely on deleting a user to remove worlds. Changing the ownership foreign key requires explicit fixture cleanup across affected suites.

Recheck these findings against the current checkout when implementation starts. Read AGENTS.md, CONTRIBUTING.md, and relevant bundled Next.js guides before framework changes.

## Product decisions

These are the default decisions for issue #8. Change this contract explicitly before implementing a different behavior.

| Capability | ADMIN | AUTHOR / GM | PLAYER | Anonymous / disabled |
| --- | --- | --- | --- | --- |
| Installation Users and audit pages/APIs | Yes | No | No | No |
| Create AUTHOR or PLAYER accounts | Yes | No | No | No |
| Issue setup/recovery links | Yes | No | No | No |
| Change account role/status, revoke sessions, delete eligible accounts | Yes | No | No | No |
| Author owned worlds | Yes | Yes | No | No |
| Read campaign content | Existing ownership/membership rules | Existing rules | Existing rules | Existing anonymous publication rules |

Installation admin status grants no access to another owner's private world content. Admin pages may show ownership identifiers, titles, and deletion blockers needed for account management. Keep content projection and world author endpoints under their existing checks.

Account creation accepts only AUTHOR or PLAYER. Role changes accept ADMIN, AUTHOR, GM, or PLAYER; GM retains its existing author behavior. All such changes require an active ADMIN. Reject demotion to PLAYER while any active or archived world is owned. Reject unknown role values and arbitrary supplied model fields.

An active administrator means `role === ADMIN` and `disabledAt === null`. Prevent removing the last such account. Also reject self-disable, self-delete, and self-demotion in the panel; another admin must perform these actions. Self session revocation remains supported.

Disabling preserves worlds, publication settings, memberships, and grants. It prevents authenticated access, invalidates all login sessions and setup links, and revokes previews where the account is either subject or issuer. Re-enabling restores eligibility to sign in with the existing password; it never restores invalidated credentials. Existing public content remains public. Previously revoked campaign memberships remain revoked.

Create a PLAYER without assigning campaign membership. Explain that a GM must invite the player separately. Keep existing campaign invitations and their role-preserving acceptance behavior.

### Deliberate account deletion

Use a conservative deletion workflow for this issue: block deletion while any world is owned, including archived worlds, or while durable content/history records require preservation. Show blockers with counts and identifiers. The existing owner must export/back up and explicitly purge worlds through world management before account deletion. A disabled owner can be temporarily re-enabled by an admin for that process. Ownership transfer and an installation admin purge tool are separate future features; do not claim they exist.

Require the target to be disabled before deletion, typed confirmation of its current email, an impact preview, and explicit backup acknowledgement. Explain that the acknowledgement records the operator's assertion; the application cannot prove that an external backup exists. Recompute blockers in the delete transaction. No confirmation permits bypassing a blocker.

For each User relation, record its policy in the migration review: owned worlds RESTRICT; durable revisions/import history RESTRICT until their owning content is deliberately purged; credentials and target memberships/grants may cascade; nullable actor/issuer attribution uses SetNull; installation audit uses immutable scalar snapshots. Treat pending/running world imports as blockers and explicitly invalidate or remove terminal temporary request records. Preserve unrelated campaign content and audit history. Do not automatically delete world records to make user deletion succeed.

## Data and service contracts

### Schema additions and migration

- `User.disabledAt: DateTime?`, `User.lastSignInAt: DateTime?`, and `User.accountVersion: Int @default(0)`. Derive status from disabledAt; derive setup-pending separately from absence of a password hash.
- Add an opaque unique `AuthSession.id` for management routes. Keep tokenHash private and preserve existing cookies. Backfill unique IDs for existing sessions in the SQLite migration; a Prisma client default alone does not backfill existing rows.
- Add an installation audit table: ID, actor ID snapshot (nullable for CLI), target ID snapshot, action, outcome, bounded reason code, allowlisted details JSON, timestamp. These IDs are scalar snapshots, so deletion cannot erase audit history. Record actor type WEB_ADMIN or LOCAL_OPERATOR. Do not retain unnecessary names/emails in audit details.
- Add one seeded `InstallationAdminState` singleton with an integer version. Its transaction update serializes lifecycle decisions before reading admin counts or account state.
- Change destructive User foreign keys according to the reviewed relation inventory. Test migration preservation with representative existing worlds, revisions, sessions, grants, and imports. Never regenerate a fresh baseline or reset a configured database.
- Add indexes for account filtering and stable pagination, session user/expiry lookup, and audit timestamp/ID ordering. Return null for unknown historical last sign-in; do not infer it from account updates.

### Shared server services

Add `src/lib/admin-policy.ts` for roles, validation, safe DTOs, and error codes; `admin-accounts.ts` for lifecycle transactions; `admin-audit.ts` for append-only audit; and a separate `admin-auth.ts` wrapper for request/page authorization. Names can follow nearby conventions, but keep domain operations outside route files.

`requireAdmin()` checks the current database session and active ADMIN role. Every mutation also rechecks the actor's session, expiry, role, and status inside its transaction after acquiring the singleton write lock. A request that waited behind a demotion/revocation must fail. Page checks and UI visibility never substitute for these checks. Use sameOrigin for all mutations and private/no-store for all admin responses, including errors.

Mutation transaction order: acquire singleton lock; reload actor/session and target; check expected accountVersion and preconditions; apply allowlisted writes; increment target accountVersion; append success audit; commit. Generate raw tokens and compute password hashes outside transactions, then revalidate eligibility inside. Never use an application mutex as the concurrency guarantee. SQLite busy/transaction conflicts receive bounded handling and a clear retryable response; never repeat an uncertain committed action blindly.

Account lifecycle, bootstrap, setup issuance/consumption, and session issuance/revocation share this serialization mechanism. World create/import paths must recheck active author eligibility inside their write transaction so a concurrent delete/demotion cannot create a PLAYER-owned world or recreate credentials. Review actual Prisma transaction behavior with two independent clients.

Successful mutation and its audit event commit together; audit insertion failure rolls back the mutation. After rollback, record a sanitized rejected/failed outcome for an authenticated admin attempt in a separate transaction. Do not log request bodies, passwords, cookies, tokens, token hashes, bearer URLs, or arbitrary exception text. If failure-audit persistence also fails, return a generic failure and emit a sanitized operational error. Unauthorized traffic receives no account detail and need not generate one database row per attempt.

### Credential lifecycle

- `sessionUser()` rejects disabled users on every lookup. Preserve its safe user projection.
- Login keeps existing rate limiting and generic invalid-credential errors for disabled accounts. Session insertion and lastSignInAt update are atomic and require active status. “Immediate” revocation means subsequent authorization checks fail; an HTTP response already in flight cannot be recalled.
- Setup/recovery issuance invalidates previous unused links, retains the existing 24-hour TTL, and stores only a hash. Recovery issuance alone does not sign out existing sessions; successful consumption does.
- Bind setup consumption to the target's current email; reject attempts to change it. This replaces the existing email-editing behavior of setup. Recheck active status and token claim in the transaction; password update, all link invalidation, old session revocation, and new session creation commit together. Set the cookie only after commit.
- Update the CLI to reuse the same services and reject recovery for disabled accounts. Keep its existing create/recovery invocation compatible.
- Invitation preview/claim must handle disabled existing accounts without granting membership or issuing a session. Recheck account and invitation/world eligibility inside the claim transaction. New invitations continue creating PLAYER accounts.
- Preview resolution must reject a disabled subject or disabled issuer, even if a stale preview row exists. Revoke affected previews on disable and all-session revocation. Single login-session revocation affects that session; previews are listed separately as capability counts with an explicit “revoke all access sessions” consequence on the all-sessions action.
- Every role change invalidates login sessions, outstanding setup links, and affected preview capabilities so users return with fresh authority. Disable also invalidates outstanding setup links. An old recovery link must not acquire newly promoted authority.

### Bootstrap and recovery

Add `pnpm admin:bootstrap -- existing@example.com`. It requires local server/container access and an existing active account; atomically promotes it only when no active admin exists. Never auto-promote seeded owners, first web sign-ins, or arbitrary environment-supplied emails. Record LOCAL_OPERATOR audit. Duplicate bootstrap attempts cannot create multiple initial admins.

For an empty installation, use the existing explicit account-create command, bootstrap that account, then consume its setup link. Document the exact tested commands and configured public origin. Existing admins recover through `auth:setup`. If no active admin remains after a manual database intervention, bootstrap can promote an existing active account. Disabled accounts require an explicit local recovery command that re-enables the named account, revokes credentials, and audits the change; bootstrap must not silently re-enable it.

## HTTP and UI contracts

Use `/admin/users`, `/admin/users/[id]`, and `/admin/audit`. Anonymous page requests redirect to login; signed-in non-admins receive an access-denied page without data. API responses use 401 for no valid identity, 403 for insufficient admin capability/origin, 404 for missing targets, 400 for invalid input, and 409 for stale versions or lifecycle blockers. Return `{ error, code }` with stable codes such as LAST_ADMIN, SELF_CHANGE, ACCOUNT_DISABLED, OWNS_WORLDS, HAS_DURABLE_RECORDS, and STALE_ACCOUNT.

| Endpoint | Contract |
| --- | --- |
| GET `/api/admin/users` | Search normalized email/name, role/status filters; bounded page size default 25/max 100; stable createdAt+ID cursor; `{ users, nextCursor }` |
| POST `/api/admin/users` | `{ email, name, role: AUTHOR\|PLAYER }`; 201 safe account DTO and one-time setup URL; duplicate email 409 |
| GET `/api/admin/users/[id]` | Safe account DTO, owned-world summaries, membership/credential counts; no content bodies |
| POST `/api/admin/users/[id]/recovery` | `{ expectedVersion }`; one-time setup URL and expiry; disabled target 409 |
| PATCH `/api/admin/users/[id]/status` | `{ disabled: boolean, expectedVersion }`; atomic status and credential changes |
| PATCH `/api/admin/users/[id]/role` | `{ role, expectedVersion }`; explicit role validation and last-admin/ownership guards |
| GET `/api/admin/users/[id]/sessions` | Unexpired sessions with opaque ID, createdAt, expiresAt, current-session flag; preview capability count |
| DELETE `/api/admin/users/[id]/sessions/[sessionId]` | Revoke only a session belonging to that target; include expectedVersion in JSON body |
| POST `/api/admin/users/[id]/sessions/revoke-all` | `{ expectedVersion }`; revoke login and related preview capabilities; return counts |
| GET `/api/admin/users/[id]/deletion-preview` | Current version, owned worlds, durable blockers, affected counts, allowed flag |
| DELETE `/api/admin/users/[id]` | `{ expectedVersion, confirmEmail, backupAcknowledged: true }`; repeat checks and delete atomically |
| GET `/api/admin/audit` | Bounded stable pagination, optional target/action filter; sanitized audit DTOs |

Safe account DTO: ID, email, name, role, disabledAt, createdAt, lastSignInAt, accountVersion, and derived setupPending. Explicit selects are mandatory. Email normalization matches existing auth. Validate name length 1–120 and email length at most 254; bound search strings and cursors. Use an allowlist for request fields and reject attempted passwordHash/tokenHash/ownership injection.

Setup URLs appear only in the successful creation/recovery response and an ephemeral copy panel. Never put them in URL queries, localStorage, browser history, analytics, audit, or ordinary logs. Clear them on close/navigation; provide reissue when lost. Disable automatic retries for these mutations: after a lost response, refresh state and explicitly reissue. Use the existing `/setup#token=...` fragment flow.

The Users view shows status and unknown last sign-in honestly. Account detail groups identity, role/status, sessions, recovery, and deletion. Show exact consequences before actions, focus the relevant error, handle stale-state refresh, and prevent duplicate submissions. Provide an Admin navigation entry only for admins, preserving mobile navigation. A self revoke-all action clears local signed-in state and routes to login. Use native labels, focus-visible controls, accessible confirmation dialogs, and layouts usable at 320px.

## Ordered work packages

Each package includes its focused tests. Do not defer authorization tests until the final package.

| Package | Deliverable and main files | Completion evidence |
| --- | --- | --- |
| P1 — schema and policy | Schema/migration, relation inventory in this document, admin-policy.ts, safe DTO definitions, updated explicit fixture cleanup | Upgrade fixture preserves records and sessions; database rejects owner deletion; unit validation passes; prisma generate succeeds |
| P2 — transaction services and audit | admin-accounts.ts, admin-audit.ts, singleton locking, actor recheck and accountVersion handling | Two-client tests prove last-admin protection, stale request rejection, audit rollback, and preserved unrelated records |
| P3 — authentication integration | authorization-core.ts, auth.ts, access.ts, login/setup/invitation routes, relevant world create/import services | Disable prevents every credential path; setup/disable and login/revoke races cannot leave usable credentials; existing auth and reader access regressions pass |
| P4 — operator commands | Shared setup service, auth-setup.ts, new bootstrap/local recovery commands, package scripts | Fresh installation and existing owner bootstrap work; concurrent bootstrap safe; disabled recovery explicit; no token output in audit |
| P5 — read APIs and authorization | admin-auth.ts and GET routes; safe search/detail/session/audit/deletion projections | Every route rejects anonymous/AUTHOR/GM/PLAYER/disabled callers; responses contain no hashes or unrelated content; cursor/filter tests pass |
| P6 — mutation APIs | POST/PATCH/DELETE route adapters calling services; strict schemas and errors | Origin and capability matrix for every endpoint; ownership/session ID checks; last-admin races; safe deletion fixtures |
| P7 — admin interface | Admin pages/components, navigation entry, one-time link panel, confirmation flows | Browser checks for create/recover, role/status, single/all session revoke, blocked/successful deletion, stale state, keyboard and narrow layout |
| P8 — release and operator guide | docs/installation-administration.md, README/CONTRIBUTING links, full regression fixes and acceptance evidence | Required repository gates pass on isolated storage; production auth check covers admin/disabled access; all issue criteria mapped to evidence |

Dependencies: P1 → P2 → P3 → P4 → P5 → P6 → P7 → P8. Keep schema edits in P1. If later work reveals a schema defect, make an explicit follow-up migration and update the contract. P2 and P3 are the highest reasoning-risk packages; obtain a stronger review there and for the final diff. Smaller models can implement the bounded routes, forms, projections, documentation, and focused cases once those contracts are settled. No specific model price or capability claim is assumed.

For smaller prompts, split P2 into create/recovery, status/role, sessions, and deletion service commits; split P7 into list/detail shell, action forms, and audit/deletion views. Keep each subtask's tests with it. Do not parallelize edits to auth services or schema.

## Required behavioral checks

1. Test each admin page and each API against anonymous, AUTHOR, GM, PLAYER, active ADMIN, expired session, disabled ADMIN, and revoked session. Verify a newly demoted actor cannot finish a queued mutation.
2. Test cross-origin and missing-origin rejection for every mutation. Inject role/password/hash/target ID fields to verify strict validation. An ADMIN still cannot read or mutate another owner's private world through author endpoints.
3. Cover account create, duplicate email, PLAYER creation without author rights, one-time setup, reissue invalidating old links, email binding, expiry, disabled setup, and non-revivable old credentials after re-enable.
4. Disable with normal sessions, preview subject/issuer sessions, setup links, and campaign invitations present. Preserve world visibility and membership records; deny credential access immediately. Existing public readers continue under publication filters.
5. With two active admins, race opposing disable/demote/delete operations through independent clients and assert at least one remains active. Test concurrent session issuance/revocation and setup claim/disable. Use controlled barriers where practical, not timing sleeps alone.
6. Deletion preview and final delete must block active and archived worlds, durable revisions/import history, and in-progress imports. Race a new owned-world creation against deletion. Test safe removal of a disabled player, credential cleanup, nullable attribution, and retained audit snapshots. Compare unrelated world content before/after.
7. Test stale versions and disappearing targets, target/session mismatch, expired session filtering, equal-timestamp pagination, bounded search, sanitized error/audit output, audit insertion failure, and a lost setup-link response.
8. Browser checks cover keyboard dialogs and focus return, long names/emails, empty lists, retry errors, 320px layout, and self revoke-all. Verify direct admin URLs as non-admins.

Suggested files: `tests/admin-policy.test.ts`, `tests/admin-accounts.test.ts`, `tests/admin-migration.test.ts`, `tests/admin-api.test.tsx`, and an admin Playwright spec placed alongside existing browser tests. Follow the repository test discovery configuration; ensure new files actually run in the intended unit/service/HTTP groups. Reuse `tests/auth-fixture.ts` isolation checks. Update fixtures explicitly when RESTRICT replaces user cascades; never add a production cascade bypass for test cleanup.

Use the temporary database, asset directory, matching dev-server configuration, WORLD_CREATION_TEST_DATABASE_URL, and serial execution documented in CONTRIBUTING.md. Run focused gates per package. For release run lint, build, unit, service, HTTP, browser, and production authentication gates as documented. Never seed or test against the user's configured database.

## Handoff prompt for each implementation task

```text
Implement package P<N> from docs/feature-requests/installation-admin-panel.md.
Read AGENTS.md, CONTRIBUTING.md, that package's dependencies, and its named source files.
Read relevant node_modules/next/dist/docs guides before Next.js changes.
Check git status and preserve unrelated work. Implement only this package and its meaningful tests.
Follow the documented permissions, transaction order, safe DTOs, and credential lifecycle.
Use isolated temporary storage for database tests; do not seed configured data.
If a contract is impossible or contradictory, explain the concrete conflict before inventing a replacement.
Report changed files, checks run with results, unresolved risks, and the next ready package.
Update the package status below with evidence. Do not claim issue #8 is finished before P8.
```

Review prompt for the two sensitive checkpoints:

```text
Review P1–P3 (or the completed feature) against the issue #8 plan and current source.
Trace server authorization, every credential issuance/consumption path, preview capabilities,
last-admin concurrency, deletion foreign keys, audit atomicity, and migration preservation.
Look for concrete counterexamples, including two independent database clients.
Report actionable defects with file/line evidence and missing acceptance checks.
```

## Completion record

| Package | Status | Commit / validation evidence |
| --- | --- | --- |
| P1 | Completed | Schema/migration, `src/lib/admin-policy.ts`, safe DTOs, `deleteTestUsers` fixture helper, `tests/admin-policy.test.ts`, `tests/admin-migration.test.ts`. Reviewer findings fixed: guarded browser-spec cleanup, singleton inserted/enforced by migration, populated-upgrade migration test added, session-ID length corrected, transactional cleanup, role validation in safe DTO, tightened `isAdminError`. `pnpm lint`, `pnpm build`, `pnpm test:unit`, and `pnpm test:service` pass on isolated SQLite storage. |
| P2 | Not started | |
| P3 | Not started | |
| P4 | Not started | |
| P5 | Not started | |
| P6 | Not started | |
| P7 | Not started | |
| P8 | Not started | |

Issue acceptance mapping: criterion 1 → P3/P5/P6 authorization evidence; criterion 2 → P2/P3/P6/P7 lifecycle evidence; criterion 3 → P1/P2/P6 deletion evidence; criterion 4 → P2/P4/P6 concurrency evidence; criterion 5 → P4/P8 tested operator documentation. Do not close the issue until each has recorded evidence.
