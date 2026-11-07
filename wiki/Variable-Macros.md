# Variable Macros

Open **Variables**, create a world-scoped collection with a prefix, and add
key/value entries. Insert `[prefix:key]` into author article text or the Variables
testbench. Prefixes/keys are case-insensitive; unknown shortcodes stay literal.

Types include simple/advanced terms, numbers, links, and rendered fragments.
Numbers are stored text, not an arithmetic engine. A value containing another
shortcode is not expanded recursively.

## Save and preview

Save each edited row and wait for completion. A failed save shows a row error
and retains input for retry. New typing during a request stays unsaved rather
than being cleared by its completion. Switching worlds waits for pending writes
and asks about remaining unsaved edits.

The testbench treats input as text. Article preview expands macros only in text
nodes, never in HTML attributes or scripts. Term output is escaped; rendered
fragments allow limited formatting, not arbitrary HTML, styling, images, or
scripts. Unsafe link destinations are not made clickable.

## Reader limitation

Collections are private author data. Public and campaign readers do **not**
receive them or expand their macros; shortcode syntax remains literal. Write
the intended shared text directly into the article when necessary. Export/import
preserves original variable values even when their rendered output is restricted.

**Source owner:** `wiki/Variable-Macros.md`; implementation:
`docs/variable-macros.md`, `src/lib/variable-parser.ts`, and Variables editor.
**Verified against:** `v0.4.3` (`94c694c`), source/contract audit; see
[verification record](Wiki-Verification).
