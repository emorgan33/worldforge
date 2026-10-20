"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Editor, JSONContent, useEditorState } from "@tiptap/react";
import { ImageSourceField } from "@/components/assets/ImageSourceField";
import { isImageReference } from "@/lib/assets";
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import { Selection } from "@tiptap/pm/state";
import { deleteEditorBlock, duplicateEditorBlock, moveEditorBlock, topLevelBlocks } from "@/lib/editor-blocks";
import { RpgBlockItem, systemProfile } from "@/lib/rpg";

type BlockCommand = { label: string; hint: string; aliases?: string; node?: JSONContent; special?: "image" | "statblock" };
const commands: BlockCommand[] = [
  { label: "Text", hint: "A plain paragraph", node: { type: "paragraph" } },
  ...[1, 2, 3].map(level => ({ label: `Heading ${level}`, hint: "Organize a section", node: { type: "heading", attrs: { level } } })),
  { label: "Bullet list", hint: "An unordered list", node: { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] } },
  { label: "Numbered list", hint: "An ordered list", node: { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] } },
  { label: "Quote", hint: "A passage in another voice", node: { type: "blockquote", content: [{ type: "paragraph" }] } },
  { label: "Read-aloud", hint: "Narration for the table", aliases: "callout narration", node: { type: "campaignCallout", attrs: { kind: "readAloud" }, content: [{ type: "paragraph" }] } },
  { label: "Note", hint: "An emphasized callout", aliases: "callout", node: { type: "campaignCallout", attrs: { kind: "note" }, content: [{ type: "paragraph" }] } },
  { label: "GM note", hint: "An author note; follows article visibility", aliases: "callout", node: { type: "campaignCallout", attrs: { kind: "gmNote" }, content: [{ type: "paragraph" }] } },
  { label: "Image", hint: "Upload, reuse or link an image", special: "image" },
  { label: "Table", hint: "A 3 × 3 table with a header row", node: { type: "table", content: Array.from({ length: 3 }, (_, row) => ({ type: "tableRow", content: Array.from({ length: 3 }, () => ({ type: row === 0 ? "tableHeader" : "tableCell", content: [{ type: "paragraph" }] })) })) } },
  { label: "Statblock", hint: "Embed a creature, spell or item", aliases: "creature spell item", special: "statblock" },
  { label: "Code", hint: "Preformatted text", node: { type: "codeBlock" } },
  { label: "Divider", hint: "A horizontal rule", node: { type: "horizontalRule" } },
];
const MIME = "application/x-worldforge-block";
interface Anchor { index: number; top: number; bottom: number; left: number; viewportTop: number; viewportBottom: number }

