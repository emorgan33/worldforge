# Repository documentation

This directory records WorldForge implementation contracts, design decisions,
feature status, release notes, validation evidence, and historical plans. These
files are written for maintainers and contributors and may include shipped
behavior alongside explicitly labeled proposals or historical context.

Task-oriented guidance for users and operators belongs in the
[GitHub wiki](https://github.com/emorgan33/worldforge/wiki). The reviewable,
canonical source for published wiki pages is the repository's [`wiki/`](../wiki/)
directory. When behavior changes, update the relevant implementation document
here and any affected wiki page in the same pull request.

The wiki [sidebar](../wiki/_Sidebar.md) indexes all user/operator/contributor
topics. Its [verification record](../wiki/Wiki-Verification.md) separates runtime
rehearsals from source review and inherited evidence. Run `pnpm docs:check` for
page completeness, sidebar coverage, local links, and verification labels; this
does not replace checking changed claims against code and isolated storage.

Do not migrate milestone notes, audits, validation reports, or feature-request
contracts into the wiki as if they describe current product behavior.

## Deployment and releases

- [Deployment configuration](deployment-configuration.md) — local builds,
  versioned Docker Hub images, pull-only Compose, and runtime settings.
- [Release records and publishing](releases/README.md) — image tags/digests,
  maintainer release checklist, and publication verification.
- [Backup and restore](backup-restore.md) — matched database-and-assets
  recovery points required before upgrades.
- [Container security](container-security.md) — image scanning, the release
  gate, remaining-risk reporting and local reproduction.
