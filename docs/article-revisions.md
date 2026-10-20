# Article revision history and recovery

The article revision system provides server-side version tracking for all article content in WorldForge. Every save operation creates a revision snapshot that preserves the full state of the article at that point in time.

## Overview

Revision history allows GMs to:

- View full content history for any article with timestamps and user tracking
- Compare previous versions to see what changed
- Restore to any prior state safely (with automatic backup of current version)
- Track who made changes and when
- Prevent silent overwrites through concurrent edit detection

## Database Schema

The `ArticleRevision` model stores:

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

The `Article` model includes a `version` field that increments on each save, enabling concurrent edit detection.

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
  "revision": { /* full revision data */ }
}
```

**Behavior:**
- The current article version is automatically saved as a new revision before restoring
- This ensures no data is lost during the restore operation
- The restored revision becomes the current article state

## Concurrent Edit Detection

When an article is loaded, its current `version` number is included in the response. If the article is edited in multiple tabs simultaneously:

1. The first save increments the version and proceeds normally
2. The second save includes the original version in its request
3. The server compares versions and can detect if another edit occurred
4. If versions don't match, a conflict is detected

The `ArticleEditorForm` component handles this by:
- Including the current version in save requests
- Detecting version mismatches on save failure
- Prompting the user to review and resolve conflicts

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
- API integration tests for create, list, and restore operations
- Concurrent edit detection scenarios
- Ownership and permission enforcement
- Version increment verification
