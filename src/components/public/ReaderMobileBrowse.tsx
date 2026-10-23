import { ChevronDown, FolderTree } from "lucide-react";
import { ReaderCategoryTree } from "@/components/public/ReaderCategoryTree";
import type { LinkableReaderArticle, ReaderType } from "@/lib/category-tree";

interface ReaderCategory {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  icon?: string;
}

export function ReaderMobileBrowse({
  categories,
  articles,
  worldSlug,
  currentArticleId,
  currentPage = "article",
  readerType = "public",
}: {
  categories: ReaderCategory[];
  articles: LinkableReaderArticle[];
  worldSlug: string;
  currentArticleId?: string;
  currentPage?: "home" | "article";
  readerType?: ReaderType;
}) {
  return (
    <details className="group lg:hidden rounded-xl border border-zinc-800 bg-zinc-950/60">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-zinc-200 hover:bg-zinc-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <FolderTree className="h-4 w-4 text-amber-400" aria-hidden="true" />
          Browse articles
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-zinc-800 p-2">
        <ReaderCategoryTree
          categories={categories}
          articles={articles}
          worldSlug={worldSlug}
          currentArticleId={currentArticleId}
          readerType={readerType}
          currentPage={currentPage}
        />
      </div>
    </details>
  );
}
