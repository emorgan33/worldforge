-- Apply ONCE to an existing installation, after schema push and a consistent backup.
-- Deliberately close public access until the owner opts in through the new controls.
BEGIN IMMEDIATE;
UPDATE Article SET publicationStatus = CASE
  WHEN state IN ('PUBLISHED', 'PRIVATE') THEN 'PUBLISHED'
  WHEN state = 'WIP' THEN 'WIP'
  ELSE 'DRAFT'
END, visibility = 'PRIVATE';
UPDATE World SET isPublic = 0;
COMMIT;
PRAGMA journal_mode = WAL;
