# Player Accounts and Invitations

## Invite someone

1. As world owner, open the campaign overview's **Players & invitations**.
2. Enter the player's email and choose **Create link**.
3. Copy the link immediately and send it privately. WorldForge does not send
   email and cannot redisplay the original token.

Links expire after seven days and can be claimed once. Refreshing an invitation
invalidates the old link; cancelling prevents its use. For a wrong email,
cancel and create a new invitation. The operator must configure
`WORLDFORGE_ORIGIN` to an address the player can reach.

## Join and read

Open the full invitation URL. New users enter a name and 12–128 character
password and select **Accept invitation**. Existing users sign in with the
invited email and accept; their existing account role and owned worlds remain.
If signed in with a different email, sign out first.

Player-only accounts use **Your worlds** at `/player` and cannot create worlds
or access GM editing tools. Joining does not expose everything in the campaign:
the GM must [share resources](Publishing-and-Permissions). Images/statblocks
embedded in a shared article need their own access grants.

## Remove access or recover an account

Revoke a member in **Players & invitations** to remove membership and selected
resource grants. Reinviting does not resurrect revoked snapshot grants; share
the resources again. Change one resource's Share setting to hide only that item.

Expired/lost invitations require a replacement from the GM. Password recovery
requires the installation operator: there is no email reset service. Follow
[Installation Administration](Installation-Administration), using an existing
account recovery link, not `--create` for an existing player.

**Source owner:** `wiki/Player-Accounts-and-Invitations.md`; implementation:
`docs/player-accounts.md`, invitation routes, and `src/lib/access.ts`.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
