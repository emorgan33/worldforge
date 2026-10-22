# Player accounts and invitations

WorldForge supports player-only accounts alongside author accounts. A world owner creates an email-bound invitation link in the campaign overview, copies it, and shares it with the intended player. WorldForge does not send email. Links expire after seven days, work once, and can be cancelled or refreshed by the owner. Refreshing invalidates earlier pending links for that email and world.

## Claiming and sign-in

- A new player opens the link, sets a name and a 12–128 character password, and receives a `PLAYER` account and an active membership in that world.
- An existing account signs in with the invited email before claiming. Its global role and any worlds it owns are preserved; the invitation adds only a player membership in the inviting GM's world.
- The invitation token is in the URL fragment (`/invite#token=…`), removed from the browser address after page load, and sent to the server in JSON for preview and claim. The database stores only its SHA-256 hash. Claims use a conditional update in one transaction so the link cannot be consumed twice.
- Player-only accounts land at `/player`, which lists their active memberships. An author who is also a player can open the player view from the author workspace.
- A person who loses an unclaimed link asks the GM to refresh it. A player who loses their password needs account recovery from the installation administrator; this release does not provide email password reset.

## Sharing and access

New resources have no audience policy and remain GM only. The GM can set each article, statblock, or library image to GM only, selected active members, or all active campaign members. Embedding a statblock or image in a shared article does not grant the embedded resource: the GM shares it separately in the bestiary or image library. The reader removes references and images without their own grant.

The `/c` reader and `/api/c` search check active membership and current grants at request time. Author APIs, including detail endpoints that contain GM notes and secrets, require world ownership. Player-only accounts cannot create worlds or call author APIs. The player home intentionally shows title and description for each joined world but omits cover images, which may be private. Reader article/category/search metadata is filtered to readable resources. Revocation disables membership, invalidates preview sessions and snapshot grants, and takes effect on direct reader links, search, and image responses. Gated image responses use `Cache-Control: private, no-store`.

## Installation and migration

Back up the SQLite database and asset directory using [the backup guide](backup-restore.md), then run `pnpm db:deploy` (or the deployment's existing Prisma migration step). The migration adds `PlayerInvitation`; existing users retain their role and existing memberships and grants remain unchanged. It does not convert existing authors into players or create open registration. A GM can invite an existing user without changing that user's ownership of other worlds.

If deployment must be rolled back, restore the pre-migration database backup with the matching application version. Cancelling or refreshing a pending invitation is the normal recovery path for an exposed or lost link. Revoking membership removes current access; a later invitation must be claimed again, and prior selected-member grants do not reactivate automatically.

## Verification

Focused HTTP integration tests run against a disposable SQLite database and local Next server. They cover new-player claim, existing-author claim, email binding, duplicate/cancelled/expired links, owner-only invitation management, player author-API denial, reader isolation, embedded asset/statblock grants, and membership revocation across direct links, search, and images. The existing unit suite remains available through `pnpm test`.
Browser automation was not run for this milestone; the tests exercise rendered reader pages over HTTP.
