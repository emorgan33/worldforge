/* eslint-disable @next/next/no-img-element */
import React from "react";
import type { JSONContent } from "@tiptap/core";
import type { RpgBlockItem } from "@/lib/rpg";
import { StatblockCard } from "@/components/blocks/StatblockCard";
import { ReaderAdjacentCredit } from "./ReaderImageCredits";
import { imageAssetId } from "@/lib/assets";
import type { ReaderCredit } from "@/lib/stock-credits";
export function PublicRichText({ doc, links, blocks, credits = [] }: { doc: JSONContent; links: { id: string; title: string; href: string }[]; blocks: RpgBlockItem[]; credits?: ReaderCredit[] }) {
  function node(item: JSONContent, index: number): React.ReactNode {
    const children = item.content?.map(node);
    switch (item.type) {
      case "text": return <React.Fragment key={index}>{(item.marks || []).reduce<React.ReactNode>((text, mark) => mark.type === "bold" ? <strong>{text}</strong> : mark.type === "italic" ? <em>{text}</em> : mark.type === "strike" ? <s>{text}</s> : mark.type === "code" ? <code>{text}</code> : mark.type === "link" ? <a href={mark.attrs!.href} rel="noopener noreferrer">{text}</a> : text, item.text)}</React.Fragment>;
      case "articleLink": { const target = links.find(link => link.id === item.attrs?.articleId); return target ? <a key={index} href={target.href} className="article-link">{target.title}</a> : <span key={index}>Unpublished article</span>; }
      case "campaignStatblock": { const block = blocks.find(block => block.id === item.attrs?.blockId); return block ? <StatblockCard key={index} block={block} /> : null; }
      case "image": return <figure key={index} className="my-5"><img src={item.attrs!.src} alt={item.attrs!.alt || ""} loading="lazy" className="max-w-full rounded-lg" /><ReaderAdjacentCredit credits={credits} assetId={imageAssetId(item.attrs!.src)} /></figure>;
      case "paragraph": return <p key={index} className="my-3">{children}</p>;
      case "heading": return item.attrs?.level === 1 ? <h1 key={index} className="mt-6 text-3xl font-bold">{children}</h1> : item.attrs?.level === 3 ? <h3 key={index} className="mt-5 text-xl font-bold">{children}</h3> : <h2 key={index} className="mt-6 text-2xl font-bold">{children}</h2>;
      case "bulletList": return <ul key={index} className="list-disc pl-6">{children}</ul>;
      case "orderedList": return <ol key={index} className="list-decimal pl-6">{children}</ol>;
      case "listItem": return <li key={index}>{children}</li>;
      case "blockquote": return <blockquote key={index} className="my-5 border-l-4 border-amber-500 pl-5 italic">{children}</blockquote>;
      case "campaignCallout": return <aside key={index} data-callout={item.attrs?.kind} className="campaign-callout">{children}</aside>;
      case "codeBlock": return <pre key={index} className="my-4 overflow-auto rounded-lg bg-zinc-900 p-4"><code>{children}</code></pre>;
      case "horizontalRule": return <hr key={index} className="my-6 border-zinc-700" />;
      case "hardBreak": return <br key={index} />;
      case "table": return <div key={index} className="my-5 overflow-auto"><table className="w-full border-collapse border border-zinc-700"><tbody>{children}</tbody></table></div>;
      case "tableRow": return <tr key={index}>{children}</tr>;
      case "tableCell": return <td key={index} className="border border-zinc-700 p-2">{children}</td>;
      case "tableHeader": return <th key={index} className="border border-zinc-700 bg-zinc-900 p-2">{children}</th>;
      default: return <React.Fragment key={index}>{children}</React.Fragment>;
    }
  }
  return <div className="public-article-content leading-relaxed text-zinc-300">{doc.content?.map(node)}</div>;
}
