import type { EditorState, Transaction } from "@tiptap/pm/state";
import { Selection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import type { Node } from "@tiptap/pm/model";

export function topLevelBlocks(doc: Node) {
  const blocks: { pos: number; node: Node }[] = [];
  doc.forEach((node, pos) => blocks.push({ pos, node }));
  return blocks;
}
function selected(tr: Transaction, pos: number) {
  return closeHistory(tr.setSelection(Selection.near(tr.doc.resolve(Math.min(Math.max(pos, 0), tr.doc.content.size)), 1)));
}
export function moveEditorBlock(state: EditorState, from: number, to: number): Transaction | null {
  const blocks = topLevelBlocks(state.doc);
  if (from === to || !blocks[from] || !blocks[to]) return null;
  const source = blocks[from], target = blocks[to];
  const destination = from < to ? target.pos + target.node.nodeSize - source.node.nodeSize : target.pos;
  return selected(state.tr.delete(source.pos, source.pos + source.node.nodeSize).insert(destination, source.node), destination + 1).scrollIntoView();
}
export function duplicateEditorBlock(state: EditorState, index: number): Transaction | null {
  const block = topLevelBlocks(state.doc)[index];
  if (!block) return null;
  const pos = block.pos + block.node.nodeSize;
  return selected(state.tr.insert(pos, block.node), pos + 1).scrollIntoView();
}
export function deleteEditorBlock(state: EditorState, index: number): Transaction | null {
  const block = topLevelBlocks(state.doc)[index];
  if (!block) return null;
  return selected(state.tr.delete(block.pos, block.pos + block.node.nodeSize), block.pos).scrollIntoView();
}
