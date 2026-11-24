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

const ACTIVITY_PAGE_SIZE = 200;

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
 *
 * Candidates are read in pages and only readable entries count toward the
 * limit: a burst of shares for other players must not hide older readable
 * updates.
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
  const worldIds = worlds.map(world => world.id);

  type Access = {
    articles?: { where: Record<string, unknown> };
    maps?: { where: Record<string, unknown> };
    assetIds?: Set<string>;
  };
  const access = new Map<string, Access>();
  async function accessFor(worldId: string): Promise<Access> {
    let current = access.get(worldId);
    if (!current) { current = {}; access.set(worldId, current); }
    if (!current.articles) current.articles = await readableWhere(worldId, "articles", actor);
    if (!current.maps) current.maps = await readableWhere(worldId, "maps", actor);
    if (!current.assetIds) {
      const { where } = await readableWhere(worldId, "assets", actor);
      const assets = await prisma.imageAsset.findMany({ where: { ...where, displayRestricted: false }, select: { id: true } });
      current.assetIds = new Set(assets.map(asset => asset.id));
    }
    return current;
  }

  const items: PlayerActivityItem[] = [];
  let cursor: string | undefined;
  while (items.length < limit) {
    const rows = await prisma.playerActivity.findMany({
      where: { worldId: { in: worldIds } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: ACTIVITY_PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;

    const projected = new Map<string, PlayerActivityItem>();

    // Group this page by world so each access predicate is evaluated once.
    for (const world of worlds) {
      const worldRows = rows.filter(row => row.worldId === world.id);
      if (worldRows.length === 0) continue;
      const resolved = await accessFor(world.id);

      const articleRows = worldRows.filter(row => row.resourceKind === "article");
      if (articleRows.length > 0) {
        const readable = await prisma.article.findMany({
          // AND keeps the access predicate intact. readableWhere may deny with
          // `id: "__NONE__"`; replacing that with candidate IDs would leak.
          where: { AND: [resolved.articles!.where, { worldId: world.id, id: { in: articleRows.map(row => row.resourceId) } }] },
          select: { id: true, title: true, template: true, slug: true },
        });
        for (const article of readable) {
          projected.set(`article:${article.id}`, {
            id: "", kind: "article",
            label: article.template === "REPORT" ? "Session recap" : "Article",
            title: article.title, worldTitle: world.title,
            href: `/c/${world.slug}/a/${article.slug}`, occurredAt: "",
          });
        }
      }

      const mapRows = worldRows.filter(row => row.resourceKind === "map");
      if (mapRows.length > 0) {
        const published = await prisma.map.findMany({
          where: { AND: [resolved.maps!.where, { worldId: world.id, id: { in: mapRows.map(row => row.resourceId) }, publication: { isNot: null } }] },
          select: { id: true, publication: { select: { snapshot: true } } },
        });
        for (const map of published) {
          const snapshot = parseMapSnapshot(map.publication?.snapshot);
          // A map whose base image is no longer readable opens on an
          // unavailable notice; keep it out of the feed instead.
          if (!snapshot || !publicImage(snapshot.imageUrl, resolved.assetIds!)) continue;
          projected.set(`map:${map.id}`, {
            id: "", kind: "map", label: "Map", title: snapshot.title,
            worldTitle: world.title, href: `/c/${world.slug}/maps/${map.id}`, occurredAt: "",
          });
        }
      }
    }

    for (const row of rows) {
      const item = projected.get(`${row.resourceKind}:${row.resourceId}`);
      if (!item) continue;
      items.push({ ...item, id: row.id, occurredAt: row.occurredAt.toISOString() });
      if (items.length === limit) break;
    }
  }
  return items;
}
