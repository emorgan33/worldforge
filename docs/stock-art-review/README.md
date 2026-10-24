# Stock-art curation and review

Status: human review open. Eight painterly/linework candidates are installed in
`resources/stock-art/manifest.json` as development catalog `2026-10-23.live-review-state`.
The catalog and bundled files validate, but **no artwork, rights claim, or visual
review has been approved yet**; every entry still records `PENDING HUMAN REVIEW`.
They are selectable only in development until explicitly approved. Pending
selection stores `PENDING_REVIEW` and is labelled **Pending human review — not
verified**; production selection excludes it.
Do not distribute this catalog as approved until the review steps below are
recorded and signed off. The
[implementation review](implementation-review-2026-10-23.md) is retained as a
historical record; its findings are addressed in the
[implementation corrections](fixes-2026-10-23.md).

This directory holds the human review evidence for the bundled catalog. Runtime
placement recommendations belong in `resources/stock-art/manifest.json`; the
material here explains how those recommendations were reached.

## Release gates

1. **Rights review** — record the exact item, creator/source chain, license or
   public-domain basis, dated evidence, reviewer, and all distribution uses
   (application bundling, standalone redistribution, world export,
   modification, public display). Unknown is not approval. Exclude anything that
   cannot be redistributed in a world export. Only after human approval, set
   `rights.reviewStatus` to `approved`, record reviewer/date, and bump the catalog
   revision. Placeholder reviewers or missing status never establish approval.
2. **Collection review** — approve the collection brief, then review a contact
   sheet as a family. Keep incompatible styles in separately named collections.
3. **Placement review** — complete the subject-by-placement coverage sheet.
   Review full artwork and the actual placement geometry at narrow and wide
   widths, category artwork at 16/24/32px, and compositions against supported
   light/dark reader themes.
4. **Digest and manifest check** — run `pnpm stock-art:validate` and record the
   manifest revision with the review.
5. **Interface review** — verify browse → inspect → use → replace → cancel →
   clear, failure states, focus restoration, 320/390px widths, 200% zoom, an
   open mobile keyboard, 44px touch targets, and the documented contrast targets.

Passing the validator is not ownership, license, or visual approval.

## Files

- [`painterly-fantasy-brief.md`](painterly-fantasy-brief.md) — primary collection
  direction and admission criteria.
- [`contact-sheet.md`](contact-sheet.md) — collection-level review record.
- [`coverage-sheet.md`](coverage-sheet.md) — subject-by-placement coverage and
  rejection reasons.
- [`candidates/`](candidates/README.md) — eight staged Met Open Access
  candidates with normalized bytes, evidence captures, review-only crop cases,
  and a staging manifest. The eight candidates are also installed in the
  development runtime catalog; neither copy has human approval.
- [`release-verification.md`](release-verification.md) — acceptance-criterion map
  with the automated checks (validator, isolated suite, build, packaging) and the
  open human/browser gates.
- [`screenshots/`](screenshots/README.md) — the picker, placement, and
  reader-theme captures to be added during release verification.

## Status log

| Date | Reviewer | Change |
| --- | --- | --- |
| 2026-10-23 | implementation | Manifest contract, validator, and review templates added. No entries approved. |
| 2026-10-23 | implementation | Eight Met Open Access candidates downloaded, normalized, and validated (`2026-10-23.candidates`). Staged for human rights/design sign-off; live catalog still empty. |
| 2026-10-23 | implementation | Slices 1–6 implemented and the isolated suite, build, and container packaging pass. Rights/collection/placement/browser review and screenshots remain open; recorded in [`release-verification.md`](release-verification.md). |
| 2026-10-23 | automated implementation review | Confirmed the eight-entry development catalog; fixed repo-wide lint configuration and removed scratch copies. Captured isolated browser smoke evidence and recorded unresolved implementation findings. Human sign-offs remain open. |
| 2026-10-23 | implementation corrections | Addressed import attribution validation, reader descriptions/credits, legacy export guards/options, and pending-review labels/gating. Full suite passes 220 tests; human sign-offs remain open. |
