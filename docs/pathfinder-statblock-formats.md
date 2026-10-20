# Pathfinder statblock formats

Implemented against [pf2e-style 0.2.0](https://typst.app/universe/package/pf2e-style/) and the published `lib.typ` / `style/formatting.typ` definitions. The package has `encounter`, `feat` and `spell` models. Its documented encounter examples cover creatures and hazards; arbitrary encounter-like entries share that model. Item and Class are existing WorldForge types: Item adapts the same rules-block pattern, while Class retains a notes layout. The package does not define separate Item or Class models.

## Shared presentation

All Pathfinder cards use a dedicated renderer rather than the generic D&D field list. The title is uppercase and condensed with the block type/level aligned right, followed by a thin black rule and colored trait tags. Common rarity is omitted. Size tags are green, standard traits maroon, Unique purple, Rare navy and Uncommon orange-brown with readable white text. Rarity and size do not repeat in the body.

Roboto is bundled locally as a variable font under its [OFL license](licenses/roboto-OFL.txt). The renderer uses a condensed body setting, bold field labels, hanging lines, black rules and the package's locally adapted action artwork. Title action symbols retain hidden readable labels. A small wayfinder emblem remains as previously requested. The shared 16–24px panel inset prevents text touching the card edges.

This matches the reference's content hierarchy and block formatting for the web; it is not a fixed A4 facsimile. Browser wrapping, font-width limits and responsive sizing differ from Typst print metrics. The current body is 0.95rem, with 1.3em encounter and 1.4em feat/spell titles. Card content stays in a single readable column, including on narrow screens.

## Type mapping and field order

| Site type | Reference model | Header | Content order |
| --- | --- | --- | --- |
| Creature / NPC | `encounter` | Creature + level | Traits; italic description; Perception/senses; Languages; Skills; inline Str/Dex/Con/Int/Wis/Cha modifiers; Items; rule; AC/Fort/Ref/Will; HP/immunities/weaknesses/resistances; defensive abilities; rule; Speed; offensive abilities; spellcasting |
| Hazard | `encounter` | Hazard + level | Traits; Stealth; Description; rule; Disable; AC/saves; Hardness/HP/BT/immunities; defensive abilities; other triggered effects; Routine; Reset |
| Feat | `feat` | Feat + level, action symbol beside name | Traits; Prerequisites; Requirements; Frequency/Trigger; rule; indented effect and degree-of-success text; optional Special section |
| Spell | `spell` | Spell + rank, action symbol beside name | Traits; Traditions; optional Cast text; Requirements/Trigger; Range/Area/Targets; Defense/Duration; rule; effect and Critical Success/Success/Failure/Critical Failure; Heightened section |
| Item | Adapted rules-block pattern | Item + level | Traits; Price; Usage/Bulk; Activate; Frequency/Requirements/Trigger; rule; effect; abilities; optional Special section |
| Class | Existing notes compatibility | Class | Notes and any legacy abilities/spells |

Missing fields are omitted, not replaced with fabricated numbers. Level/rank zero and negative modifiers remain valid. Existing ability-score records stay identified as legacy scores instead of being converted silently.

## Authoring and storage

Hazard and Feat are new Pathfinder-only categories in the compendium's Entry type selector. Existing categories remain available. The editor groups fields by type and includes an expandable live preview. Spell and feat Action cost values accept `1`, `2`, `3`, `reaction`, `free`, or custom text; custom text stays readable. Existing custom Cast text remains visible even when a title action symbol is set.

Creature, NPC, Hazard and Item entries support structured abilities. Placement chooses defensive versus offensive/effect sections; Trigger, Requirements and Frequency are stored with the ability. Each ability keeps its name, action cost and effect. Legacy string abilities and named trait abilities remain readable. Existing spell/item/class ability arrays also remain visible.

The additive fields live in existing `statsJson`; category is already stored as a string. No schema migration or content backfill is required. Opening and saving an entry retains unknown metadata. Server validation checks the final system/category pairing, including partial updates, so Hazard/Feat cannot be reassigned to another rules system accidentally. All author APIs retain owner/session checks.

## Verification

The complete suite passes 51 tests, including type-specific ordering, zero/negative values, legacy data, action labels, form coverage, API persistence and partial-update compatibility. Focused ESLint and production build/TypeScript pass.

Chromium verified creating, previewing and saving all seven categories; reopening/editing a creature without losing unknown metadata; public embeds of every type; local Roboto loading; retained card insets; and no page/card overflow at 390/768/1440 pixels. Temporary fixtures were removed. The managed local site runs the verified build.
