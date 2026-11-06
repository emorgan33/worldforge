# Installation Administration

Installation administrators manage accounts at `/admin`. This is separate from
owning a campaign world: author and GM access does not grant installation-wide
administration.

The server checks administrator status before exposing account data. Anonymous
or disabled callers return to login; signed-in non-administrators receive an
access-denied page. Account mutations are version-checked, audited, and applied
transactionally.

## Create the first administrator

Use the same email through the entire sequence. From the Compose installation
directory:

```bash
docker compose exec worldforge pnpm auth:setup -- --create admin@example.com
```

Open the private setup URL and set the password for `admin@example.com`. Only
after consuming that link, promote the account:

```bash
docker compose exec worldforge pnpm admin:bootstrap -- admin@example.com
```

Bootstrap works only when no active administrator exists and the target account
is active. It invalidates the target's sessions and outstanding setup links, so
sign in again afterward. If an eligible account already exists, omit the
`--create` step and bootstrap its exact email.

## Recover access

For an active account that needs a password reset:

```bash
docker compose exec worldforge pnpm auth:setup -- admin@example.com
```

For a disabled account:

```bash
docker compose exec worldforge pnpm admin:recover -- admin@example.com
```

The local recovery command only accepts a disabled target. It re-enables the
account, revokes sessions and preview capabilities, invalidates setup links, and
records a local-recovery audit event. Issue a new setup link afterward if the
password also needs to change.

Never publish setup links or paste them into tickets, chat, shell history
shared with others, or screenshots.

## Manage accounts

An active administrator can use `/admin/users` to create accounts, issue
recovery links, change eligible roles/status, revoke sessions, inspect account
details, and review the audit log. Protections prevent removing or disabling
the last active administrator.

Administrative actions can invalidate sessions, setup links, invitations, or
preview capabilities. Read the confirmation carefully and give affected users
new credentials through a private channel when needed.

## Delete an account safely

Account deletion is intentionally blocked when it could orphan or silently
remove durable content.

1. Create and verify a complete database-and-assets backup.
2. Disable the target account.
3. Open its admin detail page and select **Preview deletion blockers**.
4. In the blocked preview, transfer each world you want to keep to another
   active `ADMIN`, `AUTHOR`, or `GM` account. The recipient cannot be disabled,
   a `PLAYER`, or the source account. The world, its contents, publication and
   archive state, memberships, and grants stay intact.
5. For an archived world you intend to destroy, expand **Permanently purge
   world**, type its exact title, acknowledge the backup, and confirm. Active
   worlds must be archived in their workspace first.
6. Do not delete revision or import history merely to bypass a blocker.
7. Preview again, confirm the exact email and backup acknowledgement, then
   delete only when no blockers remain.

Transfer and purge actions are audited, recheck the administrator session,
require the current account version, and refuse stale ownership changes rather
than overwriting them. They are also blocked while that account has an
unfinished world import, because import recovery could otherwise target the
moved or purged world's assets; resolve or discard the import first. The
service recomputes blockers during final deletion.
Owned active or archived worlds produce `OWNS_WORLDS`; durable revisions,
Foundry history, or unfinished imports produce `HAS_DURABLE_RECORDS`. Final
deletion never silently cascades worlds, and unrelated world content is not
removed.

## Use the correct installation

Run Compose commands with `docker compose exec worldforge` so they inherit the
deployed database, asset path, and public origin. Native installations run the
same `pnpm` scripts from the application directory with that installation's
environment. Never point rehearsals or tests at real installation data.

**Source owner:** `wiki/Installation-Administration.md`; adapted from
`docs/installation-administration.md`.
**Verified against:** WorldForge commit `bda48a7` plus the issue #20 working candidate (November 5, 2026); advance to the merge commit before publishing.
