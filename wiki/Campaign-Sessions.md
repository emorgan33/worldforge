# Campaign Sessions

The campaign home has a **Next session** desk for GM planning. This is an
authoring tool, not a player calendar or an automatic session publisher.

Create a session with a title. **Start** marks a planned session played;
**Make next session** selects the next one. Inspect existing recap/preparation
information and attach related campaign entities through **+ Link entity**.
**Past Sessions** expands played records and any existing cancelled records;
the desk does not offer a control to cancel a saved session. Selecting a new
next session clears the old selection transactionally.

Links provide context; they do not grant player access to a referenced article,
map, or secret. In particular, marking a notebook secret revealed remains
GM-only bookkeeping. Deliberately publish/share an article for player-facing
session notes using [Publishing and Permissions](Publishing-and-Permissions).

Wait for writes before switching worlds. Failed requests show errors rather
than silently completing. Deleting a session requires confirmation and is not
undone by browser Back; keep [backups](Backup-and-Restore) for recovery.

**Source owner:** `wiki/Campaign-Sessions.md`; implementation:
`src/components/campaign/NextSessionDesk.tsx`, session/link APIs,
`docs/publishing-and-permissions.md` (transaction/access contract).
**Verified against:** `v0.4.3` (`94c694c`), source audit; see
[verification record](Wiki-Verification).
