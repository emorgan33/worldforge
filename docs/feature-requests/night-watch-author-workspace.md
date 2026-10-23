# Feature request: Night watch author workspace

Status: Implemented. Validation results are recorded in
[the Night watch validation report](../night-watch-validation-2026-10-23.md).

## Summary

Refine WorldForge’s owner/GM workspace around the “Night watch” direction: a compact, action-first campaign desk with a cooler graphite surface system, consistent violet interaction cues, restrained amber campaign cues, clearer typography, and considered empty states. Move campaign-rules selection out of the prominent home dashboard into world settings. Keep the current ruleset visible on the dashboard as read-only context.

This is a visual and information-hierarchy improvement, not a change to world data, permissions, reader presentation, character-sheet mechanics, or session APIs.

## Problem and audience

The current author home places a large amber rules-selection banner above the GM’s next actions. The sidebar uses violet for active navigation and its primary action, while the dashboard uses amber for selection, links, icons, and primary buttons. This makes the two accent colors compete. The four count cards precede session preparation even when several counts are zero, and the empty session state has a second call to action beside “New Session.” Small labels and icon sizes vary across the sidebar, cards, and session controls.

The primary user is an owner/GM opening a world to prepare the next session, create an article or compendium item, find existing lore, or manage a world setting. The daily path should favor those tasks; changing the campaign ruleset is infrequent configuration.

## Proposed experience

### 1. Campaign home composition

- Replace the rules-switching hero in `CampaignOverview` with a compact heading that names the current world, identifies the GM campaign desk, and shows the active ruleset as a read-only label.
- Put “Create for your world” and “Next session” first. Preserve real create paths for character/NPC, creature, spell, item, location, and session recap, with an “All templates” route/action to the full template picker. Do not silently drop other existing templates.
- Keep compendium counts available, but move them below the immediate work area. Counts must be computed from the current world and rules profile, not mock data.
- Provide a world-content section based on actual articles. Use a stable, meaningful ordering (for example the existing category/article order); do not label it “Recent” unless recency is actually queried and sorted. When there are no articles, show a concise first-article prompt rather than an empty list.
- Retain an obvious path to the existing World homepage preview, publishing controls, member management, and Edit world & styling. Reorganizing or disclosing those sections must not remove their functionality or their unsaved-change protections.

### 2. Rules configuration

- Remove the D&D/Pathfinder selection cards and the `onChangeSystem` action from the campaign desk. The dashboard may display the active profile and edition as read-only context, but must not offer a “Change rules” button there.
- Keep the editable Campaign rules selector in **Edit world & styling** (`WorldHome`). Make the entry point discoverable from the author workspace without giving it the visual weight of a daily task. If world settings are separated from the home view, preserve the current form’s save/cancel behavior and navigation guard.
- Changing a world default must keep the established behavior: existing statblocks retain their own rules system; article-specific rules profiles, character sheets, and deliberate reader-theme selections are not overwritten. The “Use campaign rules style” shortcut continues to reflect the unsaved Campaign rules value in the settings form.

### 3. Color, type, surfaces, and density

- Use violet for active navigation, keyboard focus, interactive links, and primary actions. Use amber sparingly for campaign/rules identity and contextual editorial markers. Use semantic colors and text for success, warning, error, and session status; color alone must not convey state.
- Define a small author-workspace surface ladder (canvas, sidebar, panel, raised control) and shared border treatment. Use elevation primarily for drawers, menus, and overlays rather than every dashboard card. Do not apply these workspace tokens to world-specific public/campaign reader themes.
- Use a clear sans-serif author-workspace hierarchy: campaign title above section headings above body/metadata. Keep long world titles wrapping cleanly; avoid ellipsis on primary page titles. Supporting text should remain readable at narrow widths and 200% zoom. Existing book-style typography remains available in reader themes.
- Standardize outline icon size and stroke across comparable navigation and dashboard controls. Icons accompany visible labels; collapsed navigation retains hover/focus labels and accessible names.
- Use consistent panel gaps and internal spacing. Preserve the current collapsible desktop sidebar and mobile drawer; do not add a second navigation model. Avoid horizontal overflow at narrow widths and keep actionable mobile targets at least 44 × 44 CSS pixels.

### 4. Session states

