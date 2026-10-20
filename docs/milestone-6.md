# Milestone 6: World Deletion and Restoration

## Status: Implemented

Archive sets `World.deletedAt`, turns off public access, and preserves the title, description, images, appearance and all campaign content. Active lists, nested resource access, assets and public pages exclude archived worlds. The owner can still see an archived world in Manage worlds, restore it as private, or permanently erase it after typing `PURGE`.

Permanent deletion requires an archived world. The database cascade and explicit audit-event deletion run in a transaction. Asset files are recorded in durable cleanup jobs before deletion and can be retried after a file removal failure. Archiving the current world selects another active world or shows the first-world state when none remain.

The management UI also offers a private settings-only duplicate through `POST /api/worlds/[id]/duplicate`, with request identity for safe retries. The obsolete `DUPLICATE` method and deleted-world POST listing alias were removed.

Validation: isolated lifecycle and migration tests, authenticated HTTP tests for archive, restore, duplicate, access boundaries and purge, plus browser acceptance in [world-implementation-audit.md](world-implementation-audit.md). Older archives that previously cleared metadata cannot regain those erased values without a separate backup.