function BlockMenu({ worldId, editor, query, blocks, anchor, onInsert, onClose, manual }: {
  worldId?: string; editor: Editor; query: string; blocks: RpgBlockItem[]; anchor: Anchor;
  onInsert: (node: JSONContent) => void; onClose: () => void; manual: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [special, setSpecial] = useState<BlockCommand["special"]>();
  const [imageUrl, setImageUrl] = useState("");
  const [imageAlt, setImageAlt] = useState("");
  const [error, setError] = useState("");
  const filtered = useMemo(() => commands.filter(command => `${command.label} ${command.aliases ?? ""}`.toLowerCase().includes(query.toLowerCase())), [query]);
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!special) popup.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.scrollIntoView({ block: "nearest" }); }, [index, query, special]);
  const choose = useCallback((command?: BlockCommand) => { if (!command) return; if (command.special) setSpecial(command.special); else if (command.node) onInsert(command.node); }, [onInsert]);
  useEffect(() => {
    if (special) { popup.current?.querySelector<HTMLInputElement>("input")?.focus(); return; }
    const element = editor.view.dom;
    function keydown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Enter") choose(filtered[Math.min(index, filtered.length - 1)]);
        else if (filtered.length) setIndex(previous => (previous + (event.key === "ArrowDown" ? 1 : filtered.length - 1)) % filtered.length);
      }
    }
    element.addEventListener("keydown", keydown, true);
    return () => element.removeEventListener("keydown", keydown, true);
  }, [editor, filtered, index, onClose, choose, special]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!popup.current?.contains(event.target as Node) && !editor.view.dom.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editor, onClose]);
  const width = Math.min(330, window.innerWidth - 24);
  const availableBelow = window.innerHeight - anchor.viewportBottom - 16;
  const maxHeight = Math.min(360, window.innerHeight - 32);
  const top = availableBelow >= 220 ? Math.max(12, anchor.viewportBottom + 6) : Math.max(12, anchor.viewportTop - maxHeight - 6);
  return createPortal(<div ref={popup} className="fixed z-[80] overflow-auto rounded-xl border border-zinc-700 bg-zinc-900 p-2 shadow-2xl" style={{ left: Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12)), top, width, maxHeight }} onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); editor.commands.focus(); }
    if (!special && event.key === "Enter") { event.preventDefault(); choose(filtered[index]); }
    if (!special && ["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setIndex(previous => filtered.length ? (previous + (event.key === "ArrowDown" ? 1 : filtered.length - 1)) % filtered.length : 0); }
  }}>
    <div className="flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500"><span>{special === "image" ? "Image block" : special === "statblock" ? "Choose a statblock" : "Insert a block"}</span><button type="button" aria-label="Close block menu" onClick={onClose} className="px-2 py-1 text-zinc-400">✕</button></div>
    {special === "image" ? <div className="space-y-3 p-2"><ImageSourceField worldId={worldId} label="Image URL" value={imageUrl} onChange={setImageUrl} onAssetSelected={asset => setImageAlt(asset.alt)} /><label className="block text-xs text-zinc-400">Alternative text<input aria-label="Image alternative text" value={imageAlt} onChange={event => setImageAlt(event.target.value)} className="mt-1 w-full rounded border border-zinc-700 bg-zinc-950 p-2 text-sm" /></label>{error && <p role="alert" className="text-xs text-red-300">{error}</p>}<button type="button" onClick={() => { try { if (!imageUrl.trim() || !isImageReference(imageUrl)) throw new Error(); onInsert({ type: "image", attrs: { src: imageUrl.trim(), alt: imageAlt } }); } catch { setError("Choose a library image or enter an HTTP/HTTPS image URL."); } }} className="rounded bg-amber-500 px-3 py-2 text-xs font-bold text-zinc-950">Insert image</button></div>
      : special === "statblock" ? <div className="space-y-1">{blocks.map(block => <button type="button" key={block.id} onClick={() => onInsert({ type: "campaignStatblock", attrs: { blockId: block.id, name: block.name } })} className="w-full rounded p-3 text-left hover:bg-zinc-800"><span className="block text-sm text-zinc-200">{block.name}</span><span className="text-[10px] text-amber-500">{systemProfile(block.system).short} · {block.category}</span></button>)}{!blocks.length && <p className="p-3 text-xs leading-relaxed text-zinc-400">Create a creature, spell or item in Bestiary & Spellbook, then embed it here.</p>}</div>
      : <div role="listbox" aria-label="Block types">{filtered.map((command, commandIndex) => <button type="button" key={command.label} role="option" aria-selected={commandIndex === index} autoFocus={manual && commandIndex === 0} onMouseDown={event => event.preventDefault()} onMouseEnter={() => setIndex(commandIndex)} onClick={() => choose(command)} className={`block w-full rounded-lg p-2 text-left ${commandIndex === index ? "bg-amber-950/60" : "hover:bg-zinc-800"}`}><span className="block text-sm font-medium text-zinc-100">{command.label}</span><span className="text-[11px] text-zinc-500">{command.hint}</span></button>)}{!filtered.length && <p className="p-3 text-xs text-zinc-400">No matching blocks. Press Escape to continue writing.</p>}</div>}
  </div>, document.body);
}

