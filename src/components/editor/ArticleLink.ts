import { Node, mergeAttributes } from "@tiptap/core";
import { PluginKey } from "@tiptap/pm/state";
import Suggestion, { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion";
import { searchArticleLinks, type LinkableArticle } from "@/lib/article-links";

const pickerKey = new PluginKey("articleLinkPicker");
let pickerSequence = 0;

export const ArticleLink = Node.create<{ articles: LinkableArticle[]; suggestions: boolean }>({
  name: "articleLink", group: "inline", inline: true, atom: true, selectable: true,
  addOptions() { return { articles: [], suggestions: false }; },
  addAttributes() { return {
    articleId: { default: "", parseHTML: element => element.getAttribute("data-article-id"), renderHTML: attrs => ({ "data-article-id": attrs.articleId }) },
    label: { default: "Article", parseHTML: element => element.getAttribute("data-article-label") || element.textContent, renderHTML: attrs => ({ "data-article-label": attrs.label }) },
  }; },
  parseHTML() { return [{ tag: "span[data-article-id]", priority: 110 }]; },
  renderHTML({ node, HTMLAttributes }) {
    const article = this.options.articles.find(item => item.id === node.attrs.articleId);
    const label = article?.title || node.attrs.label || "Article";
    return ["span", mergeAttributes(HTMLAttributes, {
      class: `article-link${article ? "" : " article-link-missing"}`,
      ...(article ? { role: "link", tabindex: "0", title: `Open ${label}` } : { "aria-disabled": "true", title: "This article is unavailable in this world." }),
    }), article ? label : `${label} (missing article)`];
  },
  renderText({ node }) { return `@[${this.options.articles.find(item => item.id === node.attrs.articleId)?.title || node.attrs.label || "Article"}]`; },
  addProseMirrorPlugins() {
    if (!this.options.suggestions) return [];
    const articles = this.options.articles;
    return [Suggestion<LinkableArticle>({
      editor: this.editor, pluginKey: pickerKey, char: "@", allowSpaces: true,
      allowedPrefixes: [" ", "\n", "("],
      allow: ({ state, range }) => {
        const position = state.doc.resolve(range.from);
        return position.parent.type.name !== "codeBlock" && !position.marks().some(mark => ["code", "link"].includes(mark.type.name));
      },
      items: ({ query }) => searchArticleLinks(query, articles),
      command: ({ editor, range, props }) => {
        editor.chain().focus().insertContentAt(range, [
          { type: "articleLink", attrs: { articleId: props.id, label: props.title } },
          { type: "text", text: " " },
        ]).run();
      },
      render: () => {
        let popup: HTMLDivElement | null = null;
        let current: SuggestionProps<LinkableArticle> | null = null;
        let index = 0;
        const id = `article-link-picker-${++pickerSequence}`;
        const close = () => {
          popup?.remove(); popup = null;
          const dom = current?.editor.view.dom;
          dom?.removeAttribute("aria-controls"); dom?.removeAttribute("aria-activedescendant"); dom?.removeAttribute("aria-expanded");
          current = null;
          document.removeEventListener("mousedown", outside);
          window.removeEventListener("resize", position);
          window.removeEventListener("scroll", position, true);
        };
        const outside = (event: MouseEvent) => {
          if (current && event.target instanceof globalThis.Node && !popup?.contains(event.target) && !current.editor.view.dom.contains(event.target)) exitSuggestion(current.editor.view, pickerKey);
        };
        const position = () => {
          const rect = current?.clientRect?.();
          if (!popup || !rect) return;
          const width = Math.min(360, window.innerWidth - 16);
          popup.style.width = `${width}px`;
          popup.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
          const below = window.innerHeight - rect.bottom - 12;
          const above = rect.top - 12;
          const useAbove = below < 200 && above > below;
          popup.style.maxHeight = `${Math.max(60, Math.min(320, useAbove ? above : below))}px`;
          popup.style.top = `${useAbove ? Math.max(8, rect.top - popup.offsetHeight - 6) : rect.bottom + 6}px`;
        };
        const draw = (props: SuggestionProps<LinkableArticle>) => {
          current = props;
          if (!popup) {
            popup = document.createElement("div"); popup.id = id;
            popup.setAttribute("role", "listbox"); popup.setAttribute("aria-label", "Link an article");
            popup.className = "article-link-picker";
            document.body.appendChild(popup);
            document.addEventListener("mousedown", outside);
            window.addEventListener("resize", position);
            window.addEventListener("scroll", position, true);
          }
          popup.replaceChildren();
          const heading = document.createElement("div"); heading.className = "article-link-picker-heading";
          heading.textContent = "Link an article · ↑ ↓ Enter · Esc to close"; popup.appendChild(heading);
          if (!props.items.length) {
            const empty = document.createElement("p"); empty.className = "p-3 text-xs text-zinc-400";
            empty.textContent = "No matching articles. Keep typing to change the search."; popup.appendChild(empty);
          }
          props.items.forEach((article, itemIndex) => {
            const button = document.createElement("button"); button.type = "button"; button.id = `${id}-${itemIndex}`;
            button.setAttribute("role", "option"); button.setAttribute("aria-selected", String(itemIndex === index));
            button.className = "article-link-picker-option";
            const title = document.createElement("span"); title.textContent = article.title; button.appendChild(title);
            const detail = document.createElement("small"); detail.textContent = [article.template, article.category?.name, article.id.slice(0, 8)].filter(Boolean).join(" · "); button.appendChild(detail);
            button.onmousedown = event => { event.preventDefault(); props.command(article); };
            popup!.appendChild(button);
          });
          const dom = props.editor.view.dom;
          dom.setAttribute("aria-controls", id); dom.setAttribute("aria-expanded", "true");
          if (props.items.length) dom.setAttribute("aria-activedescendant", `${id}-${index}`); else dom.removeAttribute("aria-activedescendant");
          position(); popup.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
        };
        return {
          onStart: props => { index = 0; draw(props); },
          onUpdate: props => { index = 0; draw(props); },
          onExit: close,
          onKeyDown: ({ event, view }) => {
            if (event.key === "Escape") { exitSuggestion(view, pickerKey); return true; }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              if (current?.items.length) { index = (index + (event.key === "ArrowDown" ? 1 : -1) + current.items.length) % current.items.length; draw(current); } return true;
            }
            if (event.key === "Enter" && current?.items[index]) { current.command(current.items[index]); return true; }
            return false;
          },
        };
      },
    })];
  },
});
