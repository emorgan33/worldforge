# Architecture Overview

WorldForge is a self-hosted Next.js/React/TypeScript application with Prisma,
SQLite, and filesystem image storage. It is not a hosted multi-tenant service or
an external VTT backend.

| Location | Responsibility |
| --- | --- |
| `src/app/` | Pages, public `/w/` and campaign `/c/` readers, API route handlers |
| `src/components/` | Author workspace, feature editors, reader presentation |
| `src/lib/` | Authorization, domain validation, persistence, import/export |
| `prisma/` | Schema, committed migrations, optional destructive demo seed |
| `data/assets/` or configured directory | Persistent normalized image bytes |
| `tests/` | Unit, service, HTTP, browser, production authentication coverage |
| `docs/` | Implementation contracts and explicitly historical records |
| `wiki/` | Canonical source for published user/operator guides |

## Data and security boundaries

World ownership authorizes workspace APIs; installation administration is a
separate role. Campaign membership/audience policies and anonymous publication
use separate filtered projections. Never reuse an author payload for readers or
assume hiding a control authorizes its API. See [Security Model](Security-Model).

Prisma's client engine uses a serialized `better-sqlite3` adapter. Docker builds
it against SQLite 3.54.1; native source deployments must build the patch
explicitly. FTS5 powers database search paths; reader title/excerpt search is a
separate client-side feature. SQLite writes still serialize across processes.

Image bytes live outside the database; backups must capture both stores at one
recovery point. World JSON export/import is a distinct, bounded portability
feature and remaps identities. Browser draft recovery is neither a server
backup nor collaborative editing.

There is no separately deployed background-worker service. Durable asset cleanup
jobs are stored in SQLite and drained by application operations; do not assume
an external scheduler will finish arbitrary maintenance work.

**Source owner:** `wiki/Architecture-Overview.md`; implementation:
`package.json`, `prisma/schema.prisma`, `src/lib/db.ts`, authorization and asset-cleanup modules.
**Verified against:** `v0.4.3` (`94c694c`), source audit; see
[verification record](Wiki-Verification).
