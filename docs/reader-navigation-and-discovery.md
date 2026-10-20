# Reader navigation and discovery

WorldForge public readers now provide visible category tree navigation, breadcrumb trails and client-side reader search scoped exclusively to published, public articles.

## Public reader capabilities

1. **Category navigation & lore hierarchy:**
   - Both the public world homepage (`/w/[worldSlug]`) and public article view (`/w/[worldSlug]/a/[articleSlug]`) display the world's published category hierarchy.
   - Sibling categories and articles respect established author order (`sortOrdered`).
   - Categories can be expanded and collapsed, maintaining clean layout across both desktop and narrow/mobile viewports.
   - The active article is indicated with `aria-current="page"` and highlighted styling.

2. **Breadcrumb trails:**
   - The public article view features an accessible `ReaderBreadcrumbs` component (`aria-label="Breadcrumb"`).
   - Breadcrumbs show the lineage from world root through any parent categories down to the current article title.

3. **Reader search:**
   - The `ReaderSearch` component provides fast, real-time search across titles and excerpts for published public articles in the active world.
   - Exact and prefix title matches are prioritized, followed by excerpt and keyword matches.
   - Clear button and empty states provide intuitive feedback.

4. **Strict permission separation:**
   - `publicWorld` and `publicArticle` query filters only select published, public articles (`publicationStatus: "PUBLISHED"`, `visibility: "PUBLIC"`).
   - Private article titles, drafts, WIPs, secret notes and unapproved media are never delivered to reader search or category navigation payloads.

## Verification

- Automated unit and regression tests in `tests/reader-navigation.test.tsx` verify:
  - `searchReaderArticles` title/prefix/excerpt scoring and empty handling.
  - `ReaderBreadcrumbs` markup, lineage ordering and accessible attributes.
  - `ReaderCategoryTree` hierarchy rendering, root items and active selection.
  - `ReaderSearch` accessibility and input semantics.
- All 56 test suite cases pass cleanly with zero skipped tests.
- TypeScript (`tsc --noEmit`) and ESLint checks pass with zero errors in public reader paths.


## Player reader pages

Authenticated players access the campaign through the `/c/[worldSlug]` route, separate from the anonymous `/w/...` public surface. The player reader:

- Resolves the actor (supports PREVIEW mode for GM testing)
- Uses `requireReadableResource()` to filter articles by audience policy
- Renders only policy-allowed content with no GM callouts or private links
- Shows a preview banner when viewing as a player through the GM preview system
- Provides a simplified PlayerSidebar with filtered article tree and search

Player search at `/api/c/[worldSlug]/search` returns only policy-filtered results.
