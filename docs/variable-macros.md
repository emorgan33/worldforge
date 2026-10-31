# Variable macros

Variable collections belong to a world and use `[prefix:key]` shortcodes. Prefixes
and keys are matched without regard to case. Unknown shortcodes remain literal.
The author article viewer and Variables testbench interpolate macros. Public and
campaign readers do not receive private collections or expand their macros.

## Rendering contract

`src/lib/variable-parser.ts` owns rendering for both author surfaces:

- `TERM_SIMPLE`, `TERM_ADVANCED` and `NUMBER` values are text. Labels and tooltips
  are escaped, including quotes, ampersands and angle brackets. Unknown legacy
  variable types also render as escaped text.
- `LINK` values become links only for valid HTTP/HTTPS URLs, `mailto:` URLs,
  site-relative paths beginning with a single `/`, or `#` anchors. Control
  characters, whitespace within a URL, backslashes, protocol-relative URLs and
  other schemes are rejected. A rejected link renders its escaped label.
- `RENDERED_FRAGMENT` values are parsed and rebuilt using these tags: `p`, `div`,
  `span`, `br`, `hr`, `strong`, `b`, `em`, `i`, `u`, `s`, `del`, `sub`, `sup`, `code`,
  `pre`, `blockquote`, `ul`, `ol`, `li`, and `a`. Only `title` attributes and safe
  anchor destinations survive. Links use `target="_blank"` and
  `rel="noopener noreferrer"`. Unsupported elements and their subtrees are
  dropped; classes, styles, handlers and other attributes are removed. Unsafe
  anchors retain their text. Fragment rendering stops beyond 50 nested levels.

The testbench treats source input as plain text. HTML typed into the source
field appears literally. The author article viewer retains its article markup
and expands macros only in HTML text nodes, leaving attributes, comments,
scripts, styles, SVG, MathML and templates unchanged. Macro replacement is a
single pass; a value containing another shortcode is not recursively expanded.
The fragment renderer is a policy for variable output, not a general article
HTML sanitizer. Article rendering still goes through the existing editor schema.

Stored and imported values are retained verbatim. Rendering applies the policy
at display time; no migration or destructive rewriting is required. Existing
fragments that relied on arbitrary HTML, custom styles or images now show only
supported content. Export/import retains the original value.

## Saving and navigation

Variable create/update APIs require string values, including the empty string.
Optional titles and descriptions must be strings or null. Creation accepts the
five supported types. World ownership and same-origin mutation checks remain in
the author authorization boundary.

The workspace rejects unsuccessful HTTP responses and network failures. The
Variables editor displays a row-specific error and retains the entered value
for retry. A successful save clears only the submitted edit: newer typing made
while the request was pending remains available to save.

Each row tracks its own pending request. Different rows may save concurrently;
a second save of the same row is blocked while its first request is pending.
Navigation remains blocked until every pending request settles. Failed or newer
unsaved edits still participate in the existing discard prompt after writes
finish.

Successful writes update only their own variable in the current world's
collection state. They do not replace collections from a subsequent list fetch,
so concurrent responses cannot roll back another row's displayed value. The
workspace's world ID and load epoch checks discard stale-world UI updates.

## Validation

After starting a dev server against the isolated SQLite database and asset
directory described in [CONTRIBUTING.md](../CONTRIBUTING.md), run:

```bash
node --import tsx --test --test-concurrency=1 \
  tests/variable-parser.test.tsx tests/variables-api.test.ts \
  tests/navigation-guard.test.ts
```

The parser tests cover hostile imported values, scalar and attribute escaping,
rich formatting, unsafe and entity-obfuscated URLs, plain testbench input,
text-only article interpolation, unknown types and single-pass replacement.
The HTTP tests cover validation without mutation, raw-value preservation,
concurrent writes and foreign-owner rejection.

R05 browser validation on 2026-10-24 used headless Chrome against a separate
source snapshot, fresh temporary SQLite database and temporary asset directory.
It injected delayed fetch responses into the real mounted workspace and checked:

- HTTP 400/401/403/500 and network failures show an error and retain edits.
- A successful save preserves newer typing entered while it was pending.
- With two saves pending, navigation is blocked before and after the first
  completion, and allowed after both succeed.
- Returning to Variables shows both committed values.
- The default preview safely displays imported scalar values; testbench source
  remains literal and rich fragments retain bold formatting while removing
  executable elements and links.

These original interaction checks were manual browser validation. Repeatable
regressions now live in `tests/browser/variables.spec.ts`. After installing
Chromium with `pnpm exec playwright install chromium`, use the same isolated
server and environment described above to run:

```bash
WORLDFORGE_TEST_ORIGIN=http://127.0.0.1:3131 pnpm test:browser
```

The Playwright suite exercises the mounted workspace, holds PATCH requests
until explicitly released, and covers HTTP 400/401/403/500 and network errors,
retry, newer edits, both concurrent-response orders, navigation and returning
to committed values, and inert hostile markup with preserved bold formatting.
Navigation checks wait for React's passive guard registration after the row
renders. CI runs this suite after its HTTP checks against the same temporary
database and asset directory; it remains separate from the Node test counts.
