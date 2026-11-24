export const ensureStatic = false;
export const instant = false;
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { BookOpen, ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db";
import { resolvePageActor, requireReadableResource, readableWhere } from "@/lib/access";
import { publicImage } from "@/lib/public-content";
import { parseAppearance } from "@/lib/world-appearance";
import { WorldPresentation } from "@/components/public/WorldPresentation";
import { ReaderThemeBar } from "@/components/theme/ReaderThemeBar";
import { MapViewer } from "@/components/map/MapViewer";
import { parseMapSnapshot, type MapSnapshot } from "@/lib/map-publication";
import { SaveButton } from "@/components/player/SaveButton";

/** Keep only image references the reader may actually load. */
function projectPublishedImages(snapshot: MapSnapshot, readableAssetIds: Set<string>): MapSnapshot | null {
  const base = publicImage(snapshot.imageUrl, readableAssetIds);
  if (!base) return null;
  return {
    ...snapshot,
    imageUrl: base,
    layers: snapshot.layers.map(layer => ({ ...layer, imageUrl: layer.imageUrl ? publicImage(layer.imageUrl, readableAssetIds) : null })),
  };
}

async function PlayerMapContent({ worldSlug, mapId }: { worldSlug: string; mapId: string }) {
  const actor = await resolvePageActor();
  if (!actor.userId) notFound();

  const world = await prisma.world.findFirst({
    where: { slug: worldSlug, deletedAt: null },
    select: { id: true, slug: true, title: true, system: true, appearance: true, ownerId: true },
  });
  if (!world) notFound();
  if (actor.kind === "PREVIEW" && actor.previewWorldId !== world.id) notFound();
  if (actor.userId === world.ownerId) redirect("/");

  // Audience policies on the map decide whether this player may open it.
  try {
    await requireReadableResource({ worldId: world.id, kind: "maps", id: mapId }, actor);
  } catch {
    notFound();
  }

  const map = await prisma.map.findFirst({
    where: { id: mapId, worldId: world.id },
    select: {
      id: true,
      publication: { select: { snapshot: true, revision: true, publishedAt: true } },
    },
  });
  if (!map?.publication) notFound();
  const snapshot = parseMapSnapshot(map.publication.snapshot);
  if (!snapshot) notFound();

  const { where: readableAssetWhere } = await readableWhere(world.id, "assets", actor);
  const assets = await prisma.imageAsset.findMany({
    where: { ...readableAssetWhere, displayRestricted: false },
    select: { id: true },
  });
  const projected = projectPublishedImages(snapshot, new Set(assets.map(asset => asset.id)));

  // A pin may link only to an article this reader can open.
  const { where: readableArticleWhere } = await readableWhere(world.id, "articles", actor);
  const readableArticles = await prisma.article.findMany({
    where: readableArticleWhere,
    select: { id: true, slug: true },
  });
  const articleHrefs = new Map(readableArticles.map(article => [article.id, `/c/${world.slug}/a/${article.slug}`]));
  const articleLinks: Record<string, string> = {};
  for (const marker of snapshot.markers) {
    const href = marker.articleId ? articleHrefs.get(marker.articleId) : undefined;
    if (href) articleLinks[marker.id] = href;
  }

  const appearance = parseAppearance(world.appearance);
  const isPreview = actor.kind === "PREVIEW";
  const actorName = actor.userId
    ? (await prisma.user.findUnique({ where: { id: actor.userId }, select: { name: true } }))?.name
    : null;
  const savedBookmark = !isPreview && actor.userId
    ? await prisma.playerBookmark.findUnique({
        where: { userId_resourceKind_resourceId: { userId: actor.userId, resourceKind: "map", resourceId: map.id } },
        select: { id: true },
      })
    : null;

  return (
    <>
      <ReaderThemeBar />
      <WorldPresentation appearance={appearance}>
        {isPreview && (
          <div className="mb-6 flex items-center gap-3 rounded-xl border border-primary-600/50 bg-primary-950/30 px-5 py-3 text-sm text-primary-200">
            <BookOpen className="h-4 w-4 shrink-0" />
            <span>
              Previewing as <strong>{actorName || "Player"}</strong>
              {actor.realUserId && (
                <Link href="/" className="ml-3 inline-flex items-center gap-1 text-secondary-300 hover:underline">
                  <ArrowLeft className="h-3 w-3" /> Back to GM workspace
                </Link>
              )}
            </span>
          </div>
        )}
        <main className="space-y-6">
          <nav aria-label="Player navigation" className="flex flex-wrap gap-4 text-sm text-secondary-300">
            <Link href={`/c/${world.slug}`} className="hover:underline">← {world.title}</Link>
            <span className="text-app-subtle" aria-hidden="true">·</span>
            <span className="text-app-subtle">Map</span>
          </nav>
          <header>
            <p className="text-xs uppercase tracking-widest text-primary-400">Published map</p>
            <h1 className="mt-2 font-serif text-4xl">{snapshot.title}</h1>
            {snapshot.description && <p className="mt-3 max-w-3xl whitespace-pre-wrap text-app-muted">{snapshot.description}</p>}
            <p className="mt-2 text-xs text-app-subtle">Revision {map.publication.revision} · published {map.publication.publishedAt.toLocaleString()}</p>
            {!isPreview && <SaveButton className="mt-4" kind="map" resourceId={map.id} initialSaved={Boolean(savedBookmark)} />}
          </header>
          {projected ? (
            <MapViewer key={`${map.id}-${map.publication.revision}`} snapshot={projected} articleLinks={articleLinks} />
          ) : (
            <div role="status" className="rounded-xl border border-app-border bg-app-canvas/40 p-8 text-center">
              <p className="font-semibold text-app-text">This map isn’t available right now.</p>
              <p className="mt-2 text-sm text-app-muted">Its image is no longer shared with campaign players. Ask your GM to share the map image again.</p>
            </div>
          )}
        </main>
      </WorldPresentation>
    </>
  );
}

export default async function PlayerMapPage(props: { params: Promise<{ worldSlug: string; mapId: string }> }) {
  const { worldSlug, mapId } = await props.params;
  return PlayerMapContent({ worldSlug, mapId });
}
