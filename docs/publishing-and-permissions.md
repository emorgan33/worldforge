# Publishing and permissions

## Author access

The workspace at `/` now requires a local author session. Author identity, access errors, Origin checks, and resource-to-world lookup are shared through `src/lib/authorization-core.ts`. Every protected author API route declares its authorization target: account, world path, world query, JSON/form world field, or a typed resource path/body. The wrapper passes the authenticated user and resolved world/resource context into the handler, so protected handlers do not need to resolve the session again. Public invitation routes and filtered player-reader routes keep their separate policies. Private maps, timelines, variables, secrets, categories, compendium entries and asset metadata remain owner-only. Linked map/secret records are checked against their source world. A second author cannot use another owner's IDs to read or change their workspace. There is no open registration; player invitation claims require an owner-issued link.

Campaign Secret records remain owner-only. The notebook's **Mark revealed (GM only)** control changes GM-side tracking state; it does not publish or share the secret with players. Player article projections omit Secret records regardless of that state.

Session identity is resolved once from the hashed session cookie and is shared by author APIs and campaign-reader actor resolution. Preview remains a separate capability layered onto that identity and stays scoped to its issued world. Resource kinds used for authorization are enumerated in the shared resolver, including nested map annotations and campaign sessions; an unknown kind resolves to no world and is denied. World IDs come from the route's declared source, so a conflicting body or query value cannot change which resource the wrapper authorizes.

Image uploads are parsed by the bounded multipart reader before authorization, and the parsed form is passed to the upload handler for reuse. An oversized body is rejected as soon as the byte limit is crossed, without waiting for the remaining upload. Map creation actions authorize against the referenced map's world; marker creation can omit `worldId` and use its `mapId` while mismatched world/map IDs are rejected.

Run `pnpm auth:setup` on the server to create a one-time link for the oldest world's existing owner. On an empty database, it creates the first GM account. Use `pnpm auth:setup -- existing-email@example.com` to select an existing user explicitly, or to name the first account on an empty database. To add a user when accounts already exist, run `pnpm auth:setup -- --create new-email@example.com`. Open the link, choose the account email and a 12–128 character password, and sign in. Existing ownership and content are preserved. The same command without `--create` is the local administrator's recovery mechanism. Setup links expire after 24 hours, are stored as hashes and are invalidated after use. The URL token is in a fragment, so it is not sent in HTTP requests; the setup page removes it from the address bar. Keep the link private.

Passwords use salted scrypt (N=131072, r=8, p=1). Sessions use random 256-bit tokens, hashed in SQLite, with HttpOnly/SameSite=Lax cookies and seven-day expiry. Logout revokes the server session. Setup/recovery revokes older sessions. Local sign-in is limited to eight attempts per email in each 15-minute window. Public readers need no account. [Player-only accounts and invitations](player-accounts.md) give invited members a separate reader home. Role-based shared editing is not included; author access is ownership-based.

Mutation requests require an Origin matching the browser-facing host and protocol. Behind a TLS reverse proxy, configure `WORLDFORGE_ORIGIN=https://your-host.example` so origin checks and Secure cookies use the public origin. Plain HTTP on localhost uses a non-Secure cookie for local development. API clients need the session cookie and matching Origin for writes. Never add an unauthenticated development bypass. Author responses and image bytes use private/no-store caching. Local recovery drafts remain in that browser; server logout does not erase browser storage or previously downloaded data.

