# Reader Navigation and Search

Public readers enter `/w/<worldSlug>`; signed-in campaign members use
`/c/<worldSlug>`. These are reading views, not the author workspace.

- On desktop, use **World contents** and expand/collapse category branches.
- On mobile, open **Browse articles** above the content.
- Article breadcrumbs show the world and category ancestors. The current page
  is identified in the navigation for assistive technology.
- Search matches every query term against readable **titles and excerpts**,
  prioritizes titles starting with the complete query, then sorts alphabetically.
  Reader search does not search article bodies.

Missing results may be an access issue, not a search failure. Anonymous readers
see only published public articles in public worlds. Campaign members see only
currently readable articles and the category paths needed to reach them. Private
category branches and article titles are not offered as search hints.

Readable images keep their placement descriptions and applicable artwork credits.
Private or unavailable category illustrations fall back to a folder icon.
See [Publishing and Permissions](Publishing-and-Permissions) for sharing rules,
and [Images and Stock Art](Images-and-Stock-Art) for attribution.

**Source owner:** `wiki/Reader-Navigation-and-Search.md`; implementation:
`docs/reader-navigation-and-discovery.md`, `src/components/public/`, public and campaign routes.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
