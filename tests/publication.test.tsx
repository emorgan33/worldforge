import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { publicationFields, publiclyReadable } from "../src/lib/publication";
import { parseArticleDocument, publicDocument, documentReferences } from "../src/lib/public-content";
import { PublicRichText } from "../src/components/public/PublicRichText";
const visible = [{ id: "public", title: "Visible article" }];
test("publication and visibility are independent and private world always overrides", () => {
  assert.deepEqual(publicationFields({}), { publicationStatus: "DRAFT", visibility: "PRIVATE", state: "DRAFT" });
  assert.deepEqual(publicationFields({ publicationStatus: "PUBLISHED", visibility: "PRIVATE" }), { publicationStatus: "PUBLISHED", visibility: "PRIVATE", state: "PRIVATE" });
  assert.equal(publicationFields({ state: "PUBLISHED" }).visibility, "PRIVATE");
  assert.equal(publicationFields({}, { publicationStatus: "DRAFT", visibility: "INHERITED" }).visibility, "PRIVATE");
  assert.equal(publicationFields({}, { publicationStatus: "DRAFT", visibility: "PUBLIC" }).visibility, "PUBLIC");
  for (const publicationStatus of ["DRAFT", "WIP", "PUBLISHED"]) for (const visibility of ["PUBLIC", "PRIVATE"]) for (const isPublic of [true, false]) assert.equal(publiclyReadable({ publicationStatus, visibility }, { isPublic }), isPublic && publicationStatus === "PUBLISHED" && visibility === "PUBLIC");
  assert.throws(() => publicationFields({ visibility: "MEMBERS" }));
});
test("public documents remove entire GM subtrees and redact inaccessible link labels and IDs", () => {
  const raw = { type: "doc", content: [{ type: "paragraph", content: [{ type: "articleLink", attrs: { articleId: "private-id", label: "Private dragon lair" } }, { type: "text", text: " @[Secret villain] @[Visible article]" }] }, { type: "campaignCallout", attrs: { kind: "gmNote" }, content: [{ type: "paragraph", content: [{ type: "text", text: "GM_ONLY_SENTINEL" }] }, { type: "image", attrs: { src: "https://example.com/secret.png" } }] }] };
  const doc = publicDocument(raw, visible, new Set(), new Set()); const json = JSON.stringify(doc);
  for (const hidden of ["private-id", "Private dragon lair", "Secret villain", "GM_ONLY_SENTINEL", "secret.png"]) assert(!json.includes(hidden));
  assert(json.includes("Visible article")); assert.equal(documentReferences(doc, "image", "src").size, 0);
});
test("HTML-only legacy content is parsed and public rendering escapes text and rejects active markup", () => {
  const raw = '<p><strong>Safe text</strong> @[Visible article] <a href="javascript:alert(1)">Bad link</a></p><div class="gm-secret-box"><p>HIDDEN_LEGACY</p></div><aside data-callout="gmNote">HIDDEN_NOTE</aside><script>SCRIPT_SENTINEL</script><img src="javascript:alert(2)" onerror="EVIL_HANDLER"><p>&lt;script&gt;Literal text&lt;/script&gt;</p>';
  const doc = publicDocument(parseArticleDocument(null, raw), visible, new Set(), new Set());
  const html = renderToStaticMarkup(<PublicRichText doc={doc} links={[{ ...visible[0], href: "/w/test/a/visible" }]} blocks={[]} />);
  assert.match(html, /<strong>Safe text<\/strong>/); assert.match(html, /href="\/w\/test\/a\/visible"/); assert.match(html, /&lt;script&gt;Literal text/);
  for (const hidden of ["HIDDEN_LEGACY", "HIDDEN_NOTE", "SCRIPT_SENTINEL", "EVIL_HANDLER", "javascript:"]) assert(!html.includes(hidden));
});
test("GM-note images never grant public access and foreign library images are removed", () => {
  const id = "b96e99c9-73a0-4725-a75d-3d22d70a2baa"; const url = `/api/assets/${id}/file`;
  const raw = parseArticleDocument(null, `<aside data-callout="gmNote"><img src="${url}"></aside><p><img src="/api/assets/b96e99c9-73a0-4725-a75d-3d22d70a2bab/file"></p>`);
  assert.equal(documentReferences(publicDocument(raw, visible, new Set([id]), new Set()), "image", "src").size, 0);
});
