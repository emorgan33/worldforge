/* eslint-disable @next/next/no-img-element */
import { WorldPresentation } from "@/components/public/WorldPresentation";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { publicWorld } from "@/lib/public-world";
import { systemProfile } from "@/lib/rpg";
import { ReaderSearch } from "@/components/public/ReaderSearch";
import { ReaderCategoryTree } from "@/components/public/ReaderCategoryTree";
import { ReaderMobileBrowse } from "@/components/public/ReaderMobileBrowse";
import { ReaderImageCredits, ReaderAdjacentCredit } from "@/components/public/ReaderImageCredits";
import { imageAssetId } from "@/lib/assets";
import { resolvePlacementAlt } from "@/lib/image-placement";

async function WorldReader({ params }: { params: Promise<{ worldSlug: string }> }) {
  const { worldSlug } = await params; const world = await publicWorld(worldSlug); if (!world) notFound();
  return <WorldPresentation appearance={world.appearance}><main className="space-y-8">
    {world.coverImage && <figure><img src={world.coverImage} alt={resolvePlacementAlt(world.coverImageAlt, world.title)} className="h-72 w-full rounded-2xl object-cover" /><ReaderAdjacentCredit credits={world.credits} assetId={imageAssetId(world.coverImage)} /></figure>}
    <header>
      <p className="text-xs uppercase tracking-widest text-primary-400">{systemProfile(world.system).short}{world.system === "PF_2E" ? " · Remaster" : ""}</p>
      <h1 className="mt-3 font-serif text-5xl">{world.title}</h1>
      {world.description && <p className="mt-4 whitespace-pre-wrap text-app-muted">{world.description}</p>}
    </header>

    <section aria-labelledby="public-search-heading" className="pt-2">
      <h2 id="public-search-heading" className="sr-only">Search public articles</h2>
      <ReaderSearch worldSlug={world.slug} articles={world.articles} />
    </section>
    <ReaderMobileBrowse categories={world.categories} articles={world.articles} worldSlug={world.slug} readerType="public" currentPage="home" />

    <div className="grid gap-10 lg:grid-cols-[280px_1fr] pt-4 border-t border-app-border">
      <aside aria-label="Campaign lore categories" className="hidden space-y-4 lg:block">
        <h2 className="text-sm font-bold uppercase tracking-wider text-primary-400/90">Categories & Lore</h2>
        <div className="rounded-xl border border-app-border/80 bg-app-canvas/40 p-3">
          <ReaderCategoryTree categories={world.categories} articles={world.articles} worldSlug={world.slug} readerType="public" currentPage="home" />
        </div>
      </aside>

      <section aria-labelledby="featured-articles-heading" className="space-y-4">
        <h2 id="featured-articles-heading" className="text-xl font-semibold">Explore this world</h2>
        {world.articles.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {world.articles.map(article => (
              <a key={article.id} href={`/w/${world.slug}/a/${article.slug}`} className="rounded-xl border border-app-border p-5 hover:border-secondary-500 transition-colors">
                <h3 className="font-semibold text-secondary-300">{article.title}</h3>
                {article.excerpt && <p className="mt-2 text-sm text-app-muted">{article.excerpt}</p>}
              </a>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-app-border p-8 text-center text-app-subtle">
            <p>No public articles have been published in this world yet.</p>
          </div>
        )}
      </section>
    </div>
    <ReaderImageCredits credits={world.credits} />
  </main></WorldPresentation>;
}
export default function PublicWorldPage(props: { params: Promise<{ worldSlug: string }> }) { return <Suspense fallback={<p className="p-8 text-app-muted">Opening world…</p>}><WorldReader {...props} /></Suspense>; }

