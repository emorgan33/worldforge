# Pathfinder theme reference: pf2e-style

Reference: [pf2e-style on Typst Universe](https://typst.app/universe/package/pf2e-style/), version 0.2.0. Reviewed its documentation, example PDF and published package source (`style/formatting.typ`, `lib.typ` and action SVGs). The web theme adapts the reference rather than embedding a Typst renderer.

The reference palette drives deep green primary headings (#002a16), brown secondary headings (#4e1b0e), teal tertiary headings (#015d4e), green table headers, alternating cream rows and brown read-aloud rules. Reader pages use a clean surface with sans-serif body type and a pale chapter banner. Statblocks use compact uppercase black headings, thin dividers and colored rarity/size/trait tags from existing structured fields. D&D cards retain their own edition presentation.

Action SVG artwork is adapted into a local React component, retaining readable action-cost labels. Source license: MIT-0, preserved in [licenses/pf2e-style-MIT-0.txt](licenses/pf2e-style-MIT-0.txt). Package fonts are referenced through local font stacks with fallbacks; Taroca and Roboto are not bundled or fetched. The screen layout remains responsive rather than forcing the reference's two-column A4 page flow. No example adventure text or game values were imported.

The existing Pathfinder Remaster preset receives the new appearance; custom background/accent settings remain saved. Use campaign rules style clears color overrides when the full preset palette is desired. No database migration is required.

Verification: focused lint, TypeScript/production build and 13 rules, publication and appearance tests passed. Isolated Chromium checks verified both edition themes saving/reloading, updated Pathfinder colors, transparent ruled read-aloud blocks, rarity/size trait tags, adapted action icons and mixed-edition statblocks, with no horizontal overflow at 390/768/1440 pixels. The managed local site was restarted; fixture records were removed.

## Statblock spacing correction

The initial flat statblock adaptation used `padding: 20px 0`, which left text flush against its white panel in the dark compendium. The shared Pathfinder card now uses 16–24px responsive horizontal padding, retaining 20px vertically. This corrects both standalone cards and article embeds. A Chromium regression check failed before the fix (0px inset), then passed at 1440px (24px inset) and 768/390px (16px inset), as well as in a public article embed. The production build and diff whitespace check passed; temporary fixture records were removed.


The subsequent [Pathfinder statblock formats milestone](pathfinder-statblock-formats.md) replaces the generic card layout with category-specific renderers, adds Hazard/Feat authoring and bundles the Roboto body font. Its mapping table and compatibility notes supersede the initial generic card description above.
