# Milestone 5: World Management Enhancements

## Status: Implemented

The Manage worlds dialog, opened from the world switcher, supports exporting a JSON backup, importing a backup, making a private settings-only copy, and archiving a world. A copied world contains its rules system and basic settings, with a new identity and no campaign content or shared asset references. A full campaign copy uses export and import.

Version 2 backups include world metadata, categories, article hierarchy, quick facts, revision history, image files (including archived images), maps, layers, pins and groups, statblocks, secrets, timelines, variables, sessions, links, audience policies, memberships, grants and audit history. Import remaps world and resource IDs in rich text, revisions, and the article mention graph; it restores worlds as private and articles as drafts, and warns when a source resource or account is unavailable. Local memberships and grants are restored inactive; foreign account IDs are skipped, foreign audit actors are deidentified, and revision authors are assigned to the importing account. Import validates and normalizes image data. Version 1 backup import/export remains supported.

World archive and restoration are covered in [milestone-6.md](milestone-6.md). Publishing remains available in the existing world settings visibility control. Starter content templates and bulk operations remain optional future features and were outside the original creation and switching scope.

Validation: type checking, production build, isolated service round-trip tests and authenticated API tests. Browser acceptance is recorded in [world-implementation-audit.md](world-implementation-audit.md) after final verification.
