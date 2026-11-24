import { prisma } from "./db";
import { readableWhere, requireReadableResource } from "./access";
import type { Actor } from "./access-types";
import { parseMapSnapshot } from "./map-publication";
import { publicImage } from "./public-content";

export const BOOKMARK_KINDS = ["article", "map"] as const;
export type BookmarkKind = (typeof BOOKMARK_KINDS)[number];

export const BOOKMARK_LIMIT = 100;

export interface PlayerBookmarkItem {
  id: string;
  resourceId: string;
  kind: BookmarkKind;
  title: string;
  worldTitle: string;
  href: string;
  createdAt: string;
}

export function isBookmarkKind(value: unknown): value is BookmarkKind {
  return typeof value === "string" && (BOOKMARK_KINDS as readonly string[]).includes(value);
}

/**
 * A player's private Saved list. Every entry is re-checked against current
 * access, so revoking a grant, unpublishing a map, or archiving a world hides
 * the bookmark without deleting it: if access is restored it becomes visible
 * again. Hidden bookmarks never count toward the list limit.
 */
export async function playerBookmarks(actor: Actor, limit = BOOKMARK_LIMIT): Promise<PlayerBookmarkItem[]> {
  if (!actor.userId || actor.kind === "PREVIEW") return [];
  const memberships = await prisma.worldMember.findMany({
    where: { userId: actor.userId, status: "ACTIVE", world: { deletedAt: null } },
    select: { world: { select: { id: true, slug: true, title: true } } },
  });
  if (memberships.length === 0) return [];
  const worlds = memberships.map(member => member.world);

  const rows = await prisma.playerBookmark.findMany({
    where: { userId: actor.userId, worldId: { in: worlds.map(world => world.id) } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (rows.length === 0) return [];

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

  const projected = new Map<string, Omit<PlayerBookmarkItem, "id" | "resourceId" | "createdAt">>();
  for (const world of worlds) {
    const worldRows = rows.filter(row => row.worldId === world.id);
    if (worldRows.length === 0) continue;
    const resolved = await accessFor(world.id);

    const articleIds = worldRows.filter(row => row.resourceKind === "article").map(row => row.resourceId);
    if (articleIds.length > 0) {
      // AND preserves denials such as `id: "__NONE__"` from readableWhere.
      const articles = await prisma.article.findMany({
        where: { AND: [resolved.articles!.where, { worldId: world.id, id: { in: articleIds } }] },
        select: { id: true, title: true, slug: true },
      });
      for (const article of articles) {
        projected.set(`article:${article.id}`, {
          kind: "article", title: article.title, worldTitle: world.title,
          href: `/c/${world.slug}/a/${article.slug}`,
        });
      }
    }

    const mapIds = worldRows.filter(row => row.resourceKind === "map").map(row => row.resourceId);
    if (mapIds.length > 0) {
      const maps = await prisma.map.findMany({
        where: { AND: [resolved.maps!.where, { worldId: world.id, id: { in: mapIds }, publication: { isNot: null } }] },
        select: { id: true, publication: { select: { snapshot: true } } },
      });
      for (const map of maps) {
        const snapshot = parseMapSnapshot(map.publication?.snapshot);
        if (!snapshot || !publicImage(snapshot.imageUrl, resolved.assetIds!)) continue;
        projected.set(`map:${map.id}`, {
          kind: "map", title: snapshot.title, worldTitle: world.title,
          href: `/c/${world.slug}/maps/${map.id}`,
        });
      }
    }
  }

  const items: PlayerBookmarkItem[] = [];
  for (const row of rows) {
    const item = projected.get(`${row.resourceKind}:${row.resourceId}`);
    if (!item) continue;
    items.push({ ...item, id: row.id, resourceId: row.resourceId, createdAt: row.createdAt.toISOString() });
    if (items.length === limit) break;
  }
  return items;
}

/**
 * Validate that the caller may save this resource right now. Returns the owning
 * world, or null when the resource is missing or unreadable. Map bookmarks also
 * require a published snapshot whose base image the reader can load.
 */
export async function bookmarkableWorld(actor: Actor, kind: BookmarkKind, resourceId: string): Promise<string | null> {
  if (!actor.userId || actor.kind === "PREVIEW") return null;
  if (kind === "article") {
    const article = await prisma.article.findFirst({
      where: { id: resourceId, world: { deletedAt: null } },
      select: { worldId: true },
    });
    if (!article) return null;
    try {
      await requireReadableResource({ worldId: article.worldId, kind: "articles", id: resourceId }, actor);
    } catch { return null; }
    return article.worldId;
  }

  const map = await prisma.map.findFirst({
    where: { id: resourceId, world: { deletedAt: null } },
    select: { worldId: true, publication: { select: { snapshot: true } } },
  });
  if (!map?.publication) return null;
  try {
    await requireReadableResource({ worldId: map.worldId, kind: "maps", id: resourceId }, actor);
  } catch { return null; }
  const snapshot = parseMapSnapshot(map.publication.snapshot);
  if (!snapshot) return null;
  const { where } = await readableWhere(map.worldId, "assets", actor);
  const assets = await prisma.imageAsset.findMany({ where: { ...where, displayRestricted: false }, select: { id: true } });
  return publicImage(snapshot.imageUrl, new Set(assets.map(asset => asset.id))) ? map.worldId : null;
}
