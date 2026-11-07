# Worlds and the World Switcher

A world is an owner-scoped campaign workspace. Creating one does not publish
it, add demo content, or invite players.

## Create and open worlds

1. Open the **World switcher** in the workspace sidebar (inside **Menu** on
   mobile), then choose **New world**.
2. Enter a title, optional description, and rules profile. Choose **Create
   world**. New worlds are private and empty; duplicate titles are allowed.
3. Use the switcher to return to an owned world. The selected world appears in
   `/?world=<id>`, so refresh and browser Back/Forward retain navigation.

The switcher lists owned worlds, not player memberships. Invited players use
[Your worlds](Player-Accounts-and-Invitations) at `/player`.

## Unsaved work and failed requests

Wait for pending saves/uploads before switching. Unsaved forms ask for a discard
decision. Cancel keeps the current form; a failed destination load offers retry
or return without pretending the campaign is empty.

If creation succeeds but opening fails, retry opening that world rather than
creating another. After an uncertain network outcome, reconcile the pending
creation or inspect your world list. Closing a dialog cannot undo a request
already received by the server. Browser storage improves recovery but is not
a server backup.

## Manage worlds

**Manage worlds** provides archive/restore and export/import tools. Archiving
keeps content and makes the world private; restoring also leaves it private.
Permanent purge is destructive and requires an archived world. Back up first.
A settings duplicate is a new private, empty world, not a content clone.
Use [Backup and Restore](Backup-and-Restore) to move complete content.

**Source owner:** `wiki/Worlds-and-the-World-Switcher.md`; implementation:
`docs/world-creation-and-switcher.md`, `src/components/worlds/`, and world APIs.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
