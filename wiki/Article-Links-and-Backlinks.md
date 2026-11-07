# Article Links and Backlinks

1. While editing, type `@` or select **@ Article** in the toolbar.
2. Search for an article in the current world. Category/template and a short ID
   help distinguish duplicate titles.
3. Choose with Up/Down and Enter, or click. Escape dismisses suggestions.

Links store a stable article ID, so renaming a target does not break them.
Author preview shows its current title; click or press Enter to open it.
Deleted or inaccessible targets show a fallback instead of navigating.
Code blocks and inline code do not trigger suggestions.

The article's **References** and **Backlinks** panels show outgoing and incoming
connections. Saving updates the graph; removing the inline reference removes
its edge. Self-links and repeated links do not create duplicate graph entries.

Older `@[Title]` syntax resolves only when that title is unique in the world.
Saving converts resolved links to stable IDs. Ambiguous or missing titles remain
literal until you choose a target. Unconverted legacy text cannot survive a
target rename reliably.

Linking is not sharing: public/campaign readers receive only accessible targets
and reader-visible backlinks. See [Publishing and Permissions](Publishing-and-Permissions).

**Source owner:** `wiki/Article-Links-and-Backlinks.md`; implementation:
`docs/article-links-and-backlinks.md` and article mention/link modules.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
