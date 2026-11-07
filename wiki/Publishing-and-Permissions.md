# Publishing and Permissions

## Publish to anonymous readers

All three gates must be open:

1. In the article editor, set status to **Published**.
2. Set visibility to **Public** and save.
3. Enable **Make this world public** in world settings and save.

Share the world at `/w/<worldSlug>` or an article at
`/w/<worldSlug>/a/<articleSlug>`. Draft/WIP or Private articles are not public.
New articles default to Draft/Private; new worlds are private.

Making the world private closes anonymous reading and public image access on
subsequent requests. Data already downloaded or copied cannot be recalled.

## Share with campaign players

Invite players first, then use a resource's **Share** panel and **Save access**.
**GM only** is the default. **Selected players** stores a snapshot of the
checked active members; future members do not inherit that selection.
**All campaign players** allows active members, not anonymous visitors.

An article's player share does not automatically share its embedded images or
statblocks. Grant access to those separately. Player campaigns use `/c/<worldSlug>`.
See [Player Accounts and Invitations](Player-Accounts-and-Invitations).

## What readers do not receive

Reader payloads omit GM-note subtrees, Campaign Secret records, private variable
collections, unknown metadata extensions, and inactive-profile character fields.
Private article references are redacted. Reader search and navigation include
only readable content. Maps, timelines, and the GM workspace are not made
reader-facing merely by publishing a world.

**Mark revealed (GM only)** on a secret is bookkeeping; it does not share it.
If you intend to reveal information, deliberately write it into an accessible
article. Preview capabilities are world-scoped, expire after 15 minutes, and
should be revoked after checking the player perspective; treat their URLs as
credentials. [Security Model](Security-Model) explains sessions and revocation.

**Source owner:** `wiki/Publishing-and-Permissions.md`; implementation authority:
`docs/publishing-and-permissions.md`, `docs/player-accounts.md`, and `src/lib/access.ts`.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
