import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ArticleLink } from "../src/components/editor/ArticleLink";
import { collectJsonReferences, searchArticleLinks, upgradeLegacyLinks } from "../src/lib/article-links";
import { collectHtmlReferences } from "../src/lib/article-mention-index";
const articles = [{ id: "gate", title: "The Gate", template: "LANDMARK" }, { id: "guild", title: "Gatekeepers", template: "ORGANIZATION" }, { id: "one", title: "Twin" }, { id: "two", title: "Twin" }];
test("article search ranks prefixes and keeps duplicate titles selectable by identity", () => {
  assert.deepEqual(searchArticleLinks("gate", articles).map(article => article.id), ["guild", "gate"]);
  assert.deepEqual(searchArticleLinks("TWIN", articles).map(article => article.id), ["one", "two"]);
  assert.equal(searchArticleLinks("missing", articles).length, 0);
});
test("legacy upgrade preserves formatting and nested structure, skips code and ambiguous titles", () => {
  const doc = { type: "doc", content: [{ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "See @[The Gate] and @[Twin].", marks: [{ type: "bold" }] }] }] }, { type: "codeBlock", content: [{ type: "text", text: "@[The Gate]" }] }] };
  const upgraded = upgradeLegacyLinks(doc, articles);
  const inline = upgraded.content![0].content![0].content!;
  assert.equal(inline[1].type, "articleLink"); assert.equal(inline[1].attrs!.articleId, "gate");
  assert.deepEqual(inline[1].marks, [{ type: "bold" }]); assert.match(inline[2].text!, /@\[Twin\]/);
  assert.deepEqual(upgraded.content![1], doc.content[1]);
  assert.deepEqual([...collectJsonReferences(upgraded).ids], ["gate"]);
});
test("HTML indexing reads decoded text and explicit IDs, ignores code, attributes and link labels", () => {
  const refs = collectHtmlReferences('<p>See @[Ash &amp; Ember] <span data-article-id="gate" data-article-label="@[Wrong]">@[Wrong]</span></p><img alt="@[Attribute]"><pre>@[Code]</pre><a href="/@[URL]">@[External]</a><script>@[Script]</script>');
  assert.deepEqual([...refs.ids], ["gate"]); assert.deepEqual([...refs.titles], ["Ash & Ember"]);
});
test("article references are atomic inline nodes that preserve identity through JSON", () => {
  const schema = getSchema([StarterKit, ArticleLink.configure({ articles })]);
  const doc = schema.nodeFromJSON({ type: "doc", content: [{ type: "paragraph", content: [{ type: "articleLink", attrs: { articleId: "gate", label: "Old name" } }] }] });
  assert.doesNotThrow(() => doc.check()); assert.equal(doc.firstChild!.firstChild!.isAtom, true);
  assert.equal(doc.toJSON().content[0].content[0].attrs.articleId, "gate");
});
