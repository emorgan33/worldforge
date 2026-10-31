import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDocument } from "htmlparser2";
import { renderToStaticMarkup } from "react-dom/server";
import { interpolateVariables, renderVariableFragment } from "../src/lib/variable-parser";
import { VariableManager } from "../src/components/variables/VariableManager";
import type { VariableCollectionItem, VariableItem } from "../src/types";

function collections(type: VariableItem["type"], value: string, extra: Partial<VariableItem> = {}): VariableCollectionItem[] {
  return [{ id: "collection", worldId: "world", name: "Lore", prefix: "lore", variables: [
    { id: "variable", collectionId: "collection", prefix: "lore", key: "world_name", type, value, ...extra },
  ] }];
}

function assertSafe(html: string) {
  type Node = ReturnType<typeof parseDocument>["children"][number];
  function visit(nodes: Node[]) {
    for (const node of nodes) {
      if (node.type === "text") continue;
      assert.equal(node.type, "tag", html);
      if (node.type !== "tag") continue;
      assert.ok(!["script", "style", "img", "iframe", "object", "svg", "math", "input", "form", "template"].includes(node.name), html);
      for (const [key, value] of Object.entries(node.attribs)) {
        assert.ok(["class", "title", "href", "target", "rel"].includes(key), `${key}: ${html}`);
        if (key === "href") assert.match(value, /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i);
      }
      visit(node.children);
    }
  }
  visit(parseDocument(html).children);
}

test("scalar variables escape values, labels and tooltip attributes, including unknown legacy types", () => {
  const payload = '\"><img src=x onerror="window.injected=true"> & <script>alert(1)</script>';
  for (const type of ["TERM_SIMPLE", "TERM_ADVANCED", "NUMBER", "LEGACY_TYPE"] as VariableItem["type"][]) {
    const html = interpolateVariables("[LORE:WORLD_NAME]", collections(type, payload, { title: payload, description: payload }));
    assertSafe(html);
    assert.match(html, /&lt;img/);
    assert.match(html, /&amp;/);
    assert.doesNotMatch(html, /<img|<script/);
  }
});

test("plain testbench source is text and unknown macros remain readable", () => {
  const html = interpolateVariables('<img src=x onerror=alert(1)> [none:key] [lore:missing] [lore:world_name]', collections("NUMBER", "42"), "text");
  assertSafe(html);
  assert.match(html, /^&lt;img/);
  assert.match(html, /\[none:key\] \[lore:missing\]/);
  assert.match(html, />42<\/span>$/);
});

test("rich fragments preserve supported formatting and rebuild links without executable attributes", () => {
  const html = renderVariableFragment('<p class="overlay" style="position:fixed" onclick="alert(1)"><strong>Bold &amp; bright</strong><br><em>Italic</em> <code>x &lt; 2</code></p><ul><li>One</li></ul><a href="https://example.invalid/?a=1&amp;b=2" target="opener" rel="opener" title="A &quot;quote&quot;">Read</a>');
  assertSafe(html);
  assert.match(html, /<strong>Bold &amp; bright<\/strong><br><em>Italic<\/em>/);
  assert.match(html, /<code>x &lt; 2<\/code>/);
  assert.match(html, /<ul><li>One<\/li><\/ul>/);
  assert.match(html, /href="https:\/\/example.invalid\/\?a=1&amp;b=2" title="A &quot;quote&quot;" target="_blank" rel="noopener noreferrer"/);
  assert.doesNotMatch(html, /style=|class=|onclick=/);
});

test("imported fragments drop executable, foreign and embedded subtrees and unsafe links", () => {
  const payloads = [
    '<script>alert(1)</script><style>body{display:none}</style><img src=x onerror=alert(1)>',
    '<svg><a xlink:href="javascript:alert(1)">SVG</a></svg><math><mtext><img src=x onerror=alert(1)></mtext></math>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe><object data="javascript:alert(1)"></object><template><img src=x onerror=alert(1)></template>',
    '<a href="jav&#x61;script:alert(1)" onmouseover="alert(1)">Link</a><a href="java&#10;script:alert(1)">Link</a>',
    '<math><mtext><table><mglyph><style><!--</style><img title="--><img src=x onerror=alert(1)>">',
  ];
  for (const payload of payloads) {
    const html = interpolateVariables("[lore:world_name]", collections("RENDERED_FRAGMENT", payload));
    assertSafe(html);
    assert.doesNotMatch(html, /href="javascript:|onerror=|onmouseover=/);
  }
});

test("link variables and fragments share the same URL policy", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,test", "vbscript:alert(1)", "//evil.invalid", "/\\evil.invalid", "java\nscript:alert(1)", "https://", "file:///tmp/private"]) {
    const html = interpolateVariables("[lore:world_name]", collections("LINK", href, { title: "Safe label" }));
    assert.equal(html, "Safe label", href);
    assert.equal(renderVariableFragment(`<a href="${href}">Safe label</a>`), "Safe label", href);
  }
  for (const href of ["https://example.invalid/?a=1&b=2", "http://example.invalid", "mailto:gm@example.invalid", "/w/world/article", "#section"]) {
    const html = interpolateVariables("[lore:world_name]", collections("LINK", href, { title: '<b>Label</b>' }));
    assertSafe(html);
    assert.match(html, /<a href=/, href);
    assert.match(html, /&lt;b&gt;Label&lt;\/b&gt;/);
  }
});

test("article interpolation preserves markup and leaves attributes, comments and script/foreign containers alone", () => {
  const source = '<p title="[lore:world_name]">A &amp; B [lore:world_name]</p><!-- [lore:world_name] --><script>"[lore:world_name]"</script><svg><text>[lore:world_name]</text></svg>';
  const html = interpolateVariables(source, collections("RENDERED_FRAGMENT", "<strong>World</strong>"));
  assert.equal(html, '<p title="[lore:world_name]">A &amp; B <strong>World</strong></p><!-- [lore:world_name] --><script>"[lore:world_name]"</script><svg><text>[lore:world_name]</text></svg>');
  assert.equal(interpolateVariables("", []), "");
  assert.equal(interpolateVariables("<p>No macros &amp; unchanged</p>", []), "<p>No macros &amp; unchanged</p>");
});

test("macro replacement is single pass even if a stored value contains another macro", () => {
  const html = interpolateVariables("[lore:world_name] [lore:world_name]", collections("NUMBER", "[lore:world_name]"), "text");
  assert.equal((html.match(/<span/g) || []).length, 2);
  assert.equal((html.match(/\[lore:world_name\]/g) || []).length, 2);
});

test("manager's default preview safely renders malicious imported values", () => {
  const html = renderToStaticMarkup(<VariableManager collections={collections("TERM_SIMPLE", '<img src=x onerror="window.injected=true">', { description: '\" onmouseover="alert(1)' })} onUpdateVariable={async () => {}} onCreateVariable={async () => {}} />);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /&lt;img/);
  assert.match(html, /aria-label="Value for \[lore:world_name\]"/);
});
