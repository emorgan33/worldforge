# Placement coverage sheet

Status: **candidates proposed, pending human sign-off.** Placement
recommendations for the eight staged entries are recorded in
[`candidates/manifest.json`](candidates/README.md) and were judged from the
review-only crop sheet (`360×600` narrow, `960×432` wide). No entry is admitted
and nothing is shipped. All rows below are machine-proposed and unconfirmed.

Review using the actual renderer geometry, not source thumbnails:

- Body art: contained, responsive width.
- Portrait: the reader/author portrait shape and centered crop.
- World and article covers: the renderer's banner frame with representative
  title text and overlays.
- Background: decorative CSS cover with the surrounding page content.
- Category icon: 16, 24, and 32px beside the category name and disclosure
  control, against supported themes.

## Required subject coverage

| Subject | Body | Portrait | World cover | Article cover | Background | Category icon |
| --- | --- | --- | --- | --- | --- | --- |
| Portrait | praying-woman/1 | praying-woman/1, man-in-shadow/1 | n/a | n/a | n/a | n/a |
| Location/landscape | forest-brook/1 | n/a | ship-by-moonlight/1 | ship-by-moonlight/1 | forest-brook/1, ship-by-moonlight/1 | n/a |
| Object | vase-of-flowers/1, etruscan-vase/1, garden-basket/1 | n/a | n/a | n/a | garden-basket/1 | none recommended (etruscan-vase reads at 32px only) |
| Category artwork | heraldic-crests/1 | n/a | n/a | n/a | n/a | none recommended (linework indistinct <32px) |

Mark a cell with the approved entry ID/version, or `n/a` plus a reason. Record
failed crops and rejection reasons; "not recommended for this crop" is a visual
decision, distinct from any rights restriction.

## Per-entry review

| Entry ID | Version | Purpose | Recommended | Narrow crop | Wide crop | Category sizes | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ship-by-moonlight | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Moon and ship contained in both. |
| ship-by-moonlight | 1 | world-cover | yes | 360×600 pass | 960×432 pass | n/a | Dark left sea holds banner title text. |
| ship-by-moonlight | 1 | article-cover | yes | 360×600 pass | 960×432 pass | n/a | Subject survives the banner frame. |
| ship-by-moonlight | 1 | background | yes | 360×600 pass | 960×432 pass | n/a | Evenly dark behind reader text. |
| forest-brook | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Brook and banks centered. |
| forest-brook | 1 | background | yes | 360×600 pass | 960×432 pass | n/a | Muted, low contrast. |
| praying-woman | 1 | portrait | yes | 360×600 pass | 960×432 pass | n/a | Face and clasped hands inside portrait frame. |
| praying-woman | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Figure and hands legible contained. |
| man-in-shadow | 1 | portrait | yes | 360×600 pass | 960×432 pass | n/a | Hat, face, hand read at both widths. |
| man-in-shadow | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Chiaroscuro figure survives contained fit. |
| vase-of-flowers | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Bouquet whole and centered. |
| etruscan-vase | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Vase and motifs survive contained fit. |
| etruscan-vase | 1 | category-icon | no | 16×16 fail | n/a | 16 no, 24 no, 32 partial | Patterned field collapses below 32px. |
| garden-basket | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Basket and flowers readable. |
| garden-basket | 1 | background | yes | 360×600 pass | 960×432 pass | n/a | Soft garden tones behind reading surface. |
| heraldic-crests | 1 | body | yes | 360×600 pass | 960×432 pass | n/a | Ink linework crisp when contained. |
| heraldic-crests | 1 | category-icon | no | 16×16 fail | n/a | 16 no, 24 no, 32 partial | Crests and lettering indistinct below 32px. |

## Release evidence

| Date | Reviewer | Manifest revision | Themes checked | Result |
| --- | --- | --- | --- | --- |
| 2026-10-23 | PENDING HUMAN REVIEW | 2026-10-23.candidates | none yet | 8 staged/held; 0 admitted |
