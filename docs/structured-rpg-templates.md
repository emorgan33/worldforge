# Structured RPG article templates

Character, Creature, Spell, Item and Encounter templates now provide grouped, optional structured fields for D&D 5e 2014 and Pathfinder 2e Remaster. Creature and Encounter are new article types; Species remains available for broader ecology and culture. Campaign-home shortcuts and the template chooser expose the new types. Metadata continues to use the existing serialized object; no database migration or reseeding is needed.

Characters now use [interactive character sheets](character-sheets.md) for their core statistics. Additional campaign notes and compendium links remain below the sheet. The sheet includes all of its labeled sections even when empty.

The profiles use separate mechanics keys. D&D creatures retain fractional CR and ability scores; Pathfinder creatures use levels (including -1 and 0), attribute modifiers and Fortitude/Reflex/Will. Spell forms separate 2014 level/components/concentration from Remaster rank/traits/traditions/heightening. Items separate attunement and charges from Remaster level, Bulk and activation. Encounter fields record party size/level, difficulty or threat, XP, objectives, opposition, terrain and outcomes. XP fields are notes, not encounter calculators.

Numeric authoring checks pause autosave for changed invalid values and resume after correction. Optional blank fields are allowed. Unchanged legacy text values remain saveable. New explicit character-level and D&D spell-level keys preserve older mixed-text level fields as other saved details.

Switching an article's profile or template keeps the metadata object and prose. The editor and preview group active fields and retain inactive/custom values under Other saved details. Selecting a different template does not replace article content. Insert template outline adds original starter headings only to an empty article; images, tables, embeds and existing headings prevent insertion.

Characters, creatures, spells and items can link matching compendium entries. The picker filters by world (the caller's world-scoped block list), system and entry category. The preview renders the current statblock, and missing/mismatched references show an explicit notice. Template notes and compendium mechanics remain independent. D&D and Pathfinder statblock reference keys are separate, so switching profiles retains each reference.

Terminology references were checked against the [D&D 2014 Basic Rules: Spellcasting](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/spellcasting), [Paizo Remaster Core Preview](https://downloads.paizo.com/RemasterCorePreview.pdf), [Paizo Remaster FAQ](https://paizo.com/pathfinder/remaster/faq) and licensed [GM Core encounter rules on Archives of Nethys](https://2e.aonprd.com/Rules.aspx?ID=2716). Templates contain authoring prompts rather than reproduced published spells or creatures.

Validation covers profile differences, unique field keys, numeric boundaries, empty-content protection, active/inactive quick facts, matching statblocks, and local recovery of the new article types. Browser scenarios exercise all ten system/template combinations, starter outlines, save/reopen, live statblocks, profile switching, legacy metadata preservation, invalid-field autosave pause/correction, and reload.

Production verification passed: all 29 automated tests (including the API integration checks), TypeScript, focused ESLint and the production build. Chromium passed all ten system/template combinations and the profile-switching, invalid-field correction, preservation and reload scenarios against port 3033. Test records were removed afterward. The viewer retains its two existing Next.js image lint warnings; the build retains the existing nonfatal timeline prerender logs.
