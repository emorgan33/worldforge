/* eslint-disable @next/next/no-img-element */
export const ensureStatic = false;
export const instant = false;
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveActor, readableWhere } from "@/lib/access";
import { parseAppearance } from "@/lib/world-appearance";
import { WorldPresentation } from "@/components/public/WorldPresentation";
import { publicImage } from "@/lib/public-content";
import { ReaderSearch } from "@/components/public/ReaderSearch";
import { ReaderCategoryTree } from "@/components/public/ReaderCategoryTree";
import { ReaderMobileBrowse } from "@/components/public/ReaderMobileBrowse";
import { systemProfile } from "@/lib/rpg";
import { BookOpen, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { LinkableReaderArticle } from "@/lib/category-tree";

async function PlayerWorldContent({ worldSlug }: { worldSlug: string }) {
  // Resolve the actor (supports PREVIEW mode via wf_preview cookie)
  const actor = await resolveActor();
  // Find the world by slug
  const world = await prisma.world.findFirst({
    where: { slug: worldSlug, deletedAt: null },
    select: { id: true, slug: true, title: true, system: true, description: true, coverImage: true, bannerImage: true, appearance: true, ownerId: true },
  });
  if (!world) notFound();
  if (actor.kind === "PREVIEW" && actor.previewWorldId !== world.id) notFound();
  // Check if actor is the owner (redirect to workspace) or a player member
  if (actor.userId === world.ownerId || actor.userId === null) {
    if (actor.userId === world.ownerId) redirect("/");
    notFound();
  }
  // Verify the actor is a member of this world
  const member = await prisma.worldMember.findFirst({
    where: { worldId: world.id, userId: actor.userId!, status: "ACTIVE" },
    select: { id: true },
  });
  if (!member) notFound();
  // Get readable articles using readableWhere (filtered by policy)
  const { where } = await readableWhere(world.id, "articles", actor);
  const articles = await prisma.article.findMany({
    where: { ...where, worldId: world.id },
    select: { id: true, slug: true, title: true, template: true, excerpt: true, order: true, categoryId: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  const linkableArticles: LinkableReaderArticle[] = articles.map(a => ({
    id: a.id, slug: a.slug, title: a.title, template: a.template,
    excerpt: a.excerpt, order: a.order, categoryId: a.categoryId,
  }));
  // Category names are campaign metadata: only retain paths to readable items.
  const allCategories = await prisma.category.findMany({
    where: { worldId: world.id },
    select: { id: true, name: true, parentId: true, order: true, icon: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  const categoryById = new Map(allCategories.map(category => [category.id, category]));
  const visibleCategoryIds = new Set<string>();
  for (const readableArticle of articles) {
    let categoryId = readableArticle.categoryId;
    while (categoryId && !visibleCategoryIds.has(categoryId)) {
      visibleCategoryIds.add(categoryId);
      categoryId = categoryById.get(categoryId)?.parentId ?? null;
    }
  }
  const categories = allCategories.filter(category => visibleCategoryIds.has(category.id));
  // Get assets for image filtering
  const { where: readableAssetWhere } = await readableWhere(world.id, "assets", actor);
  const assets = await prisma.imageAsset.findMany({
    where: readableAssetWhere,
    select: { id: true },
  });
  const assetIds = new Set(assets.map(asset => asset.id));
  const appearance = parseAppearance(world.appearance);
  appearance.backgroundImage = publicImage(appearance.backgroundImage, assetIds) || "";
  const coverImage = publicImage(world.coverImage, assetIds);
  const isPreview = actor.kind === "PREVIEW";
  const actorName = actor.userId
    ? (await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name
    : null;
  return (
    <WorldPresentation appearance={appearance}>
      {/* Preview Banner */}
      {isPreview && (
        <div className="mb-6 rounded-xl border border-amber-600/50 bg-amber-950/30 px-5 py-3 text-sm text-amber-200 flex items-center gap-3">
          <BookOpen className="h-4 w-4 shrink-0" />
          <span>
            Previewing as <strong>{actorName || "Player"}</strong>
            {actor.realUserId && (
              <Link href="/" className="ml-3 text-indigo-300 hover:underline inline-flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> Back to GM workspace
              </Link>
            )}
          </span>
        </div>
      )}
      <main className="space-y-8">
        {!isPreview && <nav aria-label="Player navigation"><Link href="/player" className="text-sm text-indigo-300 hover:underline">← Your worlds</Link></nav>}
        {coverImage && <img src={coverImage} alt="" className="h-72 w-full rounded-2xl object-cover" />}
        <header>
          <p className="text-xs uppercase tracking-widest text-amber-400">{systemProfile(world.system).short}{world.system === "PF_2E" ? " · Remaster" : ""}</p>
          <h1 className="mt-3 font-serif text-5xl">{world.title}</h1>
          {world.description && <p className="mt-4 whitespace-pre-wrap text-zinc-400">{world.description}</p>}
        </header>
        <section aria-labelledby="player-search-heading" className="pt-2">
          <h2 id="player-search-heading" className="sr-only">Search articles</h2>
          <ReaderSearch worldSlug={world.slug} articles={linkableArticles} readerType="campaign" />
        </section>
        <ReaderMobileBrowse categories={categories} articles={linkableArticles} worldSlug={world.slug} readerType="campaign" currentPage="home" />
        <div className="grid gap-10 lg:grid-cols-[280px_1fr] pt-4 border-t border-zinc-800">
          <aside aria-label="World contents" className="hidden space-y-4 lg:block">
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber-400/90">Contents</h2>
            <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3">
              <ReaderCategoryTree categories={categories} articles={linkableArticles} worldSlug={world.slug} readerType="campaign" currentPage="home" />
            </div>
          </aside>
          <section aria-labelledby="readable-articles-heading" className="space-y-4">
            <h2 id="readable-articles-heading" className="text-xl font-semibold">Available articles</h2>
            {linkableArticles.length > 0 ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {linkableArticles.map(article => (
                  <a key={article.id} href={`/c/${world.slug}/a/${article.slug}`} className="rounded-xl border border-zinc-800 p-5 hover:border-indigo-500 transition-colors">
                    <h3 className="font-semibold text-indigo-300">{article.title}</h3>
                    {article.excerpt && <p className="mt-2 text-sm text-zinc-400">{article.excerpt}</p>}
                  </a>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-zinc-800 p-8 text-center text-zinc-500">
                <p>No articles are currently available for you.</p>
              </div>
            )}
          </section>
        </div>
      </main>
    </WorldPresentation>
  );
}

export default async function PlayerWorldPage(props: { params: Promise<{ worldSlug: string }> }) {
  const { worldSlug } = await props.params;
  return PlayerWorldContent({ worldSlug });
}