export function BlockControls({ worldId, editor, surface, blocks }: { worldId?: string; editor: Editor; surface: React.RefObject<HTMLDivElement | null>; blocks: RpgBlockItem[] }) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [manual, setManual] = useState<number | null>(null);
  const [actions, setActions] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [dropLine, setDropLine] = useState<number | null>(null);
  const actionMenu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actions) return;
    const outside = (event: PointerEvent) => { if (!actionMenu.current?.contains(event.target as Node) && !(event.target as Element).closest(".block-gutter")) setActions(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setActions(false); };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [actions]);
  const hovered = useRef<number | null>(null);
  const dragged = useRef<{ index: number; doc: Editor["state"]["doc"] } | null>(null);
  const snapshot = useEditorState({ editor, selector: ({ editor }) => {
    const { $from, empty } = editor.state.selection;
    const text = $from.parent.textContent;
    const slash = empty && $from.depth === 1 && $from.parent.type.name === "paragraph" && /^\/[\w -]*$/.test(text) ? text : null;
    return { count: editor.state.doc.childCount, active: $from.index(0), slash, from: $from.depth ? $from.before(1) : 0, revision: editor.state.doc.content.size };
  }});
  const slashKey = snapshot.slash === null ? null : `${snapshot.from}:${snapshot.slash}`;
  const open = manual !== null || (slashKey !== null && slashKey !== dismissed);
  const close = useCallback(() => { setManual(null); setDismissed(slashKey); }, [slashKey]);
  useEffect(() => {
    const host = surface.current;
    if (!host) return;
    const position = (index: number) => {
      const entries = topLevelBlocks(editor.state.doc);
      const block = entries[Math.min(index, entries.length - 1)];
      if (!block) return;
      const node = editor.view.nodeDOM(block.pos);
      if (!(node instanceof HTMLElement)) return;
      const rect = node.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
      setAnchor({ index: Math.min(index, entries.length - 1), top: rect.top - hostRect.top, bottom: rect.bottom - hostRect.top, viewportTop: rect.top, viewportBottom: rect.bottom, left: rect.left });
    };
    const indexAt = (target: EventTarget | null) => {
      let element = target instanceof Element ? target : null;
      while (element && element.parentElement !== editor.view.dom) element = element.parentElement;
      if (!element) return -1;
      return topLevelBlocks(editor.state.doc).findIndex(block => editor.view.nodeDOM(block.pos) === element);
    };
    const pointer = (event: PointerEvent) => { if (manual !== null || actions || dragged.current) return; const index = indexAt(event.target); if (index >= 0) { hovered.current = index; position(index); } };
    const refresh = () => position(open && manual === null ? snapshot.active : hovered.current ?? snapshot.active);
    let frame = requestAnimationFrame(refresh);
    const transaction = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(refresh); };
    const dragover = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(MIME)) return;
      event.preventDefault(); event.stopPropagation();
      const index = indexAt(event.target);
      const entries = topLevelBlocks(editor.state.doc);
      const node = entries[index] && editor.view.nodeDOM(entries[index].pos);
      if (node instanceof HTMLElement) { const rect = node.getBoundingClientRect(); setDropLine((event.clientY > (rect.top + rect.bottom) / 2 ? rect.bottom : rect.top) - host.getBoundingClientRect().top); }
    };
    const drop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(MIME)) return;
      event.preventDefault(); event.stopPropagation(); setDropLine(null);
      const source = dragged.current; dragged.current = null;
      if (!source || source.doc !== editor.state.doc) return;
      const entries = topLevelBlocks(editor.state.doc);
      const index = indexAt(event.target);
      const node = entries[index] && editor.view.nodeDOM(entries[index].pos);
      if (!(node instanceof HTMLElement)) return;
      const rect = node.getBoundingClientRect();
      const slot = index + (event.clientY > (rect.top + rect.bottom) / 2 ? 1 : 0);
      const destination = slot - (source.index < slot ? 1 : 0);
      const tr = moveEditorBlock(editor.state, source.index, Math.max(0, Math.min(destination, entries.length - 1)));
      if (tr) { editor.view.dispatch(tr); hovered.current = null; }
    };
    host.addEventListener("pointermove", pointer);
    host.addEventListener("dragover", dragover, true);
    host.addEventListener("drop", drop, true);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    const observer = new ResizeObserver(transaction); observer.observe(host);
    editor.on("transaction", transaction);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); editor.off("transaction", transaction); host.removeEventListener("pointermove", pointer); host.removeEventListener("dragover", dragover, true); host.removeEventListener("drop", drop, true); window.removeEventListener("resize", refresh); window.removeEventListener("scroll", refresh, true); };
  }, [editor, surface, snapshot.active, manual, actions, open]);
  const insert = useCallback((node: JSONContent) => {
    const entries = topLevelBlocks(editor.state.doc);
    const index = manual ?? editor.state.selection.$from.index(0);
    const block = entries[index];
    if (!block) return;
    const replacing = manual === null && snapshot.slash !== null;
    const from = replacing ? block.pos : block.pos + block.node.nodeSize;
    const to = replacing ? block.pos + block.node.nodeSize : from;
    const atom = ["image", "horizontalRule", "campaignStatblock", "table"].includes(node.type ?? "");
    const content = atom ? [node, { type: "paragraph" }] : [node];
    editor.chain().focus().insertContentAt({ from, to }, content).command(({ tr }) => { tr.setSelection(Selection.near(tr.doc.resolve(Math.min(from + 1, tr.doc.content.size)), 1)); return true; }).run();
    setManual(null); setDismissed(null); setActions(false); hovered.current = null;
    editor.view.focus();
  }, [editor, manual, snapshot.slash]);
  if (!anchor) return null;
  return <>
    <div className="block-gutter absolute left-1 z-20 flex items-center rounded-md bg-zinc-950/90 text-zinc-500" style={{ top: Math.max(8, anchor.top + 3) }} >
      <button type="button" onMouseDown={event => event.preventDefault()} aria-label={`Insert block after block ${anchor.index + 1}`} title="Add a block" onClick={() => { setManual(anchor.index); setActions(false); }} className="rounded p-1 hover:bg-zinc-800 hover:text-amber-300"><Plus size={14} /></button>
      <button type="button" aria-label={`Block ${anchor.index + 1} actions`} title="Drag or open block actions" draggable onDragStart={event => { dragged.current = { index: anchor.index, doc: editor.state.doc }; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData(MIME, String(anchor.index)); }} onDragEnd={() => { dragged.current = null; setDropLine(null); }} onClick={() => { setActions(!actions); setManual(null); }} className="cursor-grab rounded p-1 hover:bg-zinc-800 hover:text-zinc-200"><GripVertical size={14} /></button>
    </div>
    {dropLine !== null && <div className="pointer-events-none absolute left-14 right-4 z-20 h-0.5 bg-amber-500" style={{ top: dropLine }} />}
    {actions && <div ref={actionMenu} role="group" aria-label="Block actions" className="absolute left-2 z-40 grid gap-1 rounded-lg border border-zinc-700 bg-zinc-900 p-2 shadow-xl" style={{ top: anchor.top + 30 }} onMouseDown={event => event.preventDefault()} onKeyDown={event => { if (event.key === "Escape") setActions(false); }}>
      {[{ label: "Move block up", icon: ArrowUp, disabled: anchor.index === 0, tr: () => moveEditorBlock(editor.state, anchor.index, anchor.index - 1) }, { label: "Move block down", icon: ArrowDown, disabled: anchor.index === snapshot.count - 1, tr: () => moveEditorBlock(editor.state, anchor.index, anchor.index + 1) }, { label: "Duplicate block", icon: Copy, disabled: false, tr: () => duplicateEditorBlock(editor.state, anchor.index) }, { label: "Delete block", icon: Trash2, disabled: false, tr: () => deleteEditorBlock(editor.state, anchor.index) }].map(action => <button type="button" key={action.label} disabled={action.disabled} onClick={() => { const tr = action.tr(); if (tr) editor.view.dispatch(tr); setActions(false); editor.view.focus(); hovered.current = null; }} className={`flex items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-zinc-800 disabled:opacity-25 ${action.label === "Delete block" ? "text-red-400" : "text-zinc-300"}`}><action.icon size={13} />{action.label}</button>)}
    </div>}
    {open && <BlockMenu worldId={worldId} key={manual === null ? slashKey : `manual-${manual}`} editor={editor} query={manual === null ? snapshot.slash?.slice(1) ?? "" : ""} blocks={blocks} anchor={anchor} onInsert={insert} onClose={close} manual={manual !== null} />}
  </>;
}