- Keep `NextSessionDesk`’s real create, planned, played, cancelled, linked-entity, recap, and error behaviors. The empty state should have one primary “Create first session” path, specific explanatory copy, and a restrained icon rather than a large dashed illustration panel plus duplicate competing action.
- Creation form has a visible label, disabled/busy behavior, keyboard submission, an inline validation message for blank titles, a visible server-error message, and clear success feedback after persistence. Do not claim success before the API confirms creation.
- Planned/played/cancelled states retain text labels as well as semantic color. The next session remains distinct without relying on an amber gradient or glow. Check narrow-width layout for long titles, dates, locations, linked entities, and action buttons.

## Scope and implementation touchpoints

- `src/components/campaign/CampaignOverview.tsx`: home hierarchy, real shortcuts/counts, removal of rules-selector cards, author-workspace palette and typography.
- `src/components/campaign/NextSessionDesk.tsx`: empty/create/error/success visual treatment and control sizing, without changing persistence semantics.
- `src/components/Sidebar.tsx`, `src/components/worlds/WorldSwitcher.tsx`, and `src/components/AuthorWorkspace.tsx`: consistent workspace navigation and shell surfaces, preserving collapse/drawer, focus return, current-page cues, world switching, and navigation guards.
- `src/components/WorldHome.tsx`: discoverable world settings and sole Campaign rules selector; retain the author preview, publication controls, integrations, and member-management path.
- Prefer shared, scoped author-workspace tokens/components over scattering another set of unrelated hex values through JSX. Scope changes so `src/components/public/WorldPresentation.tsx`, reader themes, statblocks, and character sheets are unaffected.

## Acceptance criteria

1. On desktop, the active world and its ruleset are identifiable at a glance, while create and next-session tasks appear before compendium counts and world settings. No editable rules selector appears in the campaign desk.
2. Edit world & styling is reachable from the workspace and contains the functional Campaign rules selector. Saving, cancelling, switching worlds, and navigating away with dirty settings behave as before. Existing rules-profile and reader-theme behavior is preserved.
3. Violet consistently denotes interaction/selection/focus; amber denotes campaign identity, not a second primary-action color. Success/error/status states use semantic color plus visible text. Text and controls meet WCAG AA contrast targets in the author workspace, including hover, focus, disabled, and error states.
4. At desktop, tablet, and approximately 390px mobile widths, the sidebar/drawer and dashboard have no horizontal overflow or clipped primary actions. Mobile touch targets are at least 44px. The current location is programmatically and visually identifiable; the drawer traps focus while open, closes with Escape, and returns focus to its trigger.
5. Empty world content and empty session states provide one clear next action each. Session form loading, validation, server-error, and confirmed-success states are distinguishable. Nonempty sessions, long titles, and linked entities remain usable.
6. Icon sizing/stroke is consistent for comparable controls; every icon-only action has an accessible name. Reduced-motion settings are respected if transitions are added.
7. The author UI changes do not alter public/player reader visibility filters, category projections, world appearance settings, article metadata, statblock rules profiles, or stored data. No database migration is required for a visual-only implementation.

## Verification plan

- Add/update focused component tests for the campaign home’s read-only rules label and shortcut behavior, world-settings rules editing, session empty/create/error/success states, and sidebar current-page/drawer keyboard behavior. Preserve existing server-backed session tests where applicable.
- Run `pnpm run test`, `pnpm run lint`, and `pnpm run build` after implementation. Consult the installed Next.js documentation under `node_modules/next/dist/docs/` before changing framework-facing code, per `AGENTS.md`.
- Inspect the implemented workspace in a browser with representative empty and populated worlds at desktop, tablet, and mobile widths; exercise keyboard-only navigation and 200% zoom. Use an isolated fixture database, not `pnpm db:seed` against a configured user database.
- Compare against the concept while reviewing real content and state transitions. A mockup is not evidence that the implemented interface is accessible or tested.

## Non-goals

- Redesigning public or campaign reader pages, edition book themes, statblocks, or character sheets.
- Changing campaign-rules mechanics, automatically migrating existing content, or changing session persistence/API behavior.
- Adding new dashboard metrics, invented activity feeds, or new asset dependencies.

## Design reference

The selected direction is “Night watch” (C). A refined, interactive local concept is at `/home/erik/worldforge-night-watch-v2.html`; it is a visual reference, not production code or a repository asset. It illustrates desktop/mobile layout and session empty, create, validation-error, and success states. Its stand-in links must be wired to actual app behavior during implementation.
