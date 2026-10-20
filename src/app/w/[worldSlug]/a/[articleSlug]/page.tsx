/* eslint-disable @next/next/no-img-element */
import { WorldPresentation } from "@/components/public/WorldPresentation";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicArticle, publicBacklinks } from "@/lib/public-world";
import { PublicRichText } from "@/components/public/PublicRichText";
import { ArticleQuickFacts } from "@/components/article/ArticleQuickFacts";
import type { ArticleTemplateType } from "@/types";
import { documentReferences } from "@/lib/public-content";
import { categoryAncestors } from "@/lib/category-tree";
import { ReaderBreadcrumbs } from "@/components/public/ReaderBreadcrumbs";
import { ReaderSearch } from "@/components/public/ReaderSearch";
import { ReaderCategoryTree } from "@/components/public/ReaderCategoryTree";

async function ArticleReader({ params }: { params: Promise<{ worldSlug: string; articleSlug: string }> }) {
  const { worldSlug, articleSlug } = await params; const data = await publicArticle(worldSlug, articleSlug); if (!data) notFound();
  const { world, summary } = data;
  const links = world.articles.map(article => ({ id: article.id, title: article.title, href: `/w/${world.slug}/a/${article.slug}` }));
  const references = documentReferences(data.doc, "articleLink", "articleId");
  const backlinkIds = await publicBacklinks(world.id, world.articles, summary.id);

  const ancestors = categoryAncestors(world.categories, summary.categoryId);
  const breadcrumbs = [
    { label: world.title, href: `/w/${world.slug}` },
    ...ancestors.map(category => ({ label: category.name })),
    { label: summary.title },
  ];

  return <WorldPresentation appearance={world.appearance}><main className="space-y-7">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800 pb-4">
      <ReaderBreadcrumbs items={breadcrumbs} />
      <div className="sm:w-64">
        <ReaderSearch worldSlug={world.slug} articles={world.articles} />
      </div>
    </div>

    {data.coverImage && <img src={data.coverImage} alt="" className="h-72 w-full rounded-2xl object-cover" />}
    <header><p className="text-xs uppercase tracking-wider text-amber-400">{summary.template}</p><h1 className="mt-2 font-serif text-4xl">{summary.title}</h1>{summary.excerpt && <p className="mt-3 text-zinc-400">{summary.excerpt}</p>}</header>

    <div className="world-article-layout grid gap-8">
      <article className="min-w-0">
        <PublicRichText doc={data.doc} links={links} blocks={data.blocks} />
        <div className="mt-10 grid gap-5 border-t border-zinc-800 pt-6 sm:grid-cols-2">
          {[{ title: "References", ids: references }, { title: "Backlinks", ids: backlinkIds }].map(group => (
            <section key={group.title}>
              <h2 className="text-sm font-bold text-amber-300">{group.title}</h2>
              <ul className="mt-3 space-y-2">
                {links.filter(link => group.ids.has(link.id)).map(link => (
                  <li key={link.id}><a href={link.href} className="text-sm text-indigo-300 hover:underline">{link.title}</a></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </article>

      <aside className="space-y-6">
        <ArticleQuickFacts template={summary.template as ArticleTemplateType} system={data.system} metadata={data.metadata} blocks={data.blocks} />
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400/90">World Contents</h2>
          <ReaderCategoryTree categories={world.categories} articles={world.articles} worldSlug={world.slug} currentArticleId={summary.id} />
        </div>
      </aside>
    </div>
  </main></WorldPresentation>;
}
export default function PublicArticlePage(props: { params: Promise<{ worldSlug: string; articleSlug: string }> }) { return <Suspense fallback={<p className="p-8 text-zinc-400">Opening article…</p>}><ArticleReader {...props} /></Suspense>; }

