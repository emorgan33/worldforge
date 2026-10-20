# Campaign rules profiles

WorldForge emphasizes **D&D 5e 2014** and **Pathfinder 2e Remaster**, as selected by the user. The campaign home and world settings save the default rules system. Changing it affects new content defaults; existing statblocks retain their system.

## Campaign workflow

The campaign home links to the bestiary, spellbook, treasure and session journals, with quick creation of NPCs, adventure outlines, locations and recaps. Its counts follow the selected rules system. The sidebar compendium now opens the actual editor rather than the secrets view.

The compendium supports creating, editing and deleting creatures, NPCs, spells and magic items, with filters and a shared renderer used on the GM screen. New entries use homebrew placeholders, not published creatures or automatically balanced builds. Spells and items have their own forms rather than creature combat fields.

## Rules distinctions

| Area | D&D 5e 2014 | Pathfinder 2e Remaster |
| --- | --- | --- |
| Creatures | CR, ability scores with derived modifiers, saves, proficiency | Creature level, attribute modifiers, Perception, Fortitude/Reflex/Will |
| Abilities | Action, bonus action, reaction, legendary action | One/two/three actions, reaction, free action |
| Spells | Spell level, school, casting time, V/S/M components | Spell rank, traditions, traits, cast/actions, heightened effects |
| Items | Rarity, attunement, charges | Item level, traits, rarity, Usage, Bulk, activation |
| Character lore | Race, class/subclass, background, alignment | Ancestry, heritage, class, background, edicts/anathema |

References: [D&D 2014 Basic Rules: Combat](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/combat), [Pathfinder encounter rules](https://2e.aonprd.com/Rules.aspx?ID=2007), and [Remaster attribute modifiers](https://2e.aonprd.com/Rules.aspx?ID=2032). No 2024 D&D rules profile or rules text import is included.

## Storage and compatibility

- `World.system` uses the existing `DND_5E` and `PF_2E` identifiers. No database migration or reseeding is required. Other pre-existing system identifiers remain supported.
- Statblocks retain their system and category during editing. Existing JSON fields, including spells, traits and custom properties, survive form edits. Legacy string actions remain supported alongside structured abilities with action costs.
- D&D scores remain in `stats`; Remaster modifiers use `attributes`. Legacy Pathfinder ability scores are preserved and identified rather than silently reinterpreted as modifiers.
- Article metadata records its own `rulesSystem`, independently of future campaign-default changes. System-specific metadata keys preserve older lore fields.
- This is a campaign authoring workspace, not a character builder, licensed rules compendium, automated encounter balancer or VTT.

## Verification

Run `pnpm test` for six regression tests covering stat rendering, zero/fractional ratings, score/modifier differences, legacy data and article prompts. TypeScript and ESLint pass for changed code; the article viewer retains two existing image optimization warnings.

The production build passes and the updated site runs on port 3033. Homepage and world-data requests return HTTP 200.

Chromium checks against the production build used temporary database records removed afterward. They covered D&D editing with preservation of unknown fields, failed-save recovery, Pathfinder creature/spell/item creation, D&D attunement, filters, confirmed deletion, persistence across reloads, article metadata saving and rendering on the GM screen.

The subsequent [structured RPG templates milestone](structured-rpg-templates.md) expands Character, Creature, Spell, Item and Encounter authoring for both editions, including grouped facts, compendium links and optional starter outlines.
