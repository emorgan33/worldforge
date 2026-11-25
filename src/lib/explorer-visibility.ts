export type ExplorerView = string;

export function isArticleView(view: ExplorerView): boolean {
  return view === "article" || view === "editor" || view === "manager";
}

/** Pin keeps the explorer across tools; an explicit collapse always wins. */
export function resolveExplorerVisibility({ view, pinned, collapsed, forcedOpen = false }: {
  view: ExplorerView;
  pinned: boolean;
  collapsed: boolean;
  forcedOpen?: boolean;
}): boolean {
  return !collapsed && (pinned || isArticleView(view) || forcedOpen);
}
