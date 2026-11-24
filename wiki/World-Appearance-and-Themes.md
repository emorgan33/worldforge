# World Appearance and Themes

Open **Edit world & styling** from the world home.

1. Choose D&D 5e 2014, Pathfinder 2e Remaster, Midnight, Parchment, or Deep Forest.
2. Optionally choose accent/background colors, a background image, and reading
   width: Narrow, Standard, or Wide.
3. Inspect the author-home preview, then **Save world**. Cancel discards changes;
   resetting defaults stages changes until saved.

**Use campaign rules style** follows the form's selected rules profile and
resets custom accent/background colors while retaining background image and
reading width. Changing the rules alone does not overwrite a chosen theme.

Homepage cover, global article cover, article-specific cover, and page background
are separate. An article override wins over the global cover; the background
sits behind an opaque readable surface. Custom accent text is contrast-adjusted.

Public readers use the saved theme; workspace controls retain their own styling.
Embedded statblocks keep their own stored rules-system style even in a
mixed-system article.

### Application chrome themes

Separate from world presentation, the interface itself has selectable chrome
themes. Open the **Interface theme** dropdown in the top-right of the author
workspace, admin pages, player portal, or the public reader bar to choose:

| Theme | Kind | Notes |
| --- | --- | --- |
| Night watch | dark | Default; the original workspace palette |
| True black | dark, OLED | Pure black canvas, surfaces above black, near-white text |
| Daylight | light | Neutral warm light palette |
| Pathfinder | colored light | Matches the Pathfinder 2e Remaster world theme |
| D&D | colored light | Matches the D&D 5e 2014 world theme |
| Match system | follows OS | Uses your operating system light/dark preference |

The choice is stored in your account and synced across devices. Anonymous
visitors have a cookie-based preference that falls back to Night watch.

Advanced CSS is scoped to the reader, limited to 20,000 characters, and rejects
unsafe/unscopable rules such as imports, font-face, fixed/sticky positioning, and
escaping selectors. It is not arbitrary site-wide CSS. Invalid legacy CSS is not
emitted. Use presets first if a customization fails validation.

An image used as a public world's background becomes publicly readable. Removing
that placement or making the world private revokes access unless another public
placement still uses it. See [Images and Stock Art](Images-and-Stock-Art).

**Source owner:** `wiki/World-Appearance-and-Themes.md`; implementation:
`docs/world-appearance.md` and appearance validation/rendering modules.
**Verified against:** `v0.4.10` (`38f6cb5`), source/contract audit; see
[verification record](Wiki-Verification).
