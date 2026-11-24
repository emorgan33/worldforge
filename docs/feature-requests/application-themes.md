# Implementation plan: selectable application themes

Status: P1–P4 done (#43 token layer, #44 switcher, #45 true black, P4
Daylight audit on `feat/theme-daylight-audit`); P5–P8 not started. Palette
values, in-product names, and the migration order below are open for review.

Tracks [GitHub issue #38](https://github.com/emorgan33/worldforge/issues/38).

## Outcome and scope

An author, administrator, player, or invited guest can choose how the
application chrome looks, independently of the campaign they are viewing:

| Theme | Kind | Source of palette |
| --- | --- | --- |
| Night watch | dark, default | Current `--aw-*` workspace tokens |
| True black | dark, OLED | New values; same amber/indigo accents |
| Daylight | neutral light | New values |
| Pathfinder | colored light | `WORLD_THEMES.pf2remaster` |
| D&D | colored light | `WORLD_THEMES.dnd2014` |

"Chrome" means the author workspace shell, admin pages, player portal,
sign-in/setup/invite pages, dialogs, menus, editors, tables, and form controls.

The current theme stays the default and must render identically after the
change. No existing account sees a different appearance until it chooses one.

### What is explicitly not in scope

- Changing how a campaign's articles look. World presentation is already a
  per-world, GM-controlled setting (`WORLD_THEMES`, accent color, background
  image, reading width, scoped custom CSS). This feature does not add to, replace,
  or override it.
- Per-world chrome themes, user-supplied themes, user CSS, image/pattern themes,
  animated themes, dark variants of the Pathfinder or D&D palettes, and
  high-contrast themes beyond the accessibility floor below.
- Official game branding. The two rule-system themes reuse color values only: no
  logos, wordmarks, trade dress, fonts, or artwork from either publisher.

## Theme definitions

Values are starting points for review, not final. The implementation should keep
one palette source shared by chrome and reader presentation so the two cannot
drift; the reader keeps its existing per-world selection.

### Night watch (default, unchanged)

`--aw-canvas #111318`, `--aw-sidebar #181b22`, `--aw-panel #1c2028`,
`--aw-control #242934`, `--aw-border #343a46`, `--aw-text #f1f2f5`,
`--aw-muted #b1b7c2`, accent `#fbbf24`, secondary accent `#818cf8`,
border-strong `#5a6272`.

Note: the workspace tokens and the raw utilities used elsewhere already disagree
(zinc-950 `#09090b`, zinc-900 `#18181b`). The token layer normalizes this; the
parity step must record every intentional difference rather than silently
changing pixels.

### True black

Canvas `#000000`, surface `#0a0a0b`, raised `#131316`, control `#1b1b1f`,
border `#2a2a2f`, border-strong `#63636b`, text `#f2f2f2`, muted `#a1a1aa`,
accent `#fbbf24`, secondary accent `#818cf8`. Text stays slightly below pure
white to limit halation on OLED panels; surfaces above pure black carry
elevation.

### Daylight

Canvas `#f6f5f3`, surface `#ffffff`, raised `#faf9f7`, control `#ecebe8`,
border `#d6d3ce`, border-strong `#8a8781`, text `#1c1b19`, muted `#5c5952`,
accent `#8a4b12`, secondary accent `#4338ca`, focus `#4338ca`.

### Pathfinder and D&D

Reuse the existing reader palettes so a campaign using that world theme and a
reader using that chrome theme see consistent paper, ink, and accent colors:

- Pathfinder: background `#ede3c7`, surface `#ffffff`, text `#181818`,
  muted `#515c63`, border `#644117`, accent `#002a16`.
- D&D: background `#30231e`, surface `#eee5ce`, text `#181818`,
  muted `#635648`, border `#c0ad6a`, border-strong `#8a6a2f`, accent `#58180d`.

Chrome needs derived tints for hover, disabled, raised, and focus states that the
reader palettes do not define today. Those derivations belong in the shared
palette module with contrast assertions, not hand-picked per component. The D&D
reader border `#c0ad6a` is 1.8:1 on its paper, so it is decorative only; control
outlines use the derived strong value. Both game themes place a light surface on
a slightly darker canvas (Pathfinder white on `#ede3c7` is 1.3:1), so elevation
must come from borders and shadows rather than surface contrast.

## Existing implementation and implications

| Area | Current code | Consequence for this feature |
| --- | --- | --- |
| Root styling | `src/app/globals.css` `:root` background/foreground, `@theme` blocks | P1 added the application token layer and made it runtime-overridable; there is still no theme selector and no `color-scheme` declaration. |
| Workspace tokens | `--aw-*` variables and `.author-workspace` in `globals.css`, applied in `src/components/AuthorWorkspace.tsx` | Proves the token approach works; should become the default theme's values. |
| Reader presentation | `.world-presentation` CSS variables, `src/lib/world-appearance.ts` `WORLD_THEMES`, `parseAppearance`; `globals.css` also overrides utility class names such as `[class*="bg-app-"]` | Separate axis. Chrome must not repaint presentation surfaces; presentation must not leak into chrome. Renaming utilities must update these selectors in the same change. |
| Hardcoded colors | P1 replaced 2,179 palette-utility occurrences across 62 files with tokens: neutral roles in `globals.css` (`--color-app-canvas`, `-surface`, `-raised`, `-border*`, `-text*`, `-muted`, `-subtle`, `-on-accent`) and accent scales (`primary` amber, `secondary` indigo, `highlight` violet, `danger` red, `success` emerald, `info` sky). `text-white`, `bg-black/40`, and dark gradients remain for P7. | The default theme renders identically because each token aliases the Tailwind palette entry it replaced. A second theme can now redefine the variables without touching components. |
| Character sheets | `src/components/article/CharacterSheet.module.css` (paper palette, `color-scheme: light`) | Already light and self-contained; verify it inside each chrome theme and leave its paper metaphor intact. |
| Maps | `src/components/map/InteractiveMap.tsx`, `paintStroke` fallback color, toolbar and layer panels | Stored annotation colors are author data and must not change with the viewer's theme. Chrome (toolbar, layer panel, surround) needs theme-aware values; the map backdrop and the `#eab308` fallback for stored elements stay fixed. A default for newly created drawings is persisted into the element at creation, not read from the theme at paint time. |
| Editors | TipTap chrome, `block-editor` styles in `globals.css` | Editor affordances (hover outlines, placeholders, code blocks, blockquotes) are hardcoded for dark surfaces. |
| Account model | `User` in `prisma/schema.prisma` has no preferences column | Durable preference needs a migration; cookie-only persistence would lose the choice across devices. |
| Public pages | `/c/...`, `/w/...`, `/login`, `/invite`, `/setup` | Anonymous readers need a theme too, so the preference cannot require an account. |

## Architecture decisions

### 1. One palette source, two axes

Extract palettes into a shared module used by both the chrome themes and
`WORLD_THEMES`, so `pf2remaster` and the Pathfinder chrome theme cannot diverge.
Chrome resolves its palette from `data-theme` on the root element; presentation
keeps resolving from the world's stored appearance. Precedence:

1. Presentation surfaces (`.world-presentation` and its children) always follow
   the world.
2. Everything else follows the viewer's chrome theme.
3. A world background image or accent never changes chrome colors, and chrome
   never changes paper, ink, or reading width.

### 2. Semantic tokens, not palette names

Tokens are defined in `src/app/globals.css` and components use them through
Tailwind utilities (`bg-app-surface`, `text-app-muted`, `border-app-border`,
`bg-primary-500`). No component names zinc, amber, indigo, violet, red,
emerald, or sky directly.

Neutral roles: `--color-app-canvas`, `-surface`, `-raised`, `-control-strong`,
`-tint`, `-border`, `-border-strong`, `-border-emphasis`,
`-border-emphasis-strong`, `-border-contrast`, `-text-bright`, `-text-strong`,
`-text`, `-text-dim`, `-muted`, `-subtle`, `-subtle-dim`, `-faint`,
`-on-accent`.

Accent scales keep their numbers so a palette can be swapped without
re-deciding shades: `--color-primary-*` (amber), `--color-secondary-*`
(indigo), `--color-highlight-*` (violet), `--color-danger-*` (red),
`--color-success-*` (emerald), `--color-info-*` (sky). Three
`success-deep/edge/pale` aliases preserve the few pre-existing green values that
would otherwise shift when folded into the emerald scale.

The block must use `@theme` (not `@theme inline`). Inline resolves the value at
build time, so a later `[data-theme]` override of `--color-app-canvas` would do
nothing. Non-inline emits `--color-app-canvas: var(--color-zinc-950)` and
utilities that reference `var(--color-app-canvas)`, which is what makes a theme
switch possible. Verified with computed styles in Chromium: overriding
`--color-app-canvas` on an element changes its background while
`--color-app-on-accent` and unrelated roles keep their values.

P2 carries both palettes in every token with `light-dark(<daylight>, <night>)`
and lets `color-scheme` choose: Night watch forces `dark`, Daylight forces
`light`, and Match system uses `light dark` so the operating system decides,
including live changes without a reload. That keeps one definition per token and
avoids duplicating the Daylight block inside a media query.

Two shade rules follow from that. The `50`/`100` shades of every accent scale
are only used as foreground accents, so the light palette takes the dark end of
the same scale (`text-primary-100` is amber-800 on white and amber-100 on
black). Mid shades that sit under `--color-app-on-accent` take a dark enough
light-mode value for white labels (`primary-500` is amber-700, not amber-600),
because the label token flips from near-black to white with the palette.

Sidebar chrome uses `--aw-*` tokens with the same pattern. The light values are
derived (violet-700 accent, violet-100 active row, violet-900 row text); the
Night watch values are the exact literals the sidebar shipped with, so the
default theme does not shift by a single channel.

### 3. Account preference is authoritative; the cookie is its projection

- **Signed in:** the server reads `User.theme` and renders it. The account value
  always wins over the cookie, so a device holding an older cookie still shows
  the account theme.
- **Anonymous** (public reader, sign-in, invite, setup): the cookie is
  authoritative, then `night-watch`.
- **Changing the theme while signed in** updates `User.theme` and the cookie in
  one response, so both agree immediately.
- **Signing in on a second device, or switching accounts:** the sign-in response
  writes the account value into that device's cookie. The cookie can never
  outvote the account.
- **Ordinary page requests are read-only.** They do not rewrite cookies; a
  device cookie that fell behind because another device changed the account
  theme catches up at the next explicit boundary: a theme change, sign-in, an
  account switch, or sign-out. Rendering is unaffected in the meantime because
  the account value is authoritative.
- **Signing out:** the logout response writes the account theme into the cookie
  before clearing the session, so the signed-out device keeps the theme the user
  last saw rather than a stale earlier choice.
- **Session expiry without an explicit sign-out** leaves the device cookie
  unchanged; the next sign-in overwrites it.
- **Validation:** unknown identifiers are rejected when written and fall back to
  `night-watch` when read.

The root layout renders `data-theme` and `color-scheme` on `<html>` from that
resolution. This avoids a client-side flash and avoids an inline bootstrap
script, keeping the CSP tightening path open. No `localStorage` mirror is needed,
so there is only one client-side source of truth per state.

Two implementation constraints:

- Cookies are written only at response-writing boundaries: the theme-change Route
  Handler or Server Action, the sign-in route, and the logout route. The root
  layout never writes a cookie; it only reads the cookie and the account value.
- `next.config.ts` enables `cacheComponents: true`. Reading the cookie in the
  root layout makes every route request-time, so `src/app/layout.tsx` sets
  `export const instant = false` once for the whole app instead of every page
  opting out. The trade-off is that no route prerenders a themed static shell.
  Revisit with `use cache: private` if Instant Navigation validation should be
  re-enabled per route.

### 4. Default stays Night watch; "Match system" is resolved in CSS

Honoring `prefers-color-scheme` automatically would change appearance for
existing users whose OS prefers light, so the default remains Night watch.
**Match system** is an explicit option stored like any other value and rendered
as `data-theme="system"`:

- `[data-theme="system"]` maps to the Night watch palette;
- `@media (prefers-color-scheme: light)` remaps the same selector to Daylight.

Because this is CSS, it resolves on first paint with no script, and a live OS
change takes effect without a reload. Match system pairs Night watch with
Daylight; letting the user choose the pair is an open question, not a
requirement.

### 5. Light themes need more than inverted text colors

Audit these specifically: cover-image gradients (`from-zinc-950`), modal scrims
(`bg-black/40`), shadows, chart and map chrome, code blocks, disabled controls,
focus rings, empty/loading/error states, and transparent PNG placement. Each
becomes a token pair verified in all five themes.

### 6. Existing map annotations keep their current colors

`paintStroke` in `src/components/map/InteractiveMap.tsx` falls back to `#eab308`
for stored elements that have no color. That fallback must not become
theme-dependent, or annotations authored earlier would repaint when a viewer
changes theme. New drawings persist the author's chosen default color into the
element at creation; the fallback stays a fixed legacy constant. Map chrome
(toolbar, layer panel, canvas surround) follows the chrome theme; the map image
and its backdrop do not.

### 7. Contrast floor

Every theme meets WCAG 2.2 AA: body text ≥ 4.5:1, large text ≥ 3:1, control
outlines, icons that carry meaning, and focus indicators ≥ 3:1 against both
adjacent colors, with focus indicators at least 2px. Subtle dividers are
decorative and may sit below 3:1; anything needed to identify a control uses
`--app-border-strong`. Token pairs are asserted in a test rather than checked by
eye. `forced-colors` and `prefers-contrast: more` must remain usable.

Measured pairs for the starting palettes (body text on its own canvas or
surface):

| Pair | Ratio |
| --- | --- |
| True black `#f2f2f2` on `#000000` | 18.8:1 |
| True black muted `#a1a1aa` on `#0a0a0b` | 7.7:1 |
| True black border-strong `#63636b` on `#0a0a0b` | 3.3:1 |
| Daylight `#1c1b19` on `#f6f5f3` | 15.8:1 |
| Daylight muted `#5c5952` on `#f6f5f3` | 6.4:1 |
| Daylight faint `#78746d` / subtle-dim `#75716a` on `#ffffff` | 4.7–4.9:1 |
| Daylight accent `#8a4b12` on `#f6f5f3` | 6.2:1 |
| Daylight border-strong `#8a8781` on `#ffffff` | 3.6:1 |
| Daylight white on primary-500 `#bb4d00` | 5.0:1 |
| Daylight white on primary-600 `#973c00` | 7.1:1 |
| Daylight white on highlight-400 `#7f22fe` | 5.9:1 |
| Daylight white on sidebar accent `#7008e7` | 7.3:1 |
| Daylight sidebar control outline `#8a8781` on `#ffffff` | 3.6:1 |
| Daylight violet-900 on violet-100 active row | 9.2:1 |
| Pathfinder `#181818` on `#ede3c7` | 13.9:1 |
| Pathfinder muted `#515c63` on `#ffffff` | 6.9:1 |
| D&D `#181818` on `#eee5ce` | 14.2:1 |
| D&D muted `#635648` on `#eee5ce` | 5.7:1 |
| D&D border-strong `#8a6a2f` on `#eee5ce` | 4.0:1 |
| Night watch `#f1f2f5` on `#111318` | 16.6:1 |
| Night watch muted `#b1b7c2` on `#111318` | 9.2:1 |

The Pathfinder reader border `#644117` is 7.1:1 on its paper and can serve as a
control outline. The D&D reader border `#c0ad6a` is 1.8:1 on its paper and is
decorative only. Night watch's sidebar search field edge (`#303540` on
`#181b22`) is a pre-existing 1.27:1; default parity forbids changing it here, so
it is recorded rather than fixed. Daylight uses its strong outline for the same
controls.

