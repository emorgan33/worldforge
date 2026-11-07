# Images and Stock Art

Open **Image library** to upload, search, edit titles/default alternative text,
copy URLs, hide, or restore world images. The same picker opens from article
images/covers and world styling.

PNG, JPEG, and WebP are supported up to **10 MiB** and **40 million pixels**;
animated/unsupported files are rejected. Uploads are oriented, stripped of source
metadata, and normalized to WebP. Original files are not kept. Identical
normalized uploads are reused within the world.

## Place and describe images

Select an image for its intended placement. **Describe this image** supplies
placement-specific alternative text; **Decorative image** deliberately leaves
it empty. Updating the library's default description does not rewrite existing
body insertions. Article-specific covers override the global article cover;
clearing the override restores that fallback.

Hiding removes an image from ordinary library browsing but does not break
existing placements or revoke public access. Use the usage panel before deletion:
articles, revisions, maps, categories, and decorations can block permanent
deletion. Remove public placements or unpublish/private the world to revoke
anonymous access. Campaign images need their own sharing grants.

## Stock art and rights

Stock browsing does not copy bytes into a world until you select an entry.
**Added to this world** means saved, not shared with players. Source, verification,
and audience access are separate concepts.

At v0.4.3, eight development candidates are **pending human review**; none is
approved for production selection. An empty production catalog is expected.
Do not treat a candidate or imported provenance claim as rights approval.
For any artwork you supply, retain its license/source and confirm your intended
display, modification, and redistribution rights.

Readable placements include applicable **Artwork credits** and required adjacent
credits. Keep these notices when sharing or exporting. Disputed entries can be
restricted by the operator; retirement alone does not revoke existing copies.
Back up image files together with SQLite: metadata alone cannot restore bytes.

**Source owner:** `wiki/Images-and-Stock-Art.md`; implementation:
`docs/image-library.md`, `docs/stock-art.md`, `docs/stock-art-review/`, and asset routes.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
