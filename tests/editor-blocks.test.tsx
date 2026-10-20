import assert from "node:assert/strict";
import { test } from "node:test";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { EditorState } from "@tiptap/pm/state";
import { history, undo } from "@tiptap/pm/history";
import { CampaignCallout, CampaignStatblock } from "../src/lib/editor-nodes";
import { deleteEditorBlock, duplicateEditorBlock, moveEditorBlock } from "../src/lib/editor-blocks";
const schema = getSchema([StarterKit, Image, TableKit, CampaignCallout, CampaignStatblock]);
const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
function fixture() {
  return EditorState.create({ schema, plugins: [history()], doc: schema.nodeFromJSON({ type: "doc", content: [
    paragraph("Opening lore"),
    { type: "campaignCallout", attrs: { kind: "readAloud" }, content: [paragraph("The gate opens."), paragraph("Mist spills out.")] },
    { type: "bulletList", content: [{ type: "listItem", content: [paragraph("A nested clue")] }] },
    { type: "image", attrs: { src: "https://example.com/gate.jpg", alt: "Ancient gate" } },
    { type: "campaignStatblock", attrs: { blockId: "sentinel", name: "Gate Sentinel" } },
  ] }) });
}
test("moving a nested rich block preserves its full content and is undoable", () => {
  let state = fixture();
  const original = state.doc.toJSON();
  const tr = moveEditorBlock(state, 1, 4);
  assert(tr); state = state.apply(tr);
  assert.equal(state.doc.lastChild?.type.name, "campaignCallout");
  assert.equal(state.doc.lastChild?.childCount, 2);
  assert.equal(state.doc.lastChild?.attrs.kind, "readAloud");
  assert(undo(state, transaction => { state = state.apply(transaction); }));
  assert.deepEqual(state.doc.toJSON(), original);
});
test("duplicate/delete retain embed identity and image attributes", () => {
  let state = fixture();
  state = state.apply(duplicateEditorBlock(state, 4)!);
  assert.equal(state.doc.childCount, 6);
  assert.deepEqual(state.doc.lastChild?.attrs, state.doc.child(4).attrs);
  state = state.apply(deleteEditorBlock(state, 4)!);
  assert.equal(state.doc.childCount, 5);
  assert.equal(state.doc.lastChild?.attrs.blockId, "sentinel");
  state = state.apply(moveEditorBlock(state, 3, 0)!);
  assert.equal(state.doc.firstChild?.attrs.alt, "Ancient gate");
});
test("deleting the only atomic block leaves a valid writable document", () => {
  const state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: "doc", content: [{ type: "horizontalRule" }] }) });
  const updated = state.apply(deleteEditorBlock(state, 0)!);
  assert.equal(updated.doc.firstChild?.type.name, "paragraph");
  assert.doesNotThrow(() => updated.doc.check());
  assert.equal(moveEditorBlock(updated, 0, 5), null);
});

test("moving a table preserves cell content and column structure", () => {
  const doc = schema.nodeFromJSON({ type: "doc", content: [paragraph("Before"), {
    type: "table", content: [
      { type: "tableRow", content: [{ type: "tableHeader", content: [paragraph("Clue")] }, { type: "tableHeader", content: [paragraph("DC")] }] },
      { type: "tableRow", content: [{ type: "tableCell", content: [paragraph("Hidden door")] }, { type: "tableCell", content: [paragraph("18")] }] },
    ],
  }, paragraph("After")] });
  const state = EditorState.create({ schema, doc });
  const updated = state.apply(moveEditorBlock(state, 1, 2)!);
  assert.deepEqual(updated.doc.lastChild?.toJSON(), doc.child(1).toJSON());
  assert.doesNotThrow(() => updated.doc.check());
});