### 8. Naming and trademark

Palette values are colors; the names are descriptive references to rule systems.
The UI must not use either publisher's logo, wordmark, trade dress, or art, and
release notes or screenshots must not imply affiliation. If marketing material
would use the marks, obtain review first. Product labels may stay "Pathfinder"
and "D&D" as descriptive theme names, or move to neutral names with a subtitle;
this is an open question.

## Implementation packages

Each package is a separate reviewed commit. A package is done when its checks
pass and the evidence is reported.

| Package | Work | Evidence required |
| --- | --- | --- |
| P1 | Token layer with Night watch values; migrate every `zinc`/`amber`/`indigo`/`violet`/`red`/`emerald`/`sky` utility to semantic tokens; update the `.world-presentation` selectors that currently match utility class names so reader overrides survive; no theme switcher yet. **Implemented on `feat/theme-tokens`.** | Screenshot diff of key routes shows no visual change; grep proves no raw palette utilities remain outside the token definitions; reader presentation overrides still apply under all world themes |
| P2 | `User.theme` migration, cookie projection, root-layout resolution, switcher in workspace and public chrome, "Match system" CSS mapping, invalid-value fallback | Unit tests for precedence, validation, and account-over-cookie behavior; Playwright tests for switch + reload with no flash, OS preference change under Match system, and the remote-change → page request → sign-out sequence |
| P3 | True black palette and elevation rules | Contrast assertions; screenshots of workspace, editor, admin, player, reader chrome |
| P4 | Daylight palette | Same as P3. **Implemented on `feat/theme-daylight-audit`**: audited `/`, `/admin/users`, `/player`, `/login`, `/w/*`, the article editor, the template dialog and the map editor with a per-text-node contrast probe (0 failures at 4.5:1), and verified Night watch computed colors are unchanged. |
| P5 | Pathfinder palette derived from the shared source | Same as P3, plus a check that chrome and reader values match |
| P6 | D&D palette derived from the shared source | Same as P3 |
| P7 | Coverage sweep: editor, character sheet, maps chrome, dialogs, tables, code, scrollbars, overlays, loading/empty/error, print | Manual checklist per theme on every route group; map annotation colors unchanged |
| P8 | Update `docs/`, wiki, README screenshots, and the theme-selection help text | `pnpm docs:check`; screenshots captured from an isolated demo database |

