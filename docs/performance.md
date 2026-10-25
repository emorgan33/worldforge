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

### Complete Asset Visibility Authorization
**File:** `src/lib/public-world.ts`

R03a removed the ten-candidate limit and raw-URL prefilters from public image
authorization. It now examines all published public article candidates and
parses the displayed reader projection before granting byte access. This keeps
entity-encoded HTML, escaped JSON, absolute local URLs and visible references
after misleading prose or GM-note matches correct. The larger query cost is a
known tradeoff; any future optimization must retain complete matching and the
same publication, visibility and reader-content filters. Representative-size
measurement and optimization are tracked in R17 of `refactor.md`.

### Optimized Worlds List
**File:** `src/app/api/worlds/route.ts`

Before: Worlds list eagerly loaded all categories for every world alongside count aggregates.

After: Removed the `categories` include (keeps only `_count`), reducing response payload size and query complexity.

### Campaign Search
**Files:** `src/lib/campaign-search.ts`, `src/lib/campaign-search-db.ts`

Campaign author search keeps its all-terms substring matching across title, excerpt, tags, HTML, and JSON bodies. SQLite FTS5 trigram indexes narrow supported ASCII terms, then the original `LIKE` predicates verify candidates to preserve Unicode substring behavior. For common FTS terms, the candidate CTE checks at most 201 rowids and skips index intersection; selective terms retain FTS narrowing. Player search applies the same candidate narrowing to readable article IDs but restricts matching to title, excerpt, and tags, preserving reader discovery behavior. Public reader search remains client-side over visible titles and excerpts. The route reuses the shared JavaScript rank function, including JavaScript Unicode lowercasing, and `localeCompare` ordering for accented, punctuated and case-varied titles. It scans compact summaries in fixed 2,000-row rowid ranges, advances the FTS rowid boundary with each batch, and retains only the next 41 matches in memory. This avoids repeated scans of earlier candidates while keeping application memory bounded independently of total match count.

### Lightweight Author Article Lists
**File:** `src/app/api/articles/route.ts`

The workspace article-list query selects summary fields only. It omits document bodies, metadata, tags and relation collections, which remain available from article detail requests. The response keeps the existing fields consumed by author list views. The previous 2,000-row truncation was removed so larger worlds are not silently incomplete. Responses are capped at 200 rows and the workspace follows the stable cursor to load the full list.

R17 benchmark (2026-10-25): `scripts/benchmark-r17-article-list.ts` created 2,101 articles in a dedicated temporary SQLite database. Each article had about 7 KB of HTML and JSON content. Across three runs, selected database projections and local median timings were:

| Projection | Rows | Database queries | Total JSON bytes | Largest page | Median elapsed |
|------------|-----:|-----------------:|-----------------:|-------------:|---------------:|
| Full rows, one query | 2,101 | 1 | 16,496,123 | 16,496,123 | 240 ms |
| Summary pages | 2,101 | 21 | 1,162,726 | 111,001 | 193 ms |

Latest search benchmark (2026-10-25, 2,101 articles, three-run median): broad search took **35.3 ms / 2 queries** with the baseline full candidate fetch/rank path and **36.1 ms / 3 queries** with bounded rowid-range scanning. The baseline hydrated 2,101 summaries / 482,160 JSON bytes; the optimized path returned 41 rows / 9,458 bytes and held at most one 2,000-row batch plus 41 ranked candidates. This replaces the earlier repeated-batch result of 769 ms / 12 queries while preserving bounded application memory and exact JavaScript ranking. A selective term matching one article took **27.4 ms / 2 queries** on the baseline and **2.5 ms / 2 queries** with FTS; each path returned 267 bytes. These synthetic results keep broad-search latency near baseline and materially improve the previous repeated-scan implementation. The 67 ms SQL-page, 769 ms repeated-batch and 32 ms single-query measurements are superseded.

For backlinks, parsing all 2,101 public article documents returned a 14,940,472-byte projection and took 75.3 ms; the indexed explicit-link path returned one 40-byte source ID in 1.6 ms. Legacy title-based links keep the reader-projection parsing fallback. Public asset authorization scanned 2,101 article projections (15,022,411 bytes) and took 65.1 ms; an indexed placement check took 1.8 ms, with a 60-byte index projection. These paths use exact normalized article references, and public publication filters still apply at lookup time. After applying the R17 migration, run `pnpm exec tsx scripts/backfill-reader-indexes.ts --apply` once to build the derived indexes for existing and imported articles. Until then, those rows retain the complete compatibility scan; article writes maintain their indexes automatically.

The list benchmark returned the full article set and reduced serialized bytes by about 93%, with a maximum page around 111 KB. All timings are synthetic local measurements, not production latency estimates. Search counts include the category projection query; list query counts include one cursor validation lookup per continuation page. To rerun, create a migrated SQLite database at `test.db` inside a dedicated `worldforge-r17-*` directory under the system temp directory, set `DATABASE_URL` to its absolute `file:` URL, then run `pnpm exec tsx scripts/benchmark-r17-article-list.ts`. The script refuses any other database path and deletes its temporary world and user when it exits. `R17_ARTICLE_COUNT` can vary the number of inserted articles.

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

R17 is complete. Author article-list, broad and selective campaign search, public backlinks, and public asset authorization measurements above 2,000 articles are recorded above. Indexed query paths bound response projections while legacy references retain complete parsing fallbacks. Campaign search scans fixed 2,000-row rowid ranges and retains only the next 41 candidates for exact JavaScript ranking and cursor paging. A follow-up isolated benchmark reproduced broad search at 35.6 ms / 3 queries and selective search at 2.1 ms. The broad-search latency and transfer trade-offs are documented above, and the R17 work log is in `refactor.md`.

- ✅ Build passes (TypeScript compilation)
- ✅ All 60 tests pass (21 skipped integration tests)
- ✅ Prisma migration applied successfully
- ✅ Database schema in sync with new indexes
