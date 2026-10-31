import { parseDocument } from "htmlparser2";
import type { VariableCollectionItem, VariableItem } from "@/types";

type HtmlNode = ReturnType<typeof parseDocument>["children"][number];
const macroPattern = /\[([a-zA-Z0-9_-]{2,10}):([a-zA-Z0-9_-]+)\]/g;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

function safeHref(value: string): string | null {
  const href = value.trim();
  if (!href || /[\u0000-\u0020\u007f-\u009f\\]/.test(href)) return null;
  if (/^(?:\/(?!\/)|#)/.test(href)) return href;
  if (/^mailto:[^?]+(?:\?.*)?$/i.test(href)) return href;
  if (!/^https?:\/\//i.test(href)) return null;
  try { return new URL(href).hostname ? href : null; } catch { return null; }
}

const fragmentTags = new Set(["p", "div", "span", "br", "hr", "strong", "b", "em", "i", "u", "s", "del", "sub", "sup", "code", "pre", "blockquote", "ul", "ol", "li", "a"]);

/** Rebuild rich fragments from formatting tags and safe links only. */
export function renderVariableFragment(value: string): string {
  function render(nodes: HtmlNode[], depth = 0): string {
    if (depth > 50) return "";
    return nodes.map(node => {
      if (node.type === "text") return escapeHtml(node.data);
      if (node.type !== "tag" || !fragmentTags.has(node.name)) return "";
      const content = render(node.children, depth + 1);
      const title = node.attribs.title ? ` title="${escapeHtml(node.attribs.title)}"` : "";
      if (node.name === "a") {
        const href = safeHref(node.attribs.href || "");
        return href ? `<a href="${escapeHtml(href)}"${title} target="_blank" rel="noopener noreferrer">${content}</a>` : content;
      }
      if (node.name === "br" || node.name === "hr") return `<${node.name}>`;
      return `<${node.name}${title}>${content}</${node.name}>`;
    }).join("");
  }
  return render(parseDocument(value).children);
}

function renderVariable(variable: VariableItem): string {
  const value = escapeHtml(variable.value);
  const title = escapeHtml(variable.title || variable.value);
  switch (variable.type) {
    case "TERM_SIMPLE":
      return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-help" title="${escapeHtml(variable.description || variable.value)}">${title}</span>`;
    case "TERM_ADVANCED":
      return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 cursor-pointer shadow-sm hover:bg-indigo-500/25 transition-all" title="${value}">${escapeHtml(variable.title || variable.key)}: ${value}</span>`;
    case "RENDERED_FRAGMENT":
      return renderVariableFragment(variable.value);
    case "LINK": {
      const href = safeHref(variable.value);
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:text-sky-300 underline underline-offset-2">${title}</a>` : title;
    }
    case "NUMBER":
      return `<span class="font-mono text-emerald-400 font-semibold">${value}</span>`;
    default:
      return value;
  }
}

/** Text input is escaped; article HTML is interpolated only within text nodes. */
export function interpolateVariables(
  content: string,
  collections: VariableCollectionItem[],
  format: "html" | "text" = "html",
): string {
  if (!content) return "";
  function interpolateText(text: string): string {
    let result = "";
    let offset = 0;
    for (const match of text.matchAll(macroPattern)) {
      result += escapeHtml(text.slice(offset, match.index));
      const collection = collections.find(c => c.prefix.toLowerCase() === match[1].toLowerCase());
      const variable = collection?.variables.find(v => v.key.toLowerCase() === match[2].toLowerCase());
      result += variable ? renderVariable(variable) : escapeHtml(match[0]);
      offset = match.index! + match[0].length;
    }
    return result + escapeHtml(text.slice(offset));
  }
  if (format === "text") return interpolateText(content);

  // Preserve article markup and attributes verbatim. A macro in an attribute
  // must never become HTML, and replacements must not be interpolated again.
  const replacements: { start: number; end: number; html: string }[] = [];
  function visit(nodes: HtmlNode[]) {
    for (const node of nodes) {
      if (node.type === "text" && /\[[a-zA-Z0-9_-]{2,10}:[a-zA-Z0-9_-]+\]/.test(node.data)) {
        replacements.push({ start: node.startIndex!, end: node.endIndex! + 1, html: interpolateText(node.data) });
      } else if (node.type === "tag" && !["svg", "math", "template"].includes(node.name)) visit(node.children);
    }
  }
  visit(parseDocument(content, { withStartIndices: true, withEndIndices: true }).children);
  let result = content;
  for (const replacement of replacements.reverse()) {
    result = result.slice(0, replacement.start) + replacement.html + result.slice(replacement.end);
  }
  return result;
}
