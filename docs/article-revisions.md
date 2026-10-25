# Article revision history and recovery

The article revision system provides server-side version tracking for selected article fields. Saves create snapshots of the fields listed below; they do not capture the article's full placement, hierarchy, or relationship state.

## Overview

Revision history allows GMs to:

- View saved-field history for any article with timestamps and user tracking
- Compare previous versions to see what changed
- Restore the saved fields from any retained revision (with an automatic snapshot of the current saved fields)
- Track who made changes and when
- Prevent silent overwrites through concurrent edit detection

## Database Schema

The `ArticleRevision` model stores the following core fields (the schema also includes optional cover and portrait URLs and their descriptions):

```prisma
model ArticleRevision {
  id                  String   @id @default(uuid())
  article             Article  @relation(...)
  
  // Snapshot of article state at time of save
  title               String
  slug                String
  excerpt             String?
  contentHtml         String?
  contentJson         String?
  metadata            String?
  tags                String?
  
  // Publication state at time of save
  publicationStatus   String
  visibility          String
  state               String
  
  userId              String
  user                User     @relation(...)
  savedAt             DateTime @default(now())
  
  // For concurrent edit detection
  articleVersionAtSave Int
}
```

The `Article` model includes a monotonically increasing `version` field. An update changes it with an atomic compare-and-increment; restoring an older revision also increments the current version rather than reusing the revision's historical version.

## API Endpoints

### GET `/api/articles/[id]/revisions`

Lists all revisions for an article, ordered by newest first.

**Response:**
```json
{
  "revisions": [
    {
      "id": "88ea2841-f53a-44f6-9ffc-6514b75ceba5",
      "savedAt": "2026-10-16T01:38:31.943Z",
      "title": "Thronehold, the Citadel of Glass",
      "slug": "thronehold-citadel-of-glass",
      "excerpt": "The grand floating capital suspended above the Shimmering Sea...",
      "publicationStatus": "DRAFT",
      "visibility": "PRIVATE",
      "state": "DRAFT",
      "articleVersionAtSave": 3,
      "user": {
        "name": "Master Lorekeeper",
        "email": "lorekeeper@worldforge.dev"
      }
    }
  ]
}
```

### POST `/api/articles/[id]/revisions`

Restore an article to a specific revision.

**Request body:**
```json
{
  "revisionId": "584264ce-43cc-4f8e-b3f0-ecc5753d67e6"
}
```

**Response:**
```json
{
  "success": true,
  "revision": { /* selected historical revision */ },
  "article": { /* resulting current article, including its incremented version */ }
}
```

**Behavior:**
- The current article version is automatically saved as a new revision before restoring
- This ensures no data is lost during the restore operation
- The restore, current-state snapshot, version increment and mention-index rebuild commit together or roll back together
- The article version always increments; restoring never rewinds it to a historical value
- A concurrent edit causes HTTP `409`, with no partial snapshot, restore or mention update

Revisions restore exactly the fields stored by `ArticleRevision`: title, slug, excerpt, HTML and structured content, metadata, tags, cover and portrait values/descriptions, and publication state/visibility. Fields that are not stored—such as template, category, canon state, order/pin, hierarchy and other relations—remain at their current values. `wordCount` is recomputed from restored HTML, and outbound mention edges are rebuilt from restored content. Older snapshots with null optional placement fields remain readable and restore those values as null.

### Cloning an article

`POST /api/articles/[id]/clone` creates the copied article, its first revision snapshot, a fresh `GM_ONLY` audience policy, and outbound mention edges in one database transaction. The clone starts as a private Draft at version 1 with `GM_DRAFT` canon state. It retains the source's article content and placement fields, but does not inherit the source's grants, revision history, session reveal, or supersession link. Mention edges are rebuilt from the copied content using the same world-scoped index as article saves.

## Concurrent Edit Detection

When an article is loaded, its current `version` number is included in the response. First-party saves include it as `expectedVersion`. If the article is edited in multiple tabs simultaneously:

1. The first save increments the version and proceeds normally
2. The second save includes the original version in its request
3. The server compares and updates the version atomically, so overlapping requests cannot both commit from the same version
4. A mismatch returns HTTP `409` with `{ code: "ARTICLE_CONFLICT", currentVersion }` and leaves the losing save's content, revision and mention index unchanged

The editor retains the losing local draft and offers **Save as new article**. It does not merge changes or replace the current saved version. Reopen the article to start from its latest content before reconciling edits.

For compatibility, versionless external `PATCH` callers remain supported during rollout and use the version read by that request as an atomic compare-and-increment guard. Such callers do not receive stale-editor protection across separate requests. First-party article edits require an expected version; old local drafts without one can only be saved as a new article.

## Security

All revision endpoints:
- Require authentication via `withAuthor` middleware
- Verify the user owns the article's world
- Return 401 for unauthenticated requests
- Return 403 for unauthorized access attempts

## Local Recovery vs Server Revisions

WorldForge maintains two separate recovery mechanisms:

| Feature | Local Recovery | Server Revisions |
|---------|---------------|------------------|
| Storage | Browser localStorage | Database |
| Scope | Single browser | All users |
| Persistence | Cleared on cache clear | Persistent |
| Access | Owner only | Owner only |
| Purpose | Undo/redo, local draft | History, restore, collaboration |

Local recovery drafts are distinct from server revisions and are not affected by the revision system.

## Implementation Notes

- Revisions are created on every `POST /api/articles` and `PATCH /api/articles/[id]`
- The revision snapshot captures the article state *before* the update
- The version field increments on each save
- Revision creation happens within the same database transaction as the save
- No manual migration is needed for new articles (version starts at 1)
- Existing articles get version 1 on their first save after migration

## Testing

The revision system is verified through:
- API integration tests for create, list, restore and optimistic concurrency (`tests/article-save-api.test.ts`)
- Restore and clone lifecycle checks (`tests/article-revisions-api.test.ts`) cover the field contract, legacy nullable placements, word count, backlinks, private clone policies, image validation, ownership and transaction rollback with injected database failures
- Browser checks for two-editor conflicts, safe-copy recovery and versioned autosaves (`tests/browser/article-saves.spec.ts`)
- Ownership and permission enforcement
- Version increment verification