## Acceptance criteria

- The default appearance is unchanged for anyone who never opens the switcher.
- All five themes are selectable from the author workspace, admin, player
  portal, and public reader chrome; the choice survives reload, new session, and
  a different device when signed in.
- No theme flashes the wrong palette on first paint, including on public pages.
- Article presentation continues to follow the world, not the viewer.
- Every theme passes the contrast floor on the audited surfaces; focus rings are
  visible on all five.
- Stored map annotation colors and character-sheet paper styling are unchanged;
  elements saved without a color keep the legacy `#eab308` fallback.
- Match system follows a live OS preference change without a reload and without
  a wrong-theme first paint.
- `pnpm lint`, `pnpm build`, unit tests, HTTP tests, and browser tests pass; new
  tests cover theme resolution, account-over-cookie precedence, invalid input,
  no-flash, and the remote-change → page-request → sign-out sequence.
- Documentation and screenshots cover selecting a theme and the two game themes'
  non-affiliation note.

## Risks

- **Mechanical breadth.** The P1 migration covered 2,179 palette utilities across
  62 files. Any surface that keeps a literal color (`text-white`, `bg-black/40`,
  gradients) must be found in P7; partial coverage produces unreadable patches of
  the UI in light themes.
- **Presentation selectors coupled to utility names.** `.world-presentation`
  matches `[class*="bg-zinc-"]`, `[class*="border-zinc-"]`, and specific
  `text-*` classes. Renaming utilities without updating those selectors silently
  breaks per-world reader styling.
- **Contrast regressions.** Light themes are not the inverse of dark ones;
  amber-on-white and indigo-on-parchment both fail at the current shades.
- **Editor and canvas surfaces.** TipTap content, `block-editor` styles, and map
  canvases have their own color assumptions that utilities do not reach.
- **Preference conflicts.** A signed-in user's cookie and account value can
  disagree after another device changes the theme. The account stays
  authoritative for rendering, and the cookie catches up at sign-in, theme
  change, or sign-out; the remote-change sequence is covered by a test.
- **Print and export.** Printed articles and any future PDF path must not inherit
  a dark chrome.
- **Screenshots and docs drift.** README and wiki images show the current theme;
  they need a deliberate refresh, not an accidental one.

## Open questions

1. Where should the switcher live: workspace sidebar, a user menu, or both? The
   public reader chrome must offer selection and persist it in the cookie; only
   the placement is open.
2. Keep the labels "Pathfinder" and "D&D", or use neutral names with a subtitle?
3. Should Match system let the user choose which dark and light theme it pairs?
4. Does the admin area need a separate forced theme for operational clarity?
5. Should true black also be offered as a world presentation theme for OLED
   readers (separate feature)?
