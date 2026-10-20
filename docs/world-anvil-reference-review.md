# World Anvil reference review — 2026-10-14

## Evidence and limits

- [Articles & Categories video](https://www.youtube.com/watch?v=ayBHHRTytL8): title verified through YouTube metadata. Caption track found, but its endpoint returned an empty response. Video frames and speech were not reviewed.
- [Style & Share video](https://www.youtube.com/watch?v=ys0ZJKfucfA): metadata explicitly labels this tutorial outdated. Captions also returned empty. Do not infer visual parity from this review.
- [Article editor link supplied later](https://www.worldanvil.com/p/athena/article/b0788b4b-264f-4e45-a0e3-1c5347fe8b9d/edit): inaccessible through browsing. A public presentation URL is needed for further inspection.

## Verified workflow and implementation

[Customization guide](https://www.worldanvil.com/learn/beginner-tutorials/get-started-customizing): authoring and presentation are separate. The world homepage has a title, description, cover and category-based contents; drafts are excluded. Article-specific covers override the global cover. Background textures and themes are separate styling settings. World privacy overrides article visibility.

Implemented: a world homepage preview, nested category contents filtered to published articles, persistent title/description/world-cover/global-cover editing. The existing `bannerImage` field represents the global article cover; `coverImage` remains the homepage cover. This mapping is a local design choice. No schema migration was needed.

The subsequent [publishing and permissions milestone](publishing-and-permissions.md) adds authenticated owner APIs, separate publication/visibility controls, public world/article routes and working Share URLs. The [image library](image-library.md) adds uploads. The in-workspace homepage remains an author preview. The subsequent [world appearance milestone](world-appearance.md) adds preset themes, background controls, accent colors and reading widths. Custom CSS remains outstanding.

[Updated article guide](https://www.worldanvil.com/learn/beginner-tutorials/get-started-articles), dated October 2, 2026: creation uses templates; slash commands insert blocks; quotations can be reordered; @ links connect articles. Publication and privacy are independent controls. Categories support nesting and ordering; search uses Ctrl+K.

Implemented: filtered slash commands for text, headings, lists, quotes, code and dividers; a block outline with drag ordering, accessible move buttons, duplicate/delete; JSON plus HTML saved through existing APIs. Existing HTML content remains editable. Block operations use the existing editor history.

The subsequent [editor and category manager milestone](editor-and-category-manager.md) adds inline block handles, tables, URL images, live statblock embeds, persisted callout nodes and category editing/reordering. The subsequent [autosave and recovery milestone](autosave-and-recovery.md) adds debounced saves and recoverable local drafts. The subsequent [image library milestone](image-library.md) adds uploads and reusable article/world covers. The subsequent [command search milestone](command-search.md) adds a Ctrl/Cmd+K palette for articles, categories and workspace tools. Publication status and visibility are now separate, with owner-only author APIs and reader filtering; the legacy state field remains synchronized for compatibility. The subsequent [article links and backlinks milestone](article-links-and-backlinks.md) adds searchable ID-based references, inline navigation and transactional backlink indexing, with compatibility for unambiguous legacy title syntax.

## Validation

TypeScript, focused ESLint and the production build pass. Chromium checks against the production build passed for published-only homepage contents, world edits, block move/drag, undo, duplicate/delete, keyboard slash insertion, JSON/HTML save and reopening. Browser checks used isolated API fixtures. A separate API check verified rejected invalid URLs/titles, missing-world handling and real database persistence using a temporary owner/world removed afterward. Computed quote styling was verified (3px border). The build emits existing timeline prerender-bailout logs but completes successfully.

Pre-existing uncommitted work was preserved. No commit or deployment is included.