The password parameters follow the [OWASP Password Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); hashing uses [Node.js crypto](https://nodejs.org/api/crypto.html). Session checks run inside routes and the workspace server component, using the installed Next.js Cache Components conventions.


## Table-access system (v2)

The table-access system extends per-article visibility with role-based audience policies, enabling secure player sharing without exposing GM-only content.

### Architecture

Authorization is an explicit domain layer. A world member has a role (`PLAYER`); every shareable object has an `AudiencePolicy`; grants are snapshot-based so a later member is not automatically included in historic player shares.

### Members

World members are managed through:

- `POST /api/worlds/[id]/members` - Add a player to the world (owner only)
- `DELETE /api/worlds/[id]/members/[userId]` - Revoke a player's membership (owner only)
- `GET /api/worlds/[id]/members` - List active members (owner only)

### Audience policies

Every resource has an audience policy with one of three modes:

| Mode | Behavior |
|------|----------|
| `GM_ONLY` | Default. Only the world owner/GM can read. |
| `PLAYER_SNAPSHOT` | Only selected player IDs at policy creation can read. Future members not auto-included. |
| `PUBLIC` | Existing anonymous-public publishing path. Separate deliberate action. |

- `PUT /api/resources/[kind]/[id]/audience` - Create or update a policy (owner only)
- `DELETE /api/resources/[kind]/[id]/audience` - Remove a policy (owner only)

### Audit trail

- `GET /api/worlds/[id]/audit` - View audit events (owner only)

Membership revocation and its snapshot-grant and preview-session revocations commit with their audit event as one database transaction. Audience policy and grant changes, preview issue/revocation, and session “next” reassignment also commit atomically with their related writes. If one write fails, the transaction leaves the operation unapplied. Rejoining a world restores membership only; revoked snapshot grants remain revoked unless the owner explicitly grants access again.

Audit events are appended by the application and are not updated or deleted by its normal API. This is an application-level append-only convention; the database does not provide tamper-evident history or protection from direct database edits.

### Preview sessions

- `POST /api/worlds/[id]/preview` - Issue a preview session (owner only, 15-min expiry)
- `DELETE /api/worlds/[id]/preview` - Revoke a preview session (owner only)

Preview creation or revocation and its audit event are committed together. Revoking a member also revokes that member’s outstanding preview sessions in the same transaction.

### Data model

- **WorldMember**: world, user, role (PLAYER), status (ACTIVE|REVOKED)
- **AudiencePolicy**: world, resource (kind+id), mode (GM_ONLY|PLAYER_SNAPSHOT|PUBLIC)
- **AudienceGrant**: policy + user, with revocation timestamp
- **AccessAuditEvent**: immutable actor/action/before/after/parent fields
- **PreviewSession**: token hash, user, world, expiry, revocation
- **CampaignSession**: planned/played dates, recap, typed entity links

Setting a campaign session as “next” clears the previous selection and selects the requested session in one transaction, so a committed update does not leave a partial reassignment.

### Compatibility

Existing articles default to `GM_ONLY` audience. `PUBLIC`+`PUBLISHED` articles continue anonymous access. The GM must explicitly create a player-share policy to make material available to players.
## Publication controls

Article `publicationStatus` is Draft, WIP or Published. Independent `visibility` is Private or Public. Readers can see an article only when its world is public, its publication status is Published, and its visibility is Public. New articles default to Draft/Private. The legacy `state` field remains synchronized for compatibility; legacy PRIVATE writes remain private and legacy PUBLISHED writes do not implicitly grant public visibility.

World styling exposes Make this world public. Article editing exposes separate status and visibility controls and explains the world's override. Publication changes participate in autosave. Making a world private closes its public world, article and asset access immediately on the next request. Share copies `/w/{worldSlug}/a/{articleSlug}` only for currently public articles; world settings link to `/w/{worldSlug}`. Author preview continues to include the owner's private published entries.

## Public readers

Public pages use a separate server read path and a whitelist renderer. They never reuse the author API detail payload. Private article titles and IDs are redacted from inline references, and public backlinks are calculated from the reader-visible documents. GM-note blocks are removed with their entire subtree before rendering. Campaign Secret records are never sent to readers, even when marked revealed for owner tracking. Unknown/custom and inactive-profile metadata is omitted; active structured fields are shown. Private variable collections are not interpolated on public pages, so their macro syntax remains literal.

Only statblocks explicitly embedded in visible content or selected as its matching linked compendium entry are rendered. Public image access requires a public world cover/global cover, a public article cover, or an image in a reader-visible public article block. An image contained only inside a GM note does not grant access. Other library files require the owner session. Hiding an image from the library still preserves legitimate references; changing publication revokes anonymous access. Data already delivered or cached by a browser before this change cannot be recalled.

With Next.js streaming, an inaccessible public page can return the framework's streamed not-found screen with a 200 status and noindex rather than a pre-stream 404. Its private content is not rendered or included in the RSC response. Protected author APIs return 401 for missing/expired sessions and 404 for inaccessible records; private image bytes return 404.

## Migration and verification

**Historical migration note:** The original publication migration used a workspace-specific backup at `/tmp/worldforge-before-publishing-20261015.sqlite` and included a one-time backfill that deliberately closed public access. Do not use that path as a recovery procedure or rerun that historical SQL on a current installation. For upgrades, use committed migrations with `pnpm db:deploy`, regenerate with `pnpm db:generate` when required, and follow the [backup and restore guide](backup-restore.md) for consistent database-plus-assets recovery. SQLite WAL mode remains enabled; never copy only a live database file.

Tests cover status/visibility combinations, GM subtree removal, HTML safety, private-reference redaction, password hashing, authenticated owner boundaries, setup-token replay, CSRF origin checks, session expiry/logout, public-reader payloads and image grants/revocation. Existing API integration tests now use isolated owner sessions. Chromium verifies first setup, password sign-in, owner authoring, publication, Share URLs, public navigation/backlinks, absence of private/GM content, WIP/world revocation and logout.

`tests/access-operations-api.test.tsx` injects database write failures across membership, grant, preview, audience-policy and session reassignment operations. It checks transactional rollback, confirms rejoining does not revive revoked grants or previews, and exercises concurrent “next session” updates.

Production verification passed: all 41 tests (including owner isolation across each resource, authentication lifecycle, API regression checks and public payload/image filtering), TypeScript, focused ESLint and the production build. Chromium passed setup, login, publication, Share URLs, reader navigation, private/GM redaction, WIP/world revocation and logout on port 3033. Fixtures were removed afterward. The viewer retains two pre-existing Next.js image lint warnings; the build completes without the previous prerender-catch logs.
