import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { readableWhere } from "./access";
import type { Actor } from "./access-types";
import { parseMapSnapshot } from "./map-publication";
import { publicImage } from "./public-content";

export const PLAYER_ACTIVITY_KINDS = ["article", "map"] as const;
export type PlayerActivityKind = (typeof PLAYER_ACTIVITY_KINDS)[number];

export const PLAYER_ACTIVITY_LIMIT = 20;

export interface PlayerActivityItem {
  id: string;
  kind: PlayerActivityKind;
  label: string;
  title: string;
  worldTitle: string;
  href: string;
  occurredAt: string;
}

type ActivityClient = Pick<Prisma.TransactionClient, "playerActivity"> | typeof prisma;

/**
 * A readable-where may already constrain `id` (for player snapshots). Intersect
 * it with the feed candidates instead of replacing it, or a non-granted player
 * would still receive the article.
 */
function restrictToReadable(where: Record<string, unknown>, candidates: string[]): string[] {
  const constraint = (where as { id?: { in?: unknown } }).id?.in;
  if (!Array.isArray(constraint)) return candidates;
  const allowed = new Set(constraint.filter((id): id is string => typeof id === "string"));
  return candidates.filter(id => allowed.has(id));
}

/**
 * Mark a shared article or published map as new for campaign players. Call this
 * in the same transaction as the sharing/publication write so the feed cannot
 * claim something the reader cannot open. Re-sharing bumps the timestamp.
 */
export async function recordPlayerActivity(
  client: ActivityClient,
  input: { worldId: string; resourceKind: PlayerActivityKind; resourceId: string },
) {
  const { worldId, resourceKind, resourceId } = input;
  await client.playerActivity.upsert({
    where: { resourceKind_resourceId: { resourceKind, resourceId } },
    create: { worldId, resourceKind, resourceId },
    update: { occurredAt: new Date(), worldId },
  });
}

/** Remove the feed entry when sharing stops or a snapshot is unpublished. */
export async function clearPlayerActivity(client: ActivityClient, resourceKind: PlayerActivityKind, resourceId: string) {
  await client.playerActivity.deleteMany({ where: { resourceKind, resourceId } });
}

/**
 * Player-facing "What's new" feed. Every entry is re-checked against the
 * reader's current access, so revoking a grant, unpublishing a map, or
 * unsharing an article removes it without touching stored activity rows.
 */
export async function playerActivityFeed(actor: Actor, limit = PLAYER_ACTIVITY_LIMIT): Promise<PlayerActivityItem[]> {
  if (!actor.userId) return [];
  const memberships = await prisma.worldMember.findMany({
    where: {
      userId: actor.userId,
      status: "ACTIVE",
      world: { deletedAt: null },
      ...(actor.kind === "PREVIEW" ? { worldId: actor.previewWorldId } : {}),
    },
    select: { world: { select: { id: true, slug: true, title: true } } },
  });
  if (memberships.length === 0) return [];
  const worlds = memberships.map(member => member.world);
  const worldById = new Map(worlds.map(world => [world.id, world]));

  const rows = await prisma.playerActivity.findMany({
    where: { worldId: { in: worlds.map(world => world.id) } },
    orderBy: { occurredAt: "desc" },
    take: 200,
  });
  if (rows.length === 0) return [];

  const articles = new Map<string, { title: string; template: string; slug: string; worldId: string }>();
  const maps = new Map<string, { title: string; worldId: string }>();

  for (const world of worlds) {
    const worldRows = rows.filter(row => row.worldId === world.id);
    if (worldRows.length === 0) continue;

    if (worldRows.some(row => row.resourceKind === "article")) {
      const { where } = await readableWhere(world.id, "articles", actor);
      const candidates = worldRows.filter(row => row.resourceKind === "article").map(row => row.resourceId);
      const readable = await prisma.article.findMany({
        where: { ...where, id: { in: restrictToReadable(where, candidates) } },
        select: { id: true, title: true, template: true, slug: true },
      });
      for (const article of readable) articles.set(article.id, { ...article, worldId: world.id });
    }

    if (worldRows.some(row => row.resourceKind === "map")) {
      const candidates = worldRows.filter(row => row.resourceKind === "map").map(row => row.resourceId);
      const { where } = await readableWhere(world.id, "maps", actor);
      const published = await prisma.map.findMany({
        where: { ...where, worldId: world.id, id: { in: restrictToReadable(where, candidates) }, publication: { isNot: null } },
        select: { id: true, publication: { select: { snapshot: true } } },
      });
      if (published.length > 0) {
        const assetWhere = await readableWhere(world.id, "assets", actor);
        const assets = await prisma.imageAsset.findMany({ where: { ...assetWhere.where, displayRestricted: false }, select: { id: true } });
        const assetIds = new Set(assets.map(asset => asset.id));
        for (const map of published) {
          const snapshot = parseMapSnapshot(map.publication?.snapshot);
          // A map whose base image is no longer readable opens on an
          // unavailable notice; keep it out of the feed instead.
          if (!snapshot || !publicImage(snapshot.imageUrl, assetIds)) continue;
          maps.set(map.id, { title: snapshot.title, worldId: world.id });
        }
      }
    }
  }

  const items: PlayerActivityItem[] = [];
  for (const row of rows) {
    const world = worldById.get(row.worldId);
    if (!world) continue;
    if (row.resourceKind === "article") {
      const article = articles.get(row.resourceId);
      if (!article) continue;
      items.push({
        id: row.id,
        kind: "article",
        label: article.template === "REPORT" ? "Session recap" : "Article",
        title: article.title,
        worldTitle: world.title,
        href: `/c/${world.slug}/a/${article.slug}`,
        occurredAt: row.occurredAt.toISOString(),
      });
    } else if (row.resourceKind === "map") {
      const map = maps.get(row.resourceId);
      if (!map) continue;
      items.push({
        id: row.id,
        kind: "map",
        label: "Map",
        title: map.title,
        worldTitle: world.title,
        href: `/c/${world.slug}/maps/${row.resourceId}`,
        occurredAt: row.occurredAt.toISOString(),
      });
    }
    if (items.length === limit) break;
  }
  return items;
}
