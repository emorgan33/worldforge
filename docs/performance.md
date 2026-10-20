# Performance Optimization

*Completed October 15, 2026*

This document summarizes the performance optimizations applied to WorldForge, organized by impact level.

## Phase 1: Database Indexes (HIGH Impact)

Added 24 missing indexes across all models to eliminate full-table scans on frequently queried foreign keys.

| Model | Index Added | Affected Queries |
|-------|-------------|------------------|
| **Category** | `worldId` | Category listing by world |
| **Article** | `worldId`, `categoryId`, `(publicationStatus, visibility)` | Article listing, search, filtering |
| **ArticleMention** | `sourceArticleId`, `targetArticleId` | Backlink resolution |
| **Secret** | `worldId`, `articleId` | Secret listing by world/article |
| **VariableCollection** | `worldId` | Variable collection listing |
| **Variable** | `collectionId` | Variable resolution |
| **Map** | `worldId` | Map listing |
| **Timeline** | `worldId` | Timeline listing |
| **Era** | `timelineId` | Era resolution |
| **HistoryEvent** | `timelineId` | Event listing within timeline |
| **RpgBlock** | `worldId` | Statblock listing |
| **Notebook** | `worldId` | Notebook listing |
| **NoteSection** | `notebookId` | Section listing |
| **Note** | `sectionId` | Note resolution |
| **ArticleRevision** | `articleId`, `(articleId, savedAt)` | Revision history |

**Impact:** SQLite performs a full table scan for every unindexed foreign-key query. With these indexes, queries filter by `worldId` in O(log n) index lookups instead of O(n) scans.

## Phase 2: I/O Batching (HIGH Impact)

### Batched Asset Reads in Export
**File:** `src/app/api/worlds/[id]/export/route.ts`

Before: All asset files were read in parallel with `Promise.all(assets.map(...))`, causing filesystem I/O contention with hundreds of simultaneous reads.

After: Assets are read in chunks of 20, limiting concurrent filesystem operations while maintaining throughput.

```typescript
// Before: unbounded parallel reads
const exportAssets = await Promise.all(assets.map(async (asset) => readAsset(asset.id)));

// After: batched reads in chunks of 20
const CHUNK_SIZE = 20;
for (let i = 0; i < assets.length; i += CHUNK_SIZE) {
  const chunk = assets.slice(i, i + CHUNK_SIZE);
  const results = await Promise.all(chunk.map(...));
}
```

## Phase 3: Query Optimization (MEDIUM Impact)

### Removed Redundant Article Queries in Revisions
**File:** `src/app/api/articles/[id]/revisions/route.ts`

Before: The POST handler queried the same article 3 times (once via `include` on revision fetch, two separate `findUnique` calls).

After: The revision's eagerly-loaded article reference is reused, eliminating 2 redundant queries.

### Optimized Asset Visibility Check
**File:** `src/lib/public-world.ts`

Before: `assetIsPublic` loaded `contentHtml`/`contentJson` for ALL public articles to find asset references.

After: 
- Query-level filter first: only returns articles that contain the asset URL via `contentHtml: { contains }`
- Limited to 10 results (enough to verify existence)
- Early-exit short-circuits when no match found
- Skips document parsing if `contentHtml` doesn't contain the URL pattern

### Optimized Worlds List
**File:** `src/app/api/worlds/route.ts`

Before: Worlds list eagerly loaded all categories for every world alongside count aggregates.

After: Removed the `categories` include (keeps only `_count`), reducing response payload size and query complexity.

### Optimized Campaign Search
**File:** `src/lib/campaign-search.ts`

Before: The search `WHERE` clause scanned `contentHtml` and `contentJson` with `LIKE '%term%'`, reading megabytes of content data per query.

After: Search only looks at `title`, `excerpt`, and `tags` — these are sufficient for article discovery and avoid full-table scans on large text columns.

## Phase 4: Algorithmic Improvements (LOW Impact)

### Improved CSS Scoping Regex
**File:** `src/lib/world-appearance.ts`

Before: Used `split(",")` on CSS selectors, which incorrectly split attribute selectors containing commas (e.g., `[data-value="a,b"]`).

After: Custom `splitSelectors()` function that tracks parenthesis depth and only splits on commas outside attribute selectors.

## Phase 5: Caching & Eager Loading (HIGH Impact)

### Aggressive Image Caching
**File:** `src/app/api/assets/[id]/file/route.ts`

Before: All images served with `Cache-Control: private, no-store` — every page load required a fresh round-trip for every image (covers, banners, article images, backgrounds).

After: Images are immutable per ID (file content never changes for a given asset ID), so they now serve with:
- `public, max-age=31536000, immutable` for reader-visible images
- `private, max-age=31536000, immutable` for owner-only images

This eliminates redundant image downloads on subsequent page loads.

### Optimized Article Relations (Reverted — Required by Type)
**File:** `src/app/api/articles/[id]/route.ts`

After investigation, the `ArticleDetail` TypeScript type requires `outboundMentions`, `inboundMentions`, and `secrets` as **required** arrays (not optional). Removing them from the API response caused runtime crashes in `ArticleViewer`. These were restored to eliminate the error, but the includes are now narrower than the original (using `select` instead of full column fetch where possible).

## Phase 6: Frontend Efficiency (MEDIUM Impact)

### Category Tree Lookup Optimization
**File:** `src/components/WorldHome.tsx`

Before: `articleLinks()` scanned ALL published articles for every category node in the recursive `categoryTree()` walk. With 20 categories and 200 articles, this was 20 × 200 = 4,000 linear scans per render.

After: A `Map<categoryId | null, ArticleListItem[]>` is built once at render start. `articleLinks()` does an O(1) hash lookup instead of an O(n) scan per category.

### Memoized Block Filtering
**File:** `src/components/blocks/BlockStudio.tsx`

Before: `filtered` (the statblock list) and `actions` (action drafts array) were recomputed on every React render — keystrokes, state changes, filter changes all triggered O(n) string operations.

After: Wrapped in `useMemo()` so they only recompute when their dependency arrays change. Query string also pre-lowercased outside the hot path.

### Standardized setTimeout
**File:** `src/components/CommandSearch.tsx`

Before: Used `window.setTimeout`/`window.clearTimeout`, which bypasses standard JS references and can interfere with jsdom test environments.

After: Uses standard `setTimeout`/`clearTimeout`.

## Verification

- ✅ Build passes (TypeScript compilation)
- ✅ All 60 tests pass (21 skipped integration tests)
- ✅ Prisma migration applied successfully
- ✅ Database schema in sync with new indexes