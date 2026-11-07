# Wiki Verification

This is the completion record for
[issue #15](https://github.com/emorgan33/worldforge/issues/15), not a claim that
every guide has a fresh end-to-end test. Each page names its canonical source
and its own verification baseline. Reviewed wiki content is published separately
from numbered application releases.

## Coverage and ownership

The sidebar covers start-here, feature, operator, and contributor tracks. All
requested topics have a page, including the shipped campaign-session desk.
Page names are stable URLs. `wiki/` owns user/operator prose; linked code and
`docs/` contracts own implementation behavior. Milestone records/proposals were
not copied as shipped guides. The Foundry guide explicitly separates its
implemented MVP from proposed sync/adapter work.

## v0.4.3 completion audit

Baseline: **v0.4.3**, source commit **94c694c**, November 6, 2026.

| Area | Evidence and limits |
| --- | --- |
| Page inventory/navigation | `pnpm docs:check` checks every tracked page, sidebar coverage, local page/heading links, and source/verification labels; checker regression tests cover broken targets and headings. External URLs/rendering are not proven by this check. |
| Fresh install | Downloaded v0.4.3 pull-only Compose, validated config, pulled the registry image, and started a new isolated project/volume with an ephemeral host port. Health passed. No production storage used. |
| First account/article | Ran documented setup CLI in that container, consumed its token, signed in, created a private empty world, created a Published/Public article, made the world public, and confirmed anonymous HTML contains the synthetic article. API-driven rehearsal, not a new browser click-through or separately provisioned clean machine. UI labels were source-reviewed. |
| Administration | Bootstrapped that exact account, signed in again, and opened `/admin`. Disabled-account recovery/deletion were source-reviewed, not rerun against this rehearsal. |
| Backup | Stopped the disposable service, used SQLite `.backup`, required integrity `ok`, included assets, checked the archive listing, then restarted. Full destructive restore was not repeated for this documentation task; its existing procedure/verification baseline remains on Backup and Restore. |
| Configuration | Audited environment reads in `src/`, scripts, Next config, Compose, and test tooling. Configuration lists deployable settings separately from framework/test inputs, including benchmark default 2101. |
| Features/access | Compared guides to current contracts and relevant source entry points. No new browser matrix for every feature. Existing release tests are supporting evidence, not rerun results for this task. |
| Screenshots | Retained two Aethelgard demo workspace images from `eb117d5`; no new captures or real accounts/tokens/private campaigns. Images remain illustrations, not a pixel-perfect v0.4.3 acceptance test. |

The isolated image reports embedded **SQLite 3.54.1**. Native contributor installs
must explicitly build the patch; normal install alone is not security parity.
Production stock-art approval and real-export Foundry compatibility remain
pending and are labelled accordingly. The published image still has documented
unresolved package advisories; this wiki does not certify it vulnerability-free.

## Maintenance and publication

Follow [Wiki Maintenance](Wiki-Maintenance). After merging a reviewed update,
copy tracked pages to the wiki clone, inspect the diff, commit with the source
revision, and push without force. Compare published Markdown bytes with tracked
files, and check GitHub Home/sidebar plus representative feature pages. Record
the source and wiki publication commits in the issue/PR handoff rather than
editing this page recursively to reference its own future commit.

**Source owner:** `wiki/Wiki-Verification.md`; evidence: issue #15 completion
checks, tracked guides, source contracts, isolated published-image rehearsal.
**Verified against:** `v0.4.3` (`94c694c`); this audit distinguishes runtime
rehearsals from source-only review and inherited evidence.
