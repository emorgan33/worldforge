# Browser evidence and remaining release screenshots

This directory holds the browser evidence referenced by
[`release-verification.md`](../release-verification.md). The `automated-*`
captures below come from an isolated headless Chromium smoke check on
2026-10-23 at 100% zoom. They are development evidence, not human rights,
collection, contrast, screen-reader, or accessibility sign-off.

| Automated capture | Viewport | Scope |
| --- | --- | --- |
| [Desktop picker](automated-picker-desktop.png) | 1440 × 1000 | Eight installed cards, selected artwork, rights details and cover preview |
| [390px picker](automated-picker-390.png) | 390 × 844 | Mobile stock-art inspector with loaded artwork and credit |
| [320px picker](automated-picker-320.png) | 320 × 844 | Narrow mobile stock-art inspector with loaded artwork and credit |

Captures were refreshed after the corrections and show the explicit pending
human-review label. The UI uses Night watch styling; the preview is a world cover. These captures
do not exercise light/dark reader themes, 200% zoom, or a real mobile keyboard.
The following release captures and their human review remain open.

Capture these against a running dev server with the reviewed catalog installed
(and, for failure states, with it removed). Use a light and a dark reader theme
where a reader surface is involved.

| File | Shows |
| --- | --- |
| `picker-desktop-light.png` / `picker-desktop-dark.png` | World images and Stock art tabs, source filters, side inspector |
| `picker-mobile.png` | Mobile detail view and **Back to results** restoring query/filter/scroll |
| `placement-body.png` | Body placement preview |
| `placement-portrait.png` | Portrait placement preview |
| `placement-world-cover.png` / `placement-article-cover.png` | Banner placement previews with representative title text |
| `placement-background.png` | Decorative background behind page content |
| `category-icon-16-24-32.png` | Category art at 16/24/32px beside the name and disclosure control |
| `reader-credits.png` | Reader credit section and an adjacent credit at a narrow width |
| `failure-empty-library.png` | Empty upload library state |
| `failure-no-results.png` | Stock search with no results |
| `failure-unavailable-thumbnail.png` | Missing/unavailable thumbnail fallback |
| `failure-restricted.png` | Owner-only explanation for a restricted copy |

Record the viewport, zoom, theme, and browser with each capture in the
verification record's sign-off table.
