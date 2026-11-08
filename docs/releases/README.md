# Releases and Docker images

Files in this directory record individual releases. Historical release notes
do not imply that matching Docker Hub images were published. Check the
[GitHub release](https://github.com/emorgan33/worldforge/releases) and its
**Release Docker image** workflow before choosing an image version.

## Image naming

| Reference | Meaning |
| --- | --- |
| `emorgan33/worldforge:X.Y.Z` | GitHub release tag `vX.Y.Z` |
| `emorgan33/worldforge:X.Y.Z-rc.1` | Example prerelease tag `vX.Y.Z-rc.1`; does not advance `latest` |
| `emorgan33/worldforge:sha-<full-commit>` | Full source commit reference |
| `emorgan33/worldforge:latest` | GitHub's current stable release, excluding prerelease-suffixed versions |
| `emorgan33/worldforge@sha256:...` | Exact registry digest recorded after publication |

`X.Y.Z`, `<full-commit>`, and `sha256:...` are placeholders, not published
versions. New releases from the multi-platform workflow publish `linux/amd64`
and `linux/arm64` under the same version and SHA tags; historical releases may
be AMD64-only. Docker selects the host platform, and the multi-platform index
digest is the portable pin across architectures. Version tags must never be
moved or reused for a different commit; use a new patch release.

## Maintainer release checklist

1. Finish CI and review for the release commit. Include
   `docs/releases/vX.Y.Z.md` with user-visible changes, migrations, configuration
   changes, any backfills, limitations, and upgrade/rollback instructions.
   Do not rewrite old release notes to attribute new packaging to old code.
2. Ensure Docker Hub repository `emorgan33/worldforge` is public and GitHub
   secrets `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` grant write access. Keep
   credentials outside the repository and release notes.
3. Create tag `vX.Y.Z` at the reviewed commit. Publish its GitHub release using
   the matching Markdown notes. Mark prereleases appropriately. A draft or
   tag push alone does not publish an image.
4. Watch `.github/workflows/docker-publish.yml` complete. It builds and
   verifies both platforms natively, scans vulnerabilities and gates fixable
   HIGH/CRITICAL findings, smoke-tests fresh isolated storage, publishes the
   verified child images, and creates the version and full-SHA tags only when
   both resolve to the same validated multi-platform index. Existing
   same-content tags are no-ops; conflicting tags fail closed. `latest` and
   release-note updates are separate finalization steps.
5. After both published children pass re-verification, the workflow updates the
   release notes with an idempotent image section and, only when this is
   GitHub's current stable release with a stable version tag, advances `latest`
   to the same validated index. Verify the version/index digest in the release
   notes and perform a clean-machine `docker pull emorgan33/worldforge:X.Y.Z`,
   followed by the pull-only Compose install in the
   [deployment guide](../deployment-configuration.md). Require a healthy
   container and `/login` response before declaring delivery complete.
6. Publish the reviewed tracked wiki pages after merge using
   [Wiki Maintenance](../../wiki/Wiki-Maintenance.md). Keep the README, operator
   instructions, and any advertised architecture support synchronized.

Version and full-SHA tags are references to one multi-platform index; neither
may point at a single architecture. A partially completed publication is
recovered by rerunning the unchanged release: matching tags are left untouched,
only missing tags are created, and any conflicting reference fails closed.
Staging images and indexes are run-scoped and are not operator release tags.

Published children are re-pulled and re-verified on both platforms before
`latest` or release notes are updated. If a post-publication step fails, the
version and SHA tags may already exist; rerun the unchanged release to
revalidate them and finish finalization. Release notes use a marked image block
that is replaced in place, and `latest` is rechecked against GitHub's current
stable release immediately before advancing.

Promotion of an existing prerelease and retries reuse an already-published
version only after the release preflight resolves the complete multi-platform
index, verifies every fetched index, child manifest, and config blob against its
claimed SHA-256 digest, and confirms one unambiguous `linux/amd64` and
`linux/arm64` child, each with the release commit's revision label. Only a
definite version-not-found permits a new build; single-platform historical
versions, mismatched revisions, malformed registries, and
authentication/rate-limit/server errors fail closed. A failure can leave the
version pushed but notes or `latest` not updated. Investigate the failed step
and rerun the unchanged release; verify the final digest. Do not retag a
different commit to repair a failed release.

Verify each real registry publication/pull; local builds and packaging CI are
not substitutes for that release evidence. The `0.4.4` publication was verified
as **AMD64-only**. The `0.4.5` notes are prepared for the first multi-platform
release; check the GitHub release and its workflow before relying on an image.
