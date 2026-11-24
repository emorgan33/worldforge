# Access-control matrix

Campaign security depends on every private surface answering the same caller
question the same way. `tests/access-matrix-api.test.ts` is the executable
regression for this table; run it against the isolated HTTP test server and
database described in [CONTRIBUTING.md](../CONTRIBUTING.md).

| Surface | Anonymous | Non-member | Revoked member | Active player | GM preview | Owner |
| --- | --- | --- | --- | --- | --- | --- |
| Campaign search `/api/c/[worldSlug]/search` | 401 | 404 | 404 | readable results only | readable results in the previewed world | all articles in the owned world |
| Campaign page `/c/...` | not found | not found | not found | readable articles and published maps | previewed world only | redirected to the workspace |
| Asset bytes `/api/assets/[id]/file` | public placements only | 404 | 404 | readable policy and not restricted | previewed world only | owned world |
| Notebook `/api/player/notes` | 401 | own notes | own notes | own notes | 403 | own notes |
| Bookmarks `/api/player/bookmarks` | 401 | own items | own items | own items | empty | own items |
| Activity `/api/player/activity` | 401 | own readable updates | own readable updates | own readable updates | previewed world only | own readable updates |
| World export `/api/worlds/[id]/export` | 401 | 403/404 | 403/404 | 403 (player role) | 403/404 | owned, non-archived world |

Rules the matrix enforces:

- Authentication alone is not campaign access. Search, readers, map snapshots,
  and asset bytes require active membership or a valid shared policy; the server
  never trusts a client-supplied world or resource ID.
- Player-account APIs (`/api/player/*`) are per-account. GM preview sessions may
  browse campaign content but cannot read or change another account's notebook,
  and they see an empty bookmark list.
- Archived (soft-deleted) campaigns disappear from search, readers, exports, and
  asset bytes for non-owners. Owners may still manage archived worlds through the
  archived-world routes.
- Revoking a policy removes titles, links, and bytes on the next request.
  Notebook and bookmark text that belongs to the player survives; projected
  campaign and reference details do not.
- Private responses use `Cache-Control: private, no-store`; anonymous failures
  use `no-store`.
- Membership revocation and preview expiry are checked per request, not cached.
