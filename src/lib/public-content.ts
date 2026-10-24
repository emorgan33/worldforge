import type { JSONContent } from "@tiptap/core";
import { parseDocument } from "htmlparser2";
import { imageAssetId, isImageReference } from "./assets";
import { legacyLinkPattern, uniqueTitleTarget, type LinkableArticle } from "./article-links";

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
const textNode = (text: string): JSONContent => ({ type: "text", text });
function htmlNodes(nodes: HtmlNode[]): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    if (node.type === "text") return [textNode(node.data)];
    if (node.type !== "tag") return [];
    const { name, attribs: attrs, children } = node;
    if (["iframe", "object", "embed", "template", "form", "input", "button"].includes(name)) return [];
    if (name === "img") return [{ type: "image", attrs: { src: attrs.src, alt: attrs.alt } }];
    if (name === "span" && attrs["data-article-id"]) return [{ type: "articleLink", attrs: { articleId: attrs["data-article-id"] } }];
    if (name === "section" && attrs["data-statblock-id"]) return [{ type: "campaignStatblock", attrs: { blockId: attrs["data-statblock-id"] } }];
    if (["aside", "div"].includes(name) && (attrs["data-callout"] || /gm-secret-box|read-aloud-box/.test(attrs.class || ""))) return [{ type: "campaignCallout", attrs: { kind: attrs.class?.includes("gm-secret-box") ? "gmNote" : attrs["data-callout"] || "readAloud" }, content: htmlNodes(children) }];
    const content = htmlNodes(children);
    const types: Record<string, string> = { p: "paragraph", blockquote: "blockquote", ul: "bulletList", ol: "orderedList", li: "listItem", table: "table", tr: "tableRow", td: "tableCell", th: "tableHeader", pre: "codeBlock", hr: "horizontalRule", br: "hardBreak", h1: "heading", h2: "heading", h3: "heading", h4: "heading" };
    if (types[name]) return [{ type: types[name], ...(name.startsWith("h") && name !== "hr" ? { attrs: { level: Number(name[1]) } } : {}), content }];
    const marks: Record<string, string> = { strong: "bold", b: "bold", em: "italic", i: "italic", s: "strike", del: "strike", code: "code", a: "link" };
    if (marks[name]) return content.map(child => ({ ...child, marks: [...(child.marks || []), { type: marks[name], ...(name === "a" ? { attrs: { href: attrs.href } } : {}) }] }));
    return content;
  });
}
export function parseArticleDocument(json?: string | null, html?: string | null): JSONContent {
  try { const doc = json ? JSON.parse(json) : null; if (doc?.type === "doc" && Array.isArray(doc.content)) return doc; } catch {}
  return { type: "doc", content: htmlNodes(parseDocument(html || "").children) };
}
export function localAssetId(src: string) {
  const value = src.trim();
  const relative = imageAssetId(value); if (relative) return relative;
  try { return imageAssetId(new URL(value).pathname); } catch { return null; }
}
export function publicImage(src: unknown, assetIds: Set<string>) {
  if (typeof src !== "string" || !src || !isImageReference(src)) return null;
  const id = localAssetId(src); return id && !assetIds.has(id) ? null : src;
}
const containers = new Set(["doc", "paragraph", "heading", "blockquote", "bulletList", "orderedList", "listItem", "table", "tableRow", "tableCell", "tableHeader", "codeBlock", "campaignCallout"]);
/** Produce a new allowlisted document; no private labels, IDs or GM subtrees enter client props/HTML. */
export function publicDocument(doc: JSONContent, articles: LinkableArticle[], assetIds: Set<string>, blockIds: Set<string>): JSONContent {
  function visit(node: JSONContent, depth = 0, code = false): JSONContent[] {
    if (!node || depth > 50 || typeof node.type !== "string") return [];
    if (node.type === "campaignCallout" && node.attrs?.kind === "gmNote") return [];
    if (node.type === "articleLink") {
      const article = articles.find(article => article.id === node.attrs?.articleId);
      return article ? [{ type: "articleLink", attrs: { articleId: article.id, label: article.title } }] : [textNode("Unpublished article")];
    }
    if (node.type === "campaignStatblock") return blockIds.has(node.attrs?.blockId) ? [{ type: "campaignStatblock", attrs: { blockId: node.attrs!.blockId } }] : [textNode("Statblock unavailable")];
    if (node.type === "image") { const src = publicImage(node.attrs?.src, assetIds); return src ? [{ type: "image", attrs: { src, alt: typeof node.attrs?.alt === "string" ? node.attrs.alt : "" } }] : []; }
    if (["horizontalRule", "hardBreak"].includes(node.type)) return [{ type: node.type }];
    if (node.type === "text") {
      if (typeof node.text !== "string") return [];
      const marks = (Array.isArray(node.marks) ? node.marks : []).flatMap(mark => {
        if (["bold", "italic", "strike", "code"].includes(mark.type)) return [{ type: mark.type }];
        if (mark.type === "link" && typeof mark.attrs?.href === "string" && /^https?:\/\//i.test(mark.attrs.href)) return [{ type: "link", attrs: { href: mark.attrs.href } }];
        return [];
      });
      if (code || marks.some(mark => mark.type === "code")) return [{ type: "text", text: node.text, marks }];
      const result: JSONContent[] = []; let offset = 0;
      for (const match of node.text.matchAll(legacyLinkPattern)) {
        if (match.index! > offset) result.push({ type: "text", text: node.text.slice(offset, match.index), marks });
        const target = uniqueTitleTarget(match[1], articles);
        result.push(target ? { type: "articleLink", attrs: { articleId: target.id, label: target.title } } : textNode("Unpublished article"));
        offset = match.index! + match[0].length;
      }
      if (offset < node.text.length) result.push({ type: "text", text: node.text.slice(offset), marks });
      return result;
    }
    if (!containers.has(node.type)) return [];
    const content = Array.isArray(node.content) ? node.content.flatMap(child => visit(child, depth + 1, code || node.type === "codeBlock")) : [];
    return [{ type: node.type, ...(node.type === "heading" ? { attrs: { level: Math.min(3, Math.max(1, Number(node.attrs?.level) || 2)) } } : node.type === "campaignCallout" ? { attrs: { kind: node.attrs?.kind === "readAloud" ? "readAloud" : "note" } } : {}), content }];
  }
  return { type: "doc", content: visit(doc)[0]?.content || [] };
}
export function documentReferences(doc: JSONContent, type: string, attribute: string): Set<string> {
  const result = new Set<string>();
  function visit(node: JSONContent) { if (node.type === type && typeof node.attrs?.[attribute] === "string") result.add(node.attrs[attribute]); node.content?.forEach(visit); }
  visit(doc); return result;
}
