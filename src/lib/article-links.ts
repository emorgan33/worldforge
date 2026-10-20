import type { JSONContent } from "@tiptap/core";

export interface LinkableArticle { id: string; title: string; template?: string; category?: { name: string } | null }
export const legacyLinkPattern = /@\[([^\]]+)\]/g;

export function uniqueTitleTarget(title: string, articles: LinkableArticle[]) {
  const matches = articles.filter(article => article.title === title);
  return matches.length === 1 ? matches[0] : undefined;
}

export function searchArticleLinks(query: string, articles: LinkableArticle[]) {
  const term = query.trim().toLocaleLowerCase();
  return articles.filter(article => article.title.toLocaleLowerCase().includes(term))
    .sort((a, b) => Number(!a.title.toLocaleLowerCase().startsWith(term)) - Number(!b.title.toLocaleLowerCase().startsWith(term)) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, 12);
}

/** Upgrade unambiguous legacy text while retaining formatting and nested block structure. */
export function upgradeLegacyLinks(doc: JSONContent, articles: LinkableArticle[]): JSONContent {
  function visit(node: JSONContent): JSONContent[] {
    if (node.type === "codeBlock" || node.marks?.some(mark => mark.type === "code" || mark.type === "link")) return [node];
    if (node.type === "text" && node.text) {
      const output: JSONContent[] = []; let offset = 0;
      for (const match of node.text.matchAll(legacyLinkPattern)) {
        const target = uniqueTitleTarget(match[1], articles);
        if (!target) continue;
        if (match.index! > offset) output.push({ ...node, text: node.text.slice(offset, match.index) });
        output.push({ type: "articleLink", attrs: { articleId: target.id, label: target.title }, marks: node.marks });
        offset = match.index! + match[0].length;
      }
      if (!output.length) return [node];
      if (offset < node.text.length) output.push({ ...node, text: node.text.slice(offset) });
      return output;
    }
    return [{ ...node, ...(node.content ? { content: node.content.flatMap(visit) } : {}) }];
  }
  return visit(doc)[0];
}

export function collectJsonReferences(doc: JSONContent) {
  const ids = new Set<string>(); const titles = new Set<string>();
  function visit(node: JSONContent) {
    if (node.type === "codeBlock") return;
    if (node.type === "articleLink" && typeof node.attrs?.articleId === "string") ids.add(node.attrs.articleId);
    if (node.type === "text" && !node.marks?.some(mark => mark.type === "code" || mark.type === "link")) {
      for (const match of (node.text || "").matchAll(legacyLinkPattern)) titles.add(match[1]);
    }
    node.content?.forEach(visit);
  }
  visit(doc); return { ids, titles };
}
