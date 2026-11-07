# Writing and Editing

## Write and organize

1. Choose **New article**, select a template, and enter a title.
2. Use the toolbar or type `/` for headings, lists, callouts, images, tables,
   and compendium blocks. Block handles move, duplicate, or delete content;
   undo/redo applies to these operations.
3. Use categories to organize the world tree. The category manager can rename,
   nest, reorder, and move categories and reassign articles. Deleting a category
   promotes its direct children/articles to its parent; it does not delete prose.
4. Use [article references](Article-Links-and-Backlinks) to connect your writing.

**GM-note** callouts are owner-only; ordinary notes and read-aloud callouts are
not secret. Keep secrets out of titles, excerpts, and other shared fields.

## Save and recover

Autosave runs after about 1.5 seconds without typing. A blank title or invalid
changed numeric field prevents saving. **Save Article** saves immediately and
opens the author preview. Wait for saved status before closing the browser.

Failed saves retain your edits and offer **Retry save**. Local recovery drafts
belong to this browser, account, world, article, and window. On return, choose
**Restore draft** or **Discard draft**. Recovery does not write to the server
until you restore it. Clearing browser data can erase these drafts.

Two windows do not merge edits: a stale editor gets a conflict and retains its
draft, with a save-as-separate-article option. Do not keep retrying a stale
overwrite. Older versionless drafts can be saved as new articles.

## Revision history

Open an article's revision history to inspect and compare saved versions, then
restore a retained revision when needed. Restoration snapshots the current saved
fields first and creates a new current version. History covers saved article
fields, not every category, placement, relationship, or world setting. It is not
a replacement for [installation backups](Backup-and-Restore).

Saving does not imply publishing. See [Publishing and Permissions](Publishing-and-Permissions).

**Source owner:** `wiki/Writing-and-Editing.md`; implementation:
`docs/editor-and-category-manager.md`, `docs/autosave-and-recovery.md`, and
`docs/article-revisions.md`.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
