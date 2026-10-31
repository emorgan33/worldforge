# Image library and uploads

The sidebar's Image library supports uploads, search, paginated browsing, title/default-alt editing, URL copying, hiding and restoration. The same library opens in a native modal picker from article covers, world/global covers and the editor's Image block. Uploads inside a picker do not submit the surrounding article or world form. Selecting an image for an article body copies its default alternative text into that insertion; later library edits do not rewrite existing image alt text.

PNG, JPEG and WebP files are supported up to 10 MiB and 40 million pixels. Animated and unsupported formats are rejected. The server bounds multipart request bytes, decodes the file, applies orientation, strips source metadata and stores a WebP copy. Duplicate normalized content is reused within a world. Filenames are descriptive metadata only; disk keys are generated UUIDs. Original files are not retained.

Image metadata is stored in the new `ImageAsset` table. Files are stored outside the build in `data/assets`, or at the absolute directory configured by `WORLDFORGE_ASSET_DIR`. `/api/assets/{id}/file` serves validated image IDs with a WebP content type and nosniff header. Image bytes are immutable. Hiding changes library visibility and keeps existing URLs working, including existing public placements; unplaced archived images remain private. Restoring makes an entry available for reuse. Re-uploading an identical hidden image restores its entry. Permanent deletion is available only when the complete reference scan finds no placement. Metadata removal and durable file-cleanup scheduling are committed together, so failed file removal can be retried.

Local asset URLs are world-scoped even when written as absolute HTTP/HTTPS URLs: a URL path matching `/api/assets/{id}/file` is treated as a library asset and must identify an asset in the placement's world. Surrounding whitespace in image `src` values is trimmed before asset IDs are extracted, consistently in validation and reference scans. Article body placements are checked from the parsed document. Usage and deletion scans parse article and revision bodies before matching image IDs, so HTML entity encoding cannot hide a reference; revisions, maps, map layers, timelines, categories, and world appearance also prevent deletion while they retain the asset. Article create and update requests require `contentJson` to be a document object; serialized JSON strings are rejected so validation and stored reader content cannot select different documents.

The Image Usage panel shows references in world decorations, category illustrations, articles, revision snapshots, maps, map layers and timelines. Permanent deletion stays blocked while any of these references remain. If a reference is added after the panel loads, the server still refuses deletion and the panel refreshes its usage details.

Anonymous image access follows the public reader projection: public world decorations and category illustrations, plus covers, portraits and visible body images in published public articles. Authorization parses URLs and documents, including entity-encoded HTML, escaped JSON and absolute local URLs, and checks all published public articles without a candidate-count limit. Prose mentions, GM-only content, stale HTML superseded by a JSON document, revisions, private/draft articles, maps and timelines do not grant anonymous access. Display restrictions still block readers. Removing the last public placement, unpublishing the article, making the world private or archiving the world revokes access on the next image request. Campaign image access continues to use its audience policies and grants.

For another installation, back up SQLite and asset storage together using the [backup and restore guide](backup-restore.md), apply committed migrations with `pnpm db:deploy`, and regenerate the client with `pnpm db:generate` when the schema changes. The original workspace backup path is historical, not a portable recovery location. A host/container must mount the asset directory on persistent writable storage; an ephemeral/serverless filesystem is not a durable storage backend. The legacy world cleanup endpoint is disabled for physical deletion because files share a directory and unregistered files cannot be assigned safely to one world. Archived-world purge instead queues known asset IDs through durable cleanup jobs.

Article covers now participate in autosave and local draft recovery. An article cover overrides the world's global article cover; clearing it restores the fallback. Existing external HTTP/HTTPS image URLs remain supported. Local library cover references are checked against the article/world's own assets. Body image selection is scoped to that world's library.

Placements now carry their own accessibility description. `Article.coverImageAlt`,
`Article.portraitImageAlt`, `World.coverImageAlt` and `World.bannerImageAlt` are
nullable: `null` keeps the renderer's legacy fallback (the article/world title),
an empty string marks the art decorative, and any other value is the author's
description. The editor and world settings present **Describe this image** and
**Decorative image** controls rather than null/empty terminology. Article
revisions and local drafts snapshot these URLs and descriptions, and cloning
copies them. Category illustrations use a separate `Category.iconImage` field
managed through the picker; author and reader trees show it beside the category
name with empty alt so the name stays the label. Placement vocabulary and fitting
geometry are shared through `src/lib/image-placement.ts`.

The subsequent [publishing and permissions milestone](publishing-and-permissions.md) adds owner sessions and enforces image access. Anonymous readers receive only files referenced by public world/article content; other files require the owner session. Image bytes now use private/no-store caching so publication revocation is checked on each request.

Tests cover decoding, transparent images, metadata stripping, byte limits without Content-Length, unsupported/corrupt input, stable/deduplicated uploads, world-scoped edits and covers, search, hiding/restoring and unchanged byte URLs. Chromium checks cover upload retries, nested picker isolation, image insertion/alt text, article autosave and cover selection, world/global covers, override/fallback, metadata edits and reload persistence.

Production verification passed: all 34 automated tests (including image API pagination and the existing API integration tests), TypeScript, focused ESLint and the production build. Chromium verified the complete upload/reuse/cover/hide/restore workflow on port 3033. A separate uploaded image was served successfully after rebuilding and restarting the server. Test records and files were removed afterward. The existing nonfatal timeline prerender logs remain.

## Provenance and stock-art source

`ImageAsset.source` records how the bytes entered the world: `UPLOADED`,
`STOCK`, or `IMPORTED`. Existing rows default to `UPLOADED`. This acquisition
source is separate from verification and audience access.

`ImageAssetProvenance` stores reviewed or imported catalog evidence without
changing the asset's editable title or default alt text. Selecting stock art
copies the approved WebP bytes into the world, then creates or reuses the
`(worldId, sha256)` image and appends a bounded provenance snapshot. Repeated
selection is idempotent. Ordinary asset PATCH requests cannot erase provenance.
The `source` label answers where the bytes came from, not whether the image is
shared with players or whether an imported claim was verified. `GET /api/assets`
accepts `source=all|uploaded|stock|imported`, applied before pagination; the
stock and imported filters also match persisted provenance when the acquisition
label differs. See [Curated stock art](stock-art.md) for the catalog and
terminology.
