"use client";

import { generateJSON } from "@tiptap/core";
import { upgradeLegacyLinks, type LinkableArticle } from "@/lib/article-links";
import { useRef, useState } from "react";
import { useEditor, EditorContent, type JSONContent } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import { Bold, Italic, Strikethrough, List, ListOrdered, Undo, Redo, Quote } from "lucide-react";
import { BlockControls } from "./BlockControls";
import { contentExtensions } from "./content-extensions";
import { RpgBlockItem } from "@/lib/rpg";
import { VariableCollectionItem } from "@/types";

interface TipTapEditorProps {
  worldId?: string;
  contentHtml?: string;
  contentJson?: string | null;
  onChange: (html: string, json: JSONContent) => void;
  onSnapshot?: (snapshot: { html: string; json: JSONContent }) => void;
  availableArticles?: LinkableArticle[];
  variableCollections?: VariableCollectionItem[];
  availableBlocks?: RpgBlockItem[];
}
export function TipTapEditor({ worldId, contentHtml = "", contentJson, onChange, onSnapshot, availableArticles = [], variableCollections = [], availableBlocks = [] }: TipTapEditorProps) {
  const surface = useRef<HTMLDivElement>(null);
  const [initialContent] = useState(() => {
    try { const doc = contentJson ? JSON.parse(contentJson) : null; if (doc?.type === "doc" && Array.isArray(doc.content)) return upgradeLegacyLinks(doc as JSONContent, availableArticles); } catch { /* Older articles can use their cached HTML. */ }
    return typeof document === "undefined" ? contentHtml : upgradeLegacyLinks(generateJSON(contentHtml, contentExtensions(availableBlocks, availableArticles)), availableArticles);
  });
  const editor = useEditor({
    extensions: [...contentExtensions(availableBlocks, availableArticles, true), Placeholder.configure({ placeholder: "Write your lore, or type / to choose a block." })],
    content: initialContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: "block-editor focus:outline-none min-h-[380px] text-zinc-200 text-sm leading-relaxed", role: "textbox", "aria-label": "Article content", "aria-multiline": "true" } },
    onCreate: ({ editor }) => onSnapshot?.({ html: editor.getHTML(), json: editor.getJSON() }),
    onUpdate: ({ editor }) => { const html = editor.getHTML(); const json = editor.getJSON(); onSnapshot?.({ html, json }); onChange(html, json); },
  });
  if (!editor) return <div className="min-h-96 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900 p-6 text-sm text-zinc-500">Opening the block editor…</div>;
  const tools = [
    { label: "Bold", icon: Bold, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", icon: Italic, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Strikethrough", icon: Strikethrough, active: editor.isActive("strike"), run: () => editor.chain().focus().toggleStrike().run() },
    { label: "Bullet list", icon: List, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", icon: ListOrdered, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Quote", icon: Quote, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];
  return <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 shadow-xl focus-within:border-zinc-600">
    <div className="flex flex-wrap items-center gap-1 rounded-t-xl border-b border-zinc-800 bg-zinc-900 p-2 text-zinc-400" role="toolbar" aria-label="Text formatting">
      {tools.map(tool => <button key={tool.label} type="button" aria-label={tool.label} title={tool.label} aria-pressed={tool.active} onMouseDown={event => event.preventDefault()} onClick={tool.run} className={`rounded p-2 hover:bg-zinc-800 hover:text-zinc-100 ${tool.active ? "bg-zinc-800 text-amber-400" : ""}`}><tool.icon size={15} /></button>)}
      <select aria-label="Text style" value={editor.isActive("heading") ? String(editor.getAttributes("heading").level) : "paragraph"} onChange={event => { const value = event.target.value; if (value === "paragraph") editor.chain().focus().setParagraph().run(); else editor.chain().focus().setHeading({ level: Number(value) as 1 | 2 | 3 }).run(); }} className="mx-1 rounded border border-zinc-700 bg-zinc-950 p-1.5 text-xs"><option value="paragraph">Text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option></select>
      <button type="button" aria-label="Link an article" title="Search articles with @" onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().insertContent(" @").run()} className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs">@ Article</button>
      {variableCollections.length > 0 && <select aria-label="Insert a variable" value="" onChange={event => { if (event.target.value) editor.chain().focus().insertContent({ type: "text", text: event.target.value }).run(); }} className="max-w-36 rounded border border-zinc-700 bg-zinc-950 p-1.5 text-xs"><option value="">Variable</option>{variableCollections.flatMap(collection => collection.variables.map(variable => <option key={variable.id} value={`[${collection.prefix}:${variable.key}]`}>{collection.prefix}:{variable.key}</option>))}</select>}
      <div className="ml-auto flex"><button type="button" aria-label="Undo" title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()} className="rounded p-2 hover:bg-zinc-800 disabled:opacity-25"><Undo size={15} /></button><button type="button" aria-label="Redo" title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()} className="rounded p-2 hover:bg-zinc-800 disabled:opacity-25"><Redo size={15} /></button></div>
    </div>
    {editor.isActive("table") && <div role="toolbar" aria-label="Table controls" className="flex flex-wrap gap-2 border-b border-zinc-800 px-3 py-2 text-xs text-amber-400">{[{ label: "Add row", run: () => editor.chain().focus().addRowAfter().run() }, { label: "Add column", run: () => editor.chain().focus().addColumnAfter().run() }, { label: "Remove row", run: () => editor.chain().focus().deleteRow().run() }, { label: "Remove column", run: () => editor.chain().focus().deleteColumn().run() }, { label: "Delete table", run: () => editor.chain().focus().deleteTable().run() }].map(tool => <button type="button" key={tool.label} onClick={tool.run} className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-900">{tool.label}</button>)}</div>}
    <div ref={surface} className="editor-surface relative"><EditorContent editor={editor} /><BlockControls worldId={worldId} editor={editor} surface={surface} blocks={availableBlocks} /></div>
    <p className="rounded-b-xl border-t border-zinc-800 px-4 py-2 text-[11px] text-zinc-500">Type / for blocks or @ to link an article. Hover a block for its + and drag handle. Use the handle menu to move, duplicate or delete.</p>
  </div>;
}
