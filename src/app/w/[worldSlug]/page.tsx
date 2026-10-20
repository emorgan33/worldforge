/* eslint-disable @next/next/no-img-element */
import { WorldPresentation } from "@/components/public/WorldPresentation";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicWorld } from "@/lib/public-world";
import { systemProfile } from "@/lib/rpg";
import { ReaderSearch } from "@/components/public/ReaderSearch";
import { ReaderCategoryTree } from "@/components/public/ReaderCategoryTree";

async function WorldReader({ params }: { params: Promise<{ worldSlug: string }> }) {
  const { worldSlug } = await params; const world = await publicWorld(worldSlug); if (!world) notFound();
  return <WorldPresentation appearance={world.appearance}><main className="space-y-8">
    {world.coverImage && <img src={world.coverImage} alt="" className="h-72 w-full rounded-2xl object-cover" />}
    <header>
      <p className="text-xs uppercase tracking-widest text-amber-400">{systemProfile(world.system).short}{world.system === "PF_2E" ? " · Remaster" : ""}</p>
      <h1 className="mt-3 font-serif text-5xl">{world.title}</h1>
      {world.description && <p className="mt-4 whitespace-pre-wrap text-zinc-400">{world.description}</p>}
    </header>

    <section aria-labelledby="public-search-heading" className="pt-2">
      <h2 id="public-search-heading" className="sr-only">Search public articles</h2>
      <ReaderSearch worldSlug={world.slug} articles={world.articles} />
    </section>

    <div className="grid gap-10 lg:grid-cols-[280px_1fr] pt-4 border-t border-zinc-800">
      <aside aria-label="Campaign lore categories" className="space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400/90">Categories & Lore</h2>
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
          <ReaderCategoryTree categories={world.categories} articles={world.articles} worldSlug={world.slug} />
        </div>
      </aside>

      <section aria-labelledby="featured-articles-heading" className="space-y-4">
        <h2 id="featured-articles-heading" className="text-xl font-semibold">Explore this world</h2>
        {world.articles.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {world.articles.map(article => (
              <a key={article.id} href={`/w/${world.slug}/a/${article.slug}`} className="rounded-xl border border-zinc-800 p-5 hover:border-indigo-500 transition-colors">
                <h3 className="font-semibold text-indigo-300">{article.title}</h3>
                {article.excerpt && <p className="mt-2 text-sm text-zinc-400">{article.excerpt}</p>}
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 p-8 text-center text-zinc-500">
            <p>No public articles have been published in this world yet.</p>
          </div>
        )}
      </section>
    </div>
  </main></WorldPresentation>;
}
export default function PublicWorldPage(props: { params: Promise<{ worldSlug: string }> }) { return <Suspense fallback={<p className="p-8 text-zinc-400">Opening world…</p>}><WorldReader {...props} /></Suspense>; }

