# Reader navigation and discovery

Public readers and authenticated campaign readers share a category tree, breadcrumbs on article pages, and an in-world search. The public routes are `/w/[worldSlug]` and `/w/[worldSlug]/a/[articleSlug]`; campaign readers use `/c/[worldSlug]` and `/c/[worldSlug]/a/[articleSlug]`.

## Browse and navigate

- On wide screens, the world page shows a category tree beside the article cards. Article pages show a **World contents** pane alongside the article details.
- On narrow screens, **Browse articles** opens the same tree in a compact disclosure control above the page content.
- The tree links to the world home and articles, follows category/article order, and lets readers expand or collapse category branches. The current page is marked with `aria-current="page"`.
- Article breadcrumbs show the world, the current article's category ancestors, and the article title.
- The author workspace has its own responsive navigation: a collapsible sidebar on desktop and a drawer on mobile. Its World contents section remains scrollable while hiding the scrollbar.

## Search and access boundaries

Reader search is client-side and matches all query terms against article titles and excerpts. Results prioritize titles that start with the complete query, then sort alphabetically. It does not search article bodies.

Public routes receive only published, public articles and their categories. Campaign routes use `readableWhere()` and retain only category paths needed to locate readable articles. Keep the public and campaign projections separate: private titles, drafts, secret notes, and category names unrelated to readable campaign content must not appear in reader trees, breadcrumbs, or search results.

## Player activity feed

`/player` shows **What's new** above **Your worlds**: the 20 most recent shared
articles, session recaps, and published maps across the player's campaigns.
`/api/player/activity` resolves the caller from the session cookie, then
re-checks every candidate with `readableWhere()` for the resource kind and the
reader's asset access for map images. Entries carry no stored titles or links;
the projection reads the current article or map snapshot, so a rename shows the
new title, while revoking access, unpublishing a map, or archiving a world
removes the entry on the next request. Sharing an article (audience policy) or
publishing a map records or bumps one `PlayerActivity` row in the same
transaction as the share write; `GM_ONLY`, an audience revoke, or unpublishing
deletes it. Drafts that were never shared never appear, and the feed never
grants access by itself. It is a reading aid, not a notification system: there
are no unread badges or emails.

## Player bookmarks

Campaign articles and published maps expose a **Save** toggle. Bookmarks are
private to the signed-in account (`PlayerBookmark`, one row per account and
resource) and are deliberately per-user, not per-device: they appear on
`/player` under **Saved** on any browser signed into the same account. Saving
validates current reader access and, for maps, a published snapshot with a
readable base image.

`GET /api/player/bookmarks` resolves the caller from the session cookie, then
re-checks `readableWhere()` for each saved resource and the reader's asset access
for map images. Titles and links are projected from the current article or map
snapshot, and hidden entries never count toward the 100-item list limit.
Revoking access, unpublishing a map, archiving a world, or losing image access
hides the bookmark without deleting it, so restoring access brings it back;
permanently deleting an article or map removes the bookmark rows. GM preview
sessions can read an empty list but cannot save or remove bookmarks. Bookmarks
are excluded from world export and are not visible to GMs as a per-player list.

## Illustrations and credits

Category illustrations and article image credits follow the same publication and visibility boundaries as the content they decorate. The reader tree shows a category's illustration only when the image is readable in that projection, renders it with an empty `alt`, and otherwise falls back to the labelled folder icon; a private or failed image must never leak a URL, a broken-image glyph, or a private warning.

Public and campaign readers preserve placement descriptions: null falls back to the article/world title, an empty string is decorative, and a supplied description is rendered unchanged. Global article-cover fallback selects both its image and its description.

Pages project credits only for artwork actually used by readable covers, portraits, body images, backgrounds and displayed categories. All applicable provenance records survive projection. **Artwork credits** includes source/creator/license links and modification notices; identical complete credits are deduplicated without merging distinct requirements. Body/cover/portrait credits marked adjacent also appear directly beneath the image. Revoking access removes the image and its credit together.

## Implementation and verification

- Shared reader tree, compact browse control, and search: `src/components/public/ReaderCategoryTree.tsx`, `ReaderMobileBrowse.tsx`, and `ReaderSearch.tsx`.
- Reader image credits: `src/lib/stock-credits.ts`, `src/components/public/ReaderImageCredits.tsx`.
- Persistent image references and byte authorization: `src/lib/asset-references.ts` and `src/lib/public-world.ts`.
- Ordering and route helpers: `src/lib/category-tree.ts`.
- Public reader data: `src/lib/public-world.ts` and `src/app/w/[worldSlug]/`.
- Campaign reader data: `src/app/c/[worldSlug]/`.
- Database-backed pages render at request time through one shared boundary: `requireRequestTime()` in `src/lib/request-time.ts`. `publicWorld()` and `resolvePageActor()` (used by both `/c/` pages) call it before querying, and the workspace, player portal, and admin layout call it at their entry points. better-sqlite3 executes synchronously, so without the boundary the partial-prerender shell runs the queries and Next aborts the route on the `new Date()` in Prisma's clock read (#39). Do not call it from Route Handlers, which have no render scope. Regression coverage is the reader case in `tests/production-auth-smoke.test.ts`, which runs against `next start`; `next dev` does not reproduce the failure.
- Author workspace navigation: `src/components/AuthorWorkspace.tsx` and `src/components/Sidebar.tsx`.
- Focused regressions: `tests/reader-navigation.test.tsx`, `tests/stock-credits.test.ts`.
- Server-backed credit/authorization check: `tests/reader-credits-api.test.tsx` (skips without `WORLDFORGE_TEST_ORIGIN`).

Run the focused reader checks with:

```bash
node --import tsx --test tests/reader-navigation.test.tsx
```

The server-backed campaign reader checks depend on the integration-test database setup documented by the relevant tests. Do not use the demo seed against a configured user database to prepare screenshots; see the screenshot guidance in `AGENTS.md`.
