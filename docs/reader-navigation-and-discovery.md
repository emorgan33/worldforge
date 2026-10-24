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
- Author workspace navigation: `src/components/AuthorWorkspace.tsx` and `src/components/Sidebar.tsx`.
- Focused regressions: `tests/reader-navigation.test.tsx`, `tests/stock-credits.test.ts`.
- Server-backed credit/authorization check: `tests/reader-credits-api.test.tsx` (skips without `WORLDFORGE_TEST_ORIGIN`).

Run the focused reader checks with:

```bash
node --import tsx --test tests/reader-navigation.test.tsx
```

The server-backed campaign reader checks depend on the integration-test database setup documented by the relevant tests. Do not use the demo seed against a configured user database to prepare screenshots; see the screenshot guidance in `AGENTS.md`.
