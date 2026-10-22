# Interactive character sheets

Character articles have complete, editable paper-style sheets for **D&D 5e 2014** and **Pathfinder 2e Remaster**. Create an NPC / character from the campaign home or choose the Character template in the editor. The article's rules profile selects the sheet; older articles without a profile use the world's system. Other systems keep their existing template fields.

## Using a sheet

Click or tap a labeled box to edit it. The character name is also the article title. Identity, attributes, defenses, skills, saving throws, hit points, equipment, features, spellcasting, spell slots, and personality sections appear even on a blank character.

| D&D 5e 2014 | Pathfinder 2e Remaster |
| --- | --- |
| Ability scores and calculated modifiers | Directly entered attribute modifiers |
| Proficiency, expertise, Inspiration, death saves | Training ranks, Hero Points, Dying, Wounded |
| Attacks, features and traits | Strikes, feats and abilities, repeatable Lore skills |
| Spell levels 1–9 | Spell ranks 1–10, traditions and Focus Points |

Use **Add** in a repeatable section for attacks/strikes, inventory, features/feats, spells, or other resources. **Remove** deletes a row; **Undo removal** restores the latest removed row in that section during the current editing session. Clearing a value or removing the final row persists as an empty value or section.

D&D ability modifiers are calculated from scores. All other totals are entered manually, including skills, saves, AC, attack bonuses, and spell DCs. Changing class, level, training, or an attribute does not recalculate those totals. Compendium links remain independent of sheet statistics.

Edits use the existing [article autosave and local recovery](autosave-and-recovery.md). Enter a character name to enable saving. Invalid changed numeric fields pause autosave until corrected; unchanged legacy text remains saveable. **Save Article** opens the read-only author view. Published public and authorized campaign readers see a read-only sheet through the existing article access rules.

On smaller screens, **Menu** opens campaign navigation and **Close** returns to the sheet. Opening the menu keeps the editor mounted and preserves unsaved entries. Sheet fields use native controls, visible keyboard focus, and responsive columns.

## Existing articles and storage

No database migration or reseeding is required. Existing matching metadata keys feed the sheet directly, including race/ancestry, class, level, background, languages, and existing Pathfinder perception and saving throws. Legacy mixed-text level fields and custom metadata remain under **Other saved details**; campaign notes and article prose remain available below the sheet. Opening an article does not initialize or rewrite its metadata.

Scalar fields remain string values in article metadata. Mechanics use separate `dnd5e…` and `pf2e…` keys; common identity fields such as `species`, `age`, and `gender` are shared. Switching a profile or template retains both profiles' mechanics, repeatable rows, and prose.

Repeatable data uses a JSON string in `dnd5eCharacterRows` or `pf2eCharacterRows`:

```json
{
  "version": 1,
  "sections": {
    "attacks": [{ "id": "stable-row-id", "name": "Longsword", "bonus": "+5" }]
  }
}
```

Each row has a unique nonempty ID within its section, and its cells are strings. Editing a section preserves other sections and unknown extension fields. Article create/update endpoints reject changed malformed or unsupported row envelopes. If imported or older saved row data cannot be read, the editor preserves it, disables row editing, and provides a message with the original data and revision-recovery guidance. Unrelated edits can still save. Raw row JSON does not appear in generic saved details.

Public and campaign-reader metadata includes only the active profile's known fields, row sections, and columns. Unknown extension data and inactive profiles are not sent to readers. Known sheet fields follow the article's visibility; they are not individual secret fields. Article revisions, local drafts, and world export/import retain the serialized metadata, including extensions.

## Implementation and verification

`src/lib/character-sheet.ts` defines the two profiles, row format, validation, and reader projection. `CharacterSheet.tsx` supplies the shared editable/read-only layout. Its CSS module uses Next.js's native CSS-module handling; the Tailwind Turbopack loader is restricted to non-module stylesheets so it cannot discard scoped class exports.

Run the focused model and compatibility checks with:

```sh
node --import tsx --test tests/character-sheet.test.tsx tests/article-templates.test.tsx tests/article-drafts.test.tsx
```

The HTTP integration test requires a running test instance and the same isolated database in both processes:

```sh
DATABASE_URL=file:/tmp/worldforge-character-sheets.db \
WORLDFORGE_TEST_ORIGIN=http://localhost:3146 \
node --import tsx --test tests/character-sheet-api.test.tsx
```

It creates and removes fixture accounts/worlds, exercises both profiles, and checks persistence, malformed updates, ownership, revision restore, reader projection, and export/import. The broader suite uses `pnpm test`; HTTP tests skip unless their test origin is configured.

Edition references: [D&D 2014 ability scores](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/using-ability-scores), [D&D 2014 character creation](https://www.dndbeyond.com/sources/dnd/basic-rules-2014/step-by-step-characters), and [Paizo's Remaster character sheet](https://downloads.paizo.com/RemasterPlayerCoreCharacterSheet.pdf). The feature provides original sheet layouts and authoring fields without importing published rules text.
