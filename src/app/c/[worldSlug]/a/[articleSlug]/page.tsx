/* eslint-disable @next/next/no-img-element */
export const ensureStatic = false;
export const instant = false;
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { resolveActor, requireReadableResource, readableWhere } from "@/lib/access";
import { publicDocument, parseArticleDocument, documentReferences } from "@/lib/public-content";
import { categoryAncestors } from "@/lib/category-tree";
import { parseAppearance } from "@/lib/world-appearance";
import { WorldPresentation } from "@/components/public/WorldPresentation";
import { publicImage } from "@/lib/public-content";
import { PublicRichText } from "@/components/public/PublicRichText";
import { ReaderBreadcrumbs } from "@/components/public/ReaderBreadcrumbs";
import { ReaderCategoryTree } from "@/components/public/ReaderCategoryTree";
import { ReaderMobileBrowse } from "@/components/public/ReaderMobileBrowse";
import { ReaderImageCredits, ReaderAdjacentCredit } from "@/components/public/ReaderImageCredits";
import { articleImageAssetIds } from "@/lib/asset-references";
import { readerCreditsForAssets } from "@/lib/stock-credits";
import { resolvePlacementAlt } from "@/lib/image-placement";
import { imageAssetId } from "@/lib/assets";
import { ArticleQuickFacts } from "@/components/article/ArticleQuickFacts";
import { CharacterSheet } from "@/components/article/CharacterSheet";
import { isCharacterSystem, readerCharacterRows } from "@/lib/character-sheet";
import { getArticleTemplate } from "@/lib/templates";
import { BookOpen, ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ArticleTemplateType } from "@/types";

