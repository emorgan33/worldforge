# Player accounts and invitations

WorldForge lets a GM invite players into a campaign without giving them author
access. Players join through a link tied to their email address. WorldForge does
not send email, so the GM must copy and share the link.

## Invite a player

1. Sign in as the world owner and open the campaign overview.
2. In **Players & invitations**, enter the player's email and select **Create
   link**.
3. Select **Copy** in the confirmation and send the link to that player. Copy
   it when it appears: WorldForge stores only a hash of the link's token, so it
   cannot show the same link again later.

The link expires after seven days and can be claimed once. **Pending
invitations** shows unclaimed, unexpired invitations. To replace a lost link,
select the refresh icon beside that email, then copy and send the new link.
Refreshing invalidates the old link. Select the X icon to cancel an invitation.

If the link points to the wrong address, cancel it and create one for the
correct address. Set `WORLDFORGE_ORIGIN` to your installation's public URL so
links use an address the player can reach.

## Accept an invitation

Open the complete link from the GM. The invitation page shows the campaign and
the email address it was created for.

- **New account:** Enter your name and a password of 12–128 characters, then
  select **Accept invitation**. This creates a player-only account.
- **Existing account:** Sign in with the invited email and your existing
  password, then select **Accept invitation**. Your account role and any worlds
  you own stay the same.
- **Signed in with another email:** Use **Sign out to use the invited account**,
  then continue with the invited email. An invitation cannot be claimed by a
  different account.

After accepting, the campaign reader opens. Player-only accounts can return to
**Your worlds** at `/player` to see all campaigns they have joined. They cannot
create worlds or use GM authoring tools.

## Choose what players can read

In the GM workspace, open an article, statblock, or image in the library and
find its **Share** panel. Choose one of these options, then select **Save
access**:

| Setting | Who can read it |
| --- | --- |
| **GM only** | The world owner. This is the default for new resources. |
| **Selected players** | The active campaign members you check in the panel. |
| **All campaign players** | Every active member of this campaign. |

**All campaign players** grants access to active members; the separate public
world publishing settings control anonymous access. Sharing an article does
not automatically share an image or statblock embedded in it. Share each
embedded resource in its own library; the reader hides an embedded resource
until that player has access to it.

Players see only resources currently shared with them. Reader pages, search,
and private images check membership and access when requested. GM notes and
other authoring data stay behind the owner-only author APIs.

## Revoke access or recover an account

To remove a player from a campaign, open **Players & invitations** and select
the revoke icon beside their name. This disables the membership and their
selected-resource grants. If invited again later, the GM must grant selected
resources again. To hide just one resource, change its Share setting and save.

For an expired, cancelled, or already-used link, ask the GM for a new one.
There is no email password-reset flow. An installation administrator can issue
a one-time password setup link for an existing account with:

```bash
docker compose exec worldforge pnpm auth:setup -- player@example.com
```

The administrator should share the printed setup link only with that account's
owner. This command recovers the account; `--create` would create a separate
author account and should not be used for player recovery.

## Upgrade and data

Before upgrading, back up the SQLite database and uploaded assets using the
[backup guide](backup-restore.md). Docker applies the `PlayerInvitation`
migration on startup. For a non-Docker installation, run `pnpm db:deploy`
before starting the updated application. Existing accounts, memberships, and
grants stay in place; the migration does not create open registration or
convert existing authors into players.

If you must roll back, restore the pre-upgrade database backup with its
matching application version.
