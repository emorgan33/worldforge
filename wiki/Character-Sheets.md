# Character Sheets

Create an **NPC / character** from campaign home or choose the Character article
template. The article's rules profile selects **D&D 5e 2014** or **Pathfinder 2e
Remaster**; older articles fall back to the world's system.

## Fill in a sheet

Click/tap a labelled box. Enter the character name to enable article saving.
Identity, abilities/attributes, defenses, skills, hit points, equipment,
features, and spellcasting sections remain visible even when blank.

Use **Add** for repeatable attacks/strikes, inventory, features/feats, and spells.
**Remove** deletes a row; **Undo removal** restores the latest removal in that
section during this editing session. Clearing a value or the last row is saved.

| D&D 5e 2014 | Pathfinder 2e Remaster |
| --- | --- |
| Ability scores; calculated ability modifiers | Directly entered attribute modifiers |
| Proficiency/expertise, Inspiration, death saves | Training ranks, Hero Points, Dying/Wounded |
| Spell levels 1–9 | Spell ranks 1–10, traditions, Focus Points |

**This is a manual-entry sheet, not a character builder.** Only D&D ability
modifiers calculate automatically. Changing class, level, training, or attributes
does not calculate final skills, saves, AC, attacks, or spell DCs. Compendium
links do not supply those statistics.

Edits use [autosave/recovery](Writing-and-Editing). Invalid changed numeric
values pause autosave until corrected. **Save Article** opens a read-only sheet.
Public and campaign readers also see read-only sheets when granted access.

## Existing data and privacy

Changing profile/template retains both profiles' data and prose. Legacy/custom
metadata remains under **Other saved details**. Readers receive only known fields
and row columns for the active profile; those fields are not individually secret.
If old/imported row data cannot be parsed, preserve it and use revision recovery
rather than overwriting it. Revisions and exports retain sheet metadata.

**Source owner:** `wiki/Character-Sheets.md`; implementation:
`docs/character-sheets.md`, `src/lib/character-sheet.ts`, and CharacterSheet component.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
