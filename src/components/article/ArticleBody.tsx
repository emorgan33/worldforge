"use client";

import { generateJSON } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { PresentationSpan } from "@/lib/editor-nodes";
import { upgradeLegacyLinks, type LinkableArticle } from "@/lib/article-links";
import { RpgBlockItem } from "@/lib/rpg";
import { contentExtensions } from "@/components/editor/content-extensions";

export function ArticleBody({ html, blocks, articles, onNavigateArticle }: { html: string; blocks: RpgBlockItem[]; articles: LinkableArticle[]; onNavigateArticle: (id: string) => void }) {
  const extensions = [...contentExtensions(blocks, articles), PresentationSpan];
  const editor = useEditor({
    extensions,
    content: typeof document === "undefined" ? html : upgradeLegacyLinks(generateJSON(html, extensions), articles),
    editable: false,
    immediatelyRender: false,
    editorProps: { attributes: { class: "article-rich-content focus:outline-none" } },
  }, [html, blocks, articles]);
  const followLink = (target: EventTarget | null) => {
    const element = target instanceof Element ? target.closest<HTMLElement>("[data-article-id]") : null;
    const id = element?.dataset.articleId;
    if (id && articles.some(article => article.id === id)) { onNavigateArticle(id); return true; }
    return false;
  };
  return editor ? <div onClick={event => { if (followLink(event.target)) event.preventDefault(); }} onKeyDown={event => { if (event.key === "Enter" && followLink(event.target)) event.preventDefault(); }}><EditorContent editor={editor} /></div> : <p className="text-sm text-zinc-500">Opening article…</p>;
}
