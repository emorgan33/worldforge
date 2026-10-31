# World themes and backgrounds

World settings now offer D&D 5e 2014, Pathfinder 2e Remaster, Midnight, Parchment and Deep Forest themes, a page background color/image, an accent color and Narrow/Standard/Wide reading widths. Appearance controls live under Edit world & styling. Background images use the existing library picker or an HTTP/HTTPS URL. The author homepage preview updates immediately; Save world persists the settings. Cancel discards appearance changes. Reset appearance to defaults stages the default settings until saved.

Public world and article pages use the same scoped presentation wrapper and opaque reading surface. Reading width determines the maximum surface width (680, 900 or 1120 pixels); article facts move below the body when the reading surface is narrow. Themes also cover callouts, tables, links, quick facts and embedded statblocks. The author workspace controls retain their existing styling.

Homepage cover, global article cover, article-specific cover and page background remain separate. An article-specific cover overrides the global article cover. Clearing it restores the global fallback. The background appears behind the reading surface rather than replacing a cover.

Each preset has fixed readable foreground/surface colors. Custom accent text is adjusted toward black or white as needed to meet a 4.5:1 contrast ratio on the reading surface. Background colors/images do not change that opaque surface.

Advanced custom CSS is available in world styling. It is parsed as CSS, limited to 20,000 characters, and selectors are scoped to `.wf-reader`, including selectors nested in `@media`, `@supports`, `@container` and `@starting-style`. Nested reader selectors are checked through every rule and at-rule; functional pseudos containing `&` and implicit or explicit sibling selectors that can escape the reader are rejected. Reader scope is retained when any selector-list branch can still represent the reader element. Other at-rules (including `@import`, `@font-face`, `@layer` and keyframes) are rejected because their effects cannot be confined to the reader wrapper. Malformed CSS and declarations for fixed/sticky positioning, positive `z-index`, or URL-valued custom properties are rejected. Invalid legacy CSS fails closed and is not emitted. This keeps rules from selecting author controls or sibling page content.

## Storage and access

The additive schema field is `World.appearance String?`, containing validated JSON. Worlds without settings, or with malformed settings, use the default Midnight/Wide appearance. Updates from older callers that omit appearance retain saved settings. API validation permits only supported presets/widths, six-digit hex colors and accepted image references; local images must belong to the edited world.

A library image used as a public world's background becomes publicly accessible, including when the world has no public articles. Removing that reference or making the world private revokes access on the next request unless another public cover/article still references the image. Private-world backgrounds remain owner-only. Images in other worlds cannot be selected through the API and are filtered from reader appearance data. Existing image routes retain private/no-store caching.

For another installation, back up SQLite and asset storage together using the [backup and restore guide](backup-restore.md), then apply committed migrations with `pnpm db:deploy` and regenerate the client with `pnpm db:generate` before building/restarting. No reseeding or appearance-specific content backfill is needed. The original workspace backup path is historical, not a portable recovery location.

## Historical verification record

The CSS scoping regression checks cover comma-separated and quoted-comma selectors, comments around sibling combinators, unchanged quoted attribute values, compound reader-root scoping and escape detection, nested sibling styling on reader descendants, native nested CSS, nested media/supports rules, implicit and explicit sibling escapes including ancestor-qualified nesting, mixed selector-list scope propagation, functional alternatives at descendant depth, keyframe and unknown at-rule rejection, and malformed or obfuscated unsafe declarations. Focused validation: `node --import tsx --test tests/world-appearance.test.tsx`.

All 44 automated tests passed against the production server, including appearance validation, legacy defaults, preset/custom-accent contrast, world-scoped image references, persistence during ordinary world edits, isolation between worlds, reset and public-background grant/revocation. Focused ESLint and the production build (including TypeScript) passed.

Chromium checks covered all three themes, unsaved live preview, library upload/selection inside world settings, save/reload, public world/article presentation, narrow/wide reading layouts, reader widths of 390/768/1440 pixels, cancel/reset, background grant revocation and cover precedence/fallback. Temporary accounts, records and uploaded files were removed afterward.


## Edition-specific styles

D&D 5e 2014 now follows [the Homebrewery PHB reference](homebrewery-style-reference.md), including local book fonts, textured parchment, maroon headings, framed read-aloud text, green notes and triangular monster-block dividers. Pathfinder 2e Remaster now follows [the pf2e-style reference](pf2e-style-reference.md): clean pages, green/brown/teal headings, green tables, ruled read-aloud text and compact black statblock headers. The D&D theme bundles the reference fonts locally; Pathfinder uses its documented font fallback stacks. Reference sources: [D&D 2014 Basic Rules](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/monsters) and [Paizo Remaster Core Preview](https://downloads.paizo.com/RemasterCorePreview.pdf). No remote artwork/font dependency or rules-text import was added.

Select either preset under World theme, or click **Use campaign rules style** to match the Campaign rules currently selected in the form. The shortcut resets custom accent/background colors to the preset and retains the background image and reading width. Save world applies it. Changing rules alone does not overwrite a deliberately chosen theme. Existing saved themes remain unchanged.

Statblocks follow their own stored rules system in every context, including the compendium, GM screen, editor embeds and public readers. D&D cards use parchment/red headings; Pathfinder cards use compact black headings, thin rules and colored trait tags. A mixed-system article keeps each card's own appearance. No rules values or article metadata are changed by styling.

Edition-style verification: all 44 regression tests, focused lint and the production build passed. Chromium verified both presets saving/reloading, the shortcut following an unsaved Campaign rules selection, public article styling, mixed-edition statblocks and no horizontal overflow at 390/768/1440 pixels. Fixture records were removed after checks.

## Statblock icons

Statblock headers include local vector emblems: a dragon for D&D 2014 and a wayfinder-style compass for Pathfinder Remaster. These are custom emblems, not downloaded publisher logo files. Header icons are decorative beside the existing edition text.

Action badges retain their readable text and add edition-specific icons. Pathfinder uses filled diamonds for one/two/three actions, an outlined diamond for a free action, a curved arrow for a reaction and an eye for passive abilities. D&D uses sword, lightning, return-arrow, crown and eye icons for action, bonus action, reaction, legendary action and passive abilities. Pathfinder symbol categories follow the [Playing the Game reference](https://2e.aonprd.com/Rules.aspx?ID=2263). Unknown action costs remain text without a misleading icon; legacy string actions are preserved. Icons use local inline SVG and inherit card colors without fonts, uploads or external requests. Pathfinder action artwork now comes from the [pf2e-style adaptation](pf2e-style-reference.md).

Verification: 11 focused rules/public-rendering tests passed, including all supported action icon mappings, unknown-cost fallback, legacy action preservation and custom-system isolation. Focused ESLint and the production build passed. Chromium verified both emblems/action icons in mixed-edition reader content and layouts at 390/768/1440 pixels. The managed local server was restarted with the new build; temporary test records were removed.
