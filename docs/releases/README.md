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
versions. Initial architecture support is **linux/amd64**. Version tags must
never be moved or reused for a different commit; use a new patch release.

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
4. Watch `.github/workflows/docker-publish.yml` complete. It builds the exact
   tag, scans vulnerabilities and gates fixable HIGH/CRITICAL findings,
   smoke-tests fresh isolated storage, publishes version/commit tags,
   pulls and smoke-tests the published digest, and appends image details to
   GitHub release notes. Stable publications/promotions can advance `latest`
   only when they are GitHub's current stable release with a stable version tag.
5. Verify the version/digest in the release notes and perform a clean-machine
   `docker pull emorgan33/worldforge:X.Y.Z`, followed by the pull-only Compose
   install in the [deployment guide](../deployment-configuration.md). Require
   a healthy container and `/login` response before declaring delivery complete.
6. Publish the reviewed tracked wiki pages after merge using
   [Wiki Maintenance](../../wiki/Wiki-Maintenance.md). Keep the README, operator
   instructions, and any advertised architecture support synchronized.

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
not substitutes for that release evidence. The `0.4.3` publication was verified;
the `0.4.4` notes are prepared for publication, so check the GitHub release and
its workflow before relying on an image.
