# D&D theme reference: Homebrewery

Reference: [The Homebrewery](https://homebrewery.naturalcrit.com/) and its [V3 5e PHB stylesheet](https://github.com/naturalcrit/homebrewery/blob/master/themes/V3/5ePHB/style.less), reviewed October 15, 2026. This adapts the PHB-style presentation for the D&D 2014 profile.

The theme uses the reference palette: parchment #eee5ce, maroon headings #58180d, gold underlines #c0ad6a, green tables/notes #e0e5c1, and monster parchment #f2e5b5 with red triangle dividers #9c2b1b. Read-aloud blocks use the descriptive frame. Monster fields use maroon text; action descriptions retain dark text.

Local assets in `public/themes/homebrewery/` include the parchment textures and note/descriptive/monster borders from the site's public assets. Fonts from the repository's `themes/fonts/5e/` directory provide Bookinsanity body text, Mr Eaves small-cap headings and Scaly Sans notes/tables/statblocks. All eight WOFF2 variants are served locally with font-display swap and fallbacks. No page rendering depends on Homebrewery's availability. Its MIT license is preserved in [licenses/homebrewery.txt](licenses/homebrewery.txt).

The browser layout stays responsive rather than forcing print columns or fixed page heights. Existing custom background/accent settings remain saved; Use campaign rules style clears those color overrides. Pathfinder cards keep their own presentation inside D&D pages and vice versa. No adventure text, rules values, database migrations or publishing settings were changed.

Verification: focused lint, production build/TypeScript and 13 rules/publication/appearance tests passed. Chromium verified local font loading, heading colors, table stripes, read-aloud borders, both themes saving/reloading, mixed-edition typography and no horizontal overflow at 390/768/1440 pixels. The managed server was restarted with the final build. Temporary fixture records were removed.
