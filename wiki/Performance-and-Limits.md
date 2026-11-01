# Performance and Limits

WorldForge is a single-instance, self-hosted Next.js application backed by
SQLite and a local asset directory. Capacity depends on the host's CPU, memory,
disk latency, reverse proxy, and campaign content. There is no published
concurrent-user or world-size guarantee.

## Enforced limits

| Operation | Limit |
| --- | ---: |
| Image upload | 10 MiB per image |
| Complete world export/import request | 60 MiB JSON |
| World import section | 10,000 records per section |
| Imported asset data | 14 MiB of base64 text per asset |
| Foundry upload | 10 MiB total and per file |
| Foundry document | 1 MiB each |
| Foundry documents | 1,000 per preview/import |
| Foundry items selected for one import | 250 |
| Password | 12–128 characters |
| Admin API request body | 8 KiB |

The image pipeline normalizes supported uploads to WebP, so stored size may
differ from upload size. World JSON includes base64 image data; large image
libraries can therefore reach the transfer limit before the SQLite database is
large. Use [Backup and Restore](Backup-and-Restore) for oversized worlds.

## Expirations and throttles

| Capability | Lifetime or threshold |
| --- | --- |
| Signed-in session | 7 days |
| Account setup/recovery link | 24 hours, one use |
| Player invitation | 7 days, one use |
| Player preview session | 15 minutes |
| Foundry import preview | 30 minutes |
| Login attempts | 8 per account and source, or 30 per source, per 15 minutes |

Successful login clears the account-specific failure record and releases its
source attempt. Public HTTPS installations must provide a trustworthy client IP
through the configured private proxy; see [Security Model](Security-Model).

## Large worlds

Author article lists are paged in 200-row responses and continue until the
complete world is loaded. Search uses SQLite FTS narrowing where supported and
bounded result paging while preserving the application's exact matching rules.
Backlinks and public asset authorization retain compatibility scans for legacy
references that do not have derived indexes.

Existing installations upgraded through the reader-index migration may need
the documented one-time backfill:

```bash
docker compose exec worldforge pnpm exec tsx scripts/backfill-reader-indexes.ts --apply
```

Run it only after taking a backup and only when the release notes for your
upgrade instruct you to do so. Normal article writes maintain these derived
indexes afterward.

## Operational guidance

- Put the database and asset directory on persistent, low-latency local
  storage. Network filesystems can weaken SQLite reliability and latency.
- Keep enough free disk space for the live data, SQLite temporary work, image
  processing, a new container image, and at least one local backup.
- Do not run multiple WorldForge application replicas against the same SQLite
  file.
- Keep full-installation backups even when individual world exports succeed.
- Measure your own representative world before promising response-time or
  concurrency targets.

The repository performance document records synthetic measurements around
2,101 articles, but those numbers are engineering evidence rather than a
production service-level objective.

**Source owner:** `wiki/Performance-and-Limits.md`; adapted from
`docs/performance.md` and current validation constants in `src/lib`.
**Verified against:** WorldForge commit `fdff259` (October 31, 2026).