async function PlayerArticleContent({ params }: { params: Promise<{ worldSlug: string; articleSlug: string }> }) {
  const { worldSlug, articleSlug } = await params;
  const actor = await resolveActor();

  // Find world by slug
  const world = await prisma.world.findFirst({
    where: { slug: worldSlug, deletedAt: null },
    select: { id: true, slug: true, title: true, system: true, appearance: true, ownerId: true, bannerImage: true, bannerImageAlt: true },
  });
  if (!world) notFound();
  if (actor.kind === "PREVIEW" && actor.previewWorldId !== world.id) notFound();

  // Check access: owner gets redirected, anonymous gets notFound
  if (actor.userId === null) notFound();

  // Find article by slug
  const article = await prisma.article.findFirst({
    where: { worldId: world.id, slug: articleSlug },
    select: { id: true, title: true, template: true, contentJson: true, contentHtml: true, metadata: true, coverImage: true, coverImageAlt: true, portraitImage: true, portraitImageAlt: true, excerpt: true, categoryId: true, slug: true },
  });
  if (!article) notFound();

  // Use requireReadableResource to check if the actor can read this article
  try {
    await requireReadableResource({ worldId: world.id, kind: "articles", id: article.id }, actor);
  } catch {
    notFound();
  }

  // Every reader-facing reference must use the same policy filter as the
  // article itself; otherwise titles and embedded resource IDs leak.
  const { where: readableArticleWhere } = await readableWhere(world.id, "articles", actor);
  const { where: readableBlockWhere } = await readableWhere(world.id, "statblocks", actor);
  const { where: readableAssetWhere } = await readableWhere(world.id, "assets", actor);
  const allCategories = await prisma.category.findMany({
    where: { worldId: world.id },
    select: { id: true, name: true, parentId: true, order: true, icon: true, iconImage: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  const worldArticles = await prisma.article.findMany({
    where: readableArticleWhere,
    select: { id: true, slug: true, title: true, template: true, order: true, categoryId: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  // Category names are campaign metadata: expose only paths to articles the
  // reader may actually open, not empty GM-only folders.
  const categoryById = new Map(allCategories.map(category => [category.id, category]));
  const visibleCategoryIds = new Set<string>();
  for (const readableArticle of worldArticles) {
    let categoryId = readableArticle.categoryId;
    while (categoryId && !visibleCategoryIds.has(categoryId)) {
      visibleCategoryIds.add(categoryId);
      categoryId = categoryById.get(categoryId)?.parentId ?? null;
    }
  }
  const categories = allCategories.filter(category => visibleCategoryIds.has(category.id));

  const assets = await prisma.imageAsset.findMany({
    where: { ...readableAssetWhere, displayRestricted: false },
    select: { id: true },
  });
  const assetIds = new Set(assets.map(a => a.id));
  const projectedCategories = categories.map(category => ({ ...category, iconImage: publicImage(category.iconImage, assetIds) }));

  const blocks = await prisma.rpgBlock.findMany({ where: readableBlockWhere });

  // Build public document (strips GM notes, private references, etc.)
  const doc = publicDocument(parseArticleDocument(article.contentJson, article.contentHtml), worldArticles, assetIds, new Set(blocks.map(b => b.id)));

  let rawMetadata: Record<string, unknown> = {};
  try { const value = JSON.parse(article.metadata || "{}"); if (value && typeof value === "object" && !Array.isArray(value)) rawMetadata = value; } catch {}

  const system = typeof rawMetadata.rulesSystem === "string" ? rawMetadata.rulesSystem : world.system;
  const definition = getArticleTemplate(article.template as ArticleTemplateType, system);
  const metadata: Record<string, unknown> = Object.fromEntries(
    definition.fields.filter(f => typeof rawMetadata[f.key] === "string").map(f => [f.key, rawMetadata[f.key]])
  );
  metadata.rulesSystem = system;
  if (article.template === "CHARACTER") Object.assign(metadata, readerCharacterRows(system, rawMetadata));

  const references = documentReferences(doc, "articleLink", "articleId");
  const links = worldArticles
    .filter(a => references.has(a.id))
    .map(a => ({ id: a.id, title: a.title, href: `/c/${world.slug}/a/${a.slug}` }));

  const ancestors = categoryAncestors(categories, article.categoryId);
  const isPreview = actor.kind === "PREVIEW";
  const actorName = actor.userId
    ? (await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name
    : null;

  const appearance = parseAppearance(world.appearance);
  appearance.backgroundImage = publicImage(appearance.backgroundImage, assetIds) || "";
  const ownCover = publicImage(article.coverImage, assetIds);
  const coverImage = ownCover || publicImage(world.bannerImage, assetIds);
  const coverImageAlt = ownCover ? article.coverImageAlt : world.bannerImageAlt;
  const portraitImage = publicImage(article.portraitImage, assetIds);
  const decorations = [appearance.backgroundImage, ...projectedCategories.map(category => category.iconImage)];
  const credits = await readerCreditsForAssets(world.id, [...articleImageAssetIds(doc, coverImage, portraitImage), ...decorations.flatMap(url => { const id = url && imageAssetId(url); return id ? [id] : []; })]);
  const coverAssetId = imageAssetId(coverImage || "");
  const portraitAssetId = imageAssetId(portraitImage || "");

  const breadcrumbs = [
    { label: world.title, href: `/c/${world.slug}` },
    ...ancestors.map(category => ({ label: category.name })),
    { label: article.title },
  ];

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
      <main className="space-y-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-zinc-800 pb-4">
          <ReaderBreadcrumbs items={breadcrumbs} />
          {!isPreview && <Link href="/player" className="text-sm text-indigo-300 hover:underline">Your worlds</Link>}
        </div>
        <ReaderMobileBrowse categories={projectedCategories} articles={worldArticles} worldSlug={world.slug} currentArticleId={article.id} readerType="campaign" />

        {coverImage && <figure className="space-y-1.5">
          <img src={coverImage} alt={resolvePlacementAlt(coverImageAlt, article.title)} className="h-72 w-full rounded-2xl object-cover" />
          <ReaderAdjacentCredit credits={credits} assetId={coverAssetId} className="px-1" />
        </figure>}
        <header>
          <p className="text-xs uppercase tracking-wider text-amber-400">{article.template}</p>
          <h1 className="mt-2 font-serif text-4xl">{article.title}</h1>
          {article.excerpt && <p className="mt-3 text-zinc-400">{article.excerpt}</p>}
        </header>

        {article.template === "CHARACTER" && isCharacterSystem(system) && <CharacterSheet system={system} metadata={metadata} title={article.title} />}
        <div className="world-article-layout grid gap-8">
          <article className="min-w-0">
            <PublicRichText doc={doc} links={links} blocks={blocks} credits={credits} />
            {references.size > 0 && (
              <div className="mt-10 border-t border-zinc-800 pt-6">
                <section>
                  <h2 className="text-sm font-bold text-amber-300">References</h2>
                  <ul className="mt-3 space-y-2">
                    {links.map(link => (
                      <li key={link.id}><a href={link.href} className="text-sm text-indigo-300 hover:underline">{link.title}</a></li>
                    ))}
                  </ul>
                </section>
              </div>
            )}
          </article>

          <aside className="space-y-6">
            {portraitImage && <figure className="space-y-1.5">
              <img src={portraitImage} alt={resolvePlacementAlt(article.portraitImageAlt, article.title)} className="w-full rounded-xl border border-zinc-800 object-cover" />
              <ReaderAdjacentCredit credits={credits} assetId={portraitAssetId} />
            </figure>}
            <ArticleQuickFacts template={article.template as ArticleTemplateType} system={system} metadata={metadata} blocks={blocks} />
            <div className="hidden rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-3 lg:block">
              <h2 className="mb-2 text-xs font-bold uppercase tracking-wider text-amber-400/90">World Contents</h2>
              <ReaderCategoryTree categories={projectedCategories} articles={worldArticles} worldSlug={world.slug} currentArticleId={article.id} readerType="campaign" />
            </div>
            <ReaderImageCredits credits={credits} className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-4" />
          </aside>
        </div>
      </main>
    </WorldPresentation>
  );
}

export default async function PlayerArticlePage(props: { params: Promise<{ worldSlug: string; articleSlug: string }> }) {
  return PlayerArticleContent(props);
}
