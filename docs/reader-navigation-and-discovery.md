# Reader navigation and discovery

Public readers and authenticated campaign readers share a category tree, breadcrumbs on article pages, and an in-world search. The public routes are `/w/[worldSlug]` and `/w/[worldSlug]/a/[articleSlug]`; campaign readers use `/c/[worldSlug]` and `/c/[worldSlug]/a/[articleSlug]`.

## Browse and navigate

- On wide screens, the world page shows a category tree beside the article cards. Article pages show a **World contents** pane alongside the article details.
- On narrow screens, **Browse articles** opens the same tree in a compact disclosure control above the page content.
- The tree links to the world home and articles, follows category/article order, and lets readers expand or collapse category branches. The current page is marked with `aria-current="page"`.
- Article breadcrumbs show the world, the current article's category ancestors, and the article title.
- The author workspace separates app navigation from content browsing. A stable far-left rail holds world switching and workspace destinations; World contents lives in an adjacent, collapsible explorer (or a **Browse world** drawer on narrow screens). The explorer remains scrollable while hiding its scrollbar.
- The explorer opens contextually in Articles (including reading, editing, and category management). **Pin world contents** keeps it open across other tools, and **Collapse world contents** hides it until **Show world contents** is used. An explicit collapse wins over pinning and article selection; the pin/collapse preference persists in the browser. Expanded branches, selection, and tree scroll position survive hiding and reopening. Search and New article stay in the workspace toolbar whether the explorer is open or closed.
- On narrow screens the rail opens as a drawer and the explorer opens as a separate focus-managed drawer. Escape closes it and restores focus to **Browse world**; accepting an article or category selection closes it, while declining a discard leaves it open. Search is also available from both drawers.

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

## Player notebook

`/player/notebook` (linked from the player portal) is a private plain-text
notebook. A note belongs to one account (`PlayerNote`), may belong to a campaign,
and may reference one campaign article or published map. Campaign article and map
pages offer **Take a note**, which prefills the reference; saving validates it
with the same reader access as **Save**.

`GET/POST/PATCH/DELETE /api/player/notes` are session-only, same-origin for
writes, and `private, no-store`. GM preview sessions receive 403. Reads return
the player's own title and body plus a projected campaign label and reference
link; the reference title and link are re-checked through `readableWhere()` and,
for maps, the publication and readable base image. Revoking access or
unpublishing a map hides only the reference: the note text stays. Archiving a
campaign removes the campaign label but keeps the note. Deleting a campaign sets
the note's `worldId` to null; deleting an article or map does not delete notes.

Updates are optimistic: `PATCH` requires the loaded `version`, increments it, and
returns `409` with the current server copy (including its campaign) when another
device changed the note first. The editor keeps the player's draft and offers
**Load latest** or **Copy my draft** rather than overwriting either version.
Campaign changes are sent only when the player actually changes the selector, so
saving text while a campaign is temporarily hidden does not detach the note.
Deleting requires confirmation, and while a save or delete is in flight the
editor, note list, and navigation controls are locked so a late response cannot
replace newer work. Notes are excluded from world export/import and never appear
in reader search, **What's new**, or the GM notebook.

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
- Author workspace navigation: `src/components/AuthorWorkspace.tsx`, `src/components/Sidebar.tsx` (rail), `src/components/WorldContentsExplorer.tsx` (tree), and `src/lib/explorer-visibility.ts` (visibility rules). The article template picker lives in `src/components/ArticleTemplatePicker.tsx`.
- Focused regressions: `tests/reader-navigation.test.tsx`, `tests/explorer-visibility.test.ts`, `tests/browser/sidebar-world-contents.spec.ts`, `tests/stock-credits.test.ts`.
- Server-backed credit/authorization check: `tests/reader-credits-api.test.tsx` (skips without `WORLDFORGE_TEST_ORIGIN`).

Run the focused reader checks with:

```bash
node --import tsx --test tests/reader-navigation.test.tsx
```

The server-backed campaign reader checks depend on the integration-test database setup documented by the relevant tests. Do not use the demo seed against a configured user database to prepare screenshots; see the screenshot guidance in `AGENTS.md`.
