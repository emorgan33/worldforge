import type { CategoryItem } from "@/types";

type Category = Pick<CategoryItem, "id" | "name" | "parentId" | "order">;
export function sortOrdered<T extends { id: string; order: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}
export function descendantIds(categories: Category[], id: string): Set<string> {
  const found = new Set([id]);
  const queue = [id];
  for (let i = 0; i < queue.length; i++) for (const category of categories) {
    if (category.parentId === queue[i] && !found.has(category.id)) { found.add(category.id); queue.push(category.id); }
  }
  return found;
}
export function categoryAncestors(categories: Category[], categoryId: string | null): Category[] {
  const ancestors: Category[] = [];
  const map = new Map(categories.map(category => [category.id, category]));
  let current = categoryId ? map.get(categoryId) : undefined;
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    ancestors.unshift(current);
    current = current.parentId ? map.get(current.parentId) : undefined;
  }
  return ancestors;
}
export function categoryPathLabel(categories: Category[], categoryId: string | null): string {
  const path = categoryAncestors(categories, categoryId).map(category => category.name).join(" / ");
  return path || "Uncategorized";
}
export interface LinkableReaderArticle {
  id: string;
  slug: string;
  title: string;
  template: string;
  excerpt?: string | null;
  order?: number;
  categoryId?: string | null;
}
export type ReaderType = "public" | "campaign";
export function readerWorldHref(worldSlug: string, readerType: ReaderType = "public"): string {
  return `/${readerType === "campaign" ? "c" : "w"}/${worldSlug}`;
}
export function readerArticleHref(worldSlug: string, articleSlug: string, readerType: ReaderType = "public"): string {
  return `${readerWorldHref(worldSlug, readerType)}/a/${articleSlug}`;
}
export function searchReaderArticles<T extends { title: string; excerpt?: string | null }>(query: string, articles: T[]): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return articles
    .filter(article => {
      const haystack = `${article.title} ${article.excerpt ?? ""}`.toLocaleLowerCase();
      return terms.every(term => haystack.includes(term));
    })
    .sort((a, b) => {
      const aStarts = a.title.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase());
      const bStarts = b.title.toLocaleLowerCase().startsWith(query.trim().toLocaleLowerCase());
      return Number(bStarts) - Number(aStarts) || a.title.localeCompare(b.title);
    });
}
export function categoryOptions(categories: Category[]): { id: string; label: string }[] {
  const result: { id: string; label: string }[] = [];
  const seen = new Set<string>();
  function walk(parentId: string | null, path: string[]) {
    for (const category of sortOrdered(categories.filter(item => item.parentId === parentId))) {
      if (seen.has(category.id)) continue;
      seen.add(category.id);
      const nextPath = [...path, category.name];
      result.push({ id: category.id, label: nextPath.join(" / ") });
      walk(category.id, nextPath);
    }
  }
  walk(null, []);
  return result;
}
export function categoryMovePlan(categories: Category[], id: string, parentId: string | null, beforeId?: string | null) {
  const category = categories.find(item => item.id === id);
  if (!category) throw new Error("Category not found");
  if (parentId !== null && !categories.some(item => item.id === parentId)) throw new Error("Parent category not found in this world");
  if (parentId !== null && descendantIds(categories, id).has(parentId)) throw new Error("A category cannot be moved inside itself or one of its descendants");
  if (beforeId === id && category.parentId === parentId) return [];
  const destination = sortOrdered(categories.filter(item => item.parentId === parentId && item.id !== id));
  const index = beforeId == null ? destination.length : destination.findIndex(item => item.id === beforeId);
  if (index < 0) throw new Error("The reorder target must belong to the destination category");
  destination.splice(index, 0, { ...category, parentId });
  const source = category.parentId === parentId ? [] : sortOrdered(categories.filter(item => item.parentId === category.parentId && item.id !== id));
  return [...source.map((item, order) => ({ id: item.id, parentId: item.parentId, order })), ...destination.map((item, order) => ({ id: item.id, parentId, order }))];
}

