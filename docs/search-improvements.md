# Search improvements

Author campaign search now queries the owner's world on the server, including article body text, instead of filtering only the articles already loaded in the workspace.

## Author search

- Ctrl/Cmd+K and Search campaign still open the same modal, keep focus in the dialog, and reuse unsaved-edit / save-in-progress guards when a result is opened.
- Article results come from `GET /api/search`, scoped with `withAuthor` to the current owner's world. Anonymous callers receive 401; other authors receive 404 for a world they do not own.
- Every query word must appear in title, excerpt, tags, `contentHtml` or `contentJson`. Title-prefix matches rank first, then title, excerpt/tags, then body. Body HTML/JSON is not returned in the payload.
- Filters cover result type (all / articles / categories / tools), article template, publication status and category. Category results show the nested path (`Atlas / Cities`) so identically named articles and folders stay distinguishable.
- Article pages return 40 hits plus `nextCursor`. Load more appends the next page. Changing the query or filters clears previous hits so Enter cannot open a stale result.
- Categories, workspace tools and New article remain local commands. The sidebar tree filter is unchanged. Public reader search still uses published titles and excerpts only.

## Verification

- Unit tests cover ranking, pagination, filter parsing, category paths, local command scoping and palette filter markup.
- `WORLDFORGE_TEST_ORIGIN=http://127.0.0.1:3033 pnpm test` covers body matches, template/status/category filters, pagination and cross-owner denial. Isolated fixture users are deleted afterward.
