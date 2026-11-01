# Wiki Maintenance

The reviewable source for the GitHub wiki lives in the repository's `wiki/`
directory. GitHub's wiki repository is a published copy, not the place where
substantial changes begin.

## Fix a typo or small error

1. Edit the matching file under `wiki/` in the main repository.
2. Open a pull request describing what changed and how it was checked.
3. After merge, a maintainer copies the merged page to the wiki repository and
   pushes it.

Maintainers may fix an urgent typo directly in the GitHub wiki, but must copy
the same correction back to `wiki/` immediately so the sources do not diverge.

## Add or substantially change a page

1. Open or reference an issue that defines the audience and scope.
2. Identify the authoritative code and repository documents.
3. Write task-oriented current guidance; do not present milestone notes,
   audits, or feature proposals as shipped behavior.
4. Test every command with isolated or disposable data. Never seed, migrate,
   test, or capture screenshots against a user's configured database.
5. Add the page to `_Sidebar.md` and check every internal link.
6. End the page with its source owner and the exact verified commit or release.
7. Open a normal repository pull request for review, then publish after merge.

## Publish the tracked pages

The first `Home` page must be created once through the GitHub wiki UI before
`https://github.com/emorgan33/worldforge.wiki.git` exists. After that bootstrap,
a maintainer can clone the wiki repository, copy the reviewed Markdown files
from `wiki/`, inspect the diff, commit, and push. Do not copy unrelated files or
force-push the wiki history.

## Release and feature checklist

For any pull request that changes user-visible behavior:

- Update its canonical implementation document under `docs/`.
- Update the matching `wiki/` page when user steps or operator behavior change.
- Advance the page's verified commit only after rechecking its commands and
  claims.
- Replace or remove stale screenshots; use only isolated demo data.
- Check that no secret, token, internal hostname, personal data, or private
  campaign content appears in text, logs, or images.
- Include the wiki page in the release publication checklist.

Repository `docs/` remains the home for implementation contracts, design
decisions, validation reports, release notes, and historical records. The wiki
is the task-oriented user and operator guide.

**Source owner:** `wiki/Wiki-Maintenance.md`.
**Verified against:** WorldForge commit `9050d94` (October 31, 2026).
