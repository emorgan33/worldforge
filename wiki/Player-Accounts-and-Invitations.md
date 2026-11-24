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

**What's new** on the same page lists recently shared articles, session recaps,
and published maps across all your campaigns. It shows only items you can
currently open; unsharing, unpublishing, or revoking access removes an entry the
next time the page loads. It is a reading aid, not a notification system.

**Saved** keeps articles and maps you bookmark with the **Save** button. It is
private to your account and syncs across devices. A saved item disappears while
you cannot open it—for example after a GM revokes access or unpublishes a
map—and returns if access is restored. Removing an item, or the GM deleting the
resource, clears it permanently.

**Notebook** at `/player/notebook` holds private notes, including notes started
with **Take a note** on an article or map. Names, clues, and reminders stay
yours even if the GM later hides the referenced page; only the link disappears.
Notes save with an explicit **Save** button, and if another device edited a note
first you choose whether to load that version or copy your draft. Deleting a
note is permanent and asks for confirmation.

## Remove access or recover an account

Revoke a member in **Players & invitations** to remove membership and selected
resource grants. Reinviting does not resurrect revoked snapshot grants; share
the resources again. Change one resource's Share setting to hide only that item.

Expired/lost invitations require a replacement from the GM. Password recovery
requires the installation operator: there is no email reset service. Follow
[Installation Administration](Installation-Administration), using an existing
account recovery link, not `--create` for an existing player.

**Source owner:** `wiki/Player-Accounts-and-Invitations.md`; implementation:
`docs/player-accounts.md`, invitation routes, `src/lib/player-activity.ts`,
`src/lib/player-bookmarks.ts`, `src/lib/player-notes.ts`, and
`src/lib/access.ts`.
**Verified against:** `main` (`player activity feed, bookmarks, notebook`),
source/contract audit plus the feed, bookmark, and notebook API/browser checks;
see [verification record](Wiki-Verification).
