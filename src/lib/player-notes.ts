import { prisma } from "./db";
import { readableWhere, requireReadableResource } from "./access";
import type { Actor } from "./access-types";
import { parseMapSnapshot } from "./map-publication";
import { publicImage } from "./public-content";

export const NOTE_LIMIT = 500;
export const NOTE_TITLE_MAX = 200;
export const NOTE_CONTENT_MAX = 20_000;
export const NOTE_REFERENCE_KINDS = ["article", "map"] as const;
export type NoteReferenceKind = (typeof NOTE_REFERENCE_KINDS)[number];

export interface PlayerNoteReference {
  kind: NoteReferenceKind;
  resourceId: string;
  title: string;
  href: string;
}

export interface PlayerNoteItem {
  id: string;
  title: string;
  content: string;
  version: number;
  worldId: string | null;
  worldTitle: string | null;
  updatedAt: string;
  reference: PlayerNoteReference | null;
}

export function isNoteReferenceKind(value: unknown): value is NoteReferenceKind {
  return typeof value === "string" && (NOTE_REFERENCE_KINDS as readonly string[]).includes(value);
}

/** Validate and length-bound note text; returns null for an unusable title. */
export function noteFields(input: { title?: unknown; content?: unknown }): { title: string; content: string } | null {
  if (typeof input.title !== "string") return null;
  const title = input.title.trim();
  if (!title || title.length > NOTE_TITLE_MAX) return null;
  const content = typeof input.content === "string" ? input.content : "";
  if (content.length > NOTE_CONTENT_MAX) return null;
  return { title, content };
}

/** Notes are strictly per-account; GM preview sessions never see them. */
function noteActor(actor: Actor) {
  return actor.userId && actor.kind !== "PREVIEW" ? actor : null;
}

/**
 * A note may point at a campaign article or published map. Validate the
 * reference with the same reader access as the campaign page; a note without a
 * reference may still belong to a campaign the player is an active member of.
 */
export async function resolveNoteTarget(actor: Actor, input: {
  worldId?: unknown;
  resourceKind?: unknown;
  resourceId?: unknown;
}): Promise<{ worldId: string | null; resourceKind: NoteReferenceKind | null; resourceId: string | null } | null> {
  const current = noteActor(actor);
  if (!current) return null;
  const resourceId = typeof input.resourceId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(input.resourceId) ? input.resourceId : null;
  const kind = input.resourceKind === null || input.resourceKind === undefined || input.resourceKind === "" ? null : input.resourceKind;

  if (kind !== null || resourceId !== null) {
    if (!isNoteReferenceKind(kind) || !resourceId) return null;
    if (kind === "article") {
      const article = await prisma.article.findFirst({ where: { id: resourceId, world: { deletedAt: null } }, select: { worldId: true } });
      if (!article) return null;
      try { await requireReadableResource({ worldId: article.worldId, kind: "articles", id: resourceId }, current); } catch { return null; }
      return { worldId: article.worldId, resourceKind: kind, resourceId };
    }
    const map = await prisma.map.findFirst({ where: { id: resourceId, world: { deletedAt: null } }, select: { worldId: true, publication: { select: { snapshot: true } } } });
    if (!map?.publication) return null;
    try { await requireReadableResource({ worldId: map.worldId, kind: "maps", id: resourceId }, current); } catch { return null; }
    const snapshot = parseMapSnapshot(map.publication.snapshot);
    if (!snapshot) return null;
    const { where } = await readableWhere(map.worldId, "assets", current);
    const assets = await prisma.imageAsset.findMany({ where: { ...where, displayRestricted: false }, select: { id: true } });
    if (!publicImage(snapshot.imageUrl, new Set(assets.map(asset => asset.id)))) return null;
    return { worldId: map.worldId, resourceKind: kind, resourceId };
  }

  const worldId = typeof input.worldId === "string" && input.worldId ? input.worldId : null;
  if (worldId) {
    const membership = await prisma.worldMember.findFirst({
      where: { worldId, userId: current.userId!, status: "ACTIVE", world: { deletedAt: null } },
      select: { id: true },
    });
    if (!membership) return null;
  }
  return { worldId, resourceKind: null, resourceId: null };
}

/**
 * Load the caller's notebook with reference projections. Note titles and bodies
 * always belong to the player; only the campaign label and resource link are
 * dropped when access changes.
 */
export async function playerNotes(actor: Actor, limit = NOTE_LIMIT): Promise<PlayerNoteItem[]> {
  const current = noteActor(actor);
  if (!current) return [];
  const memberships = await prisma.worldMember.findMany({
    where: { userId: current.userId!, status: "ACTIVE", world: { deletedAt: null } },
    select: { world: { select: { id: true, slug: true, title: true } } },
  });
  const worlds = memberships.map(member => member.world);
  const worldById = new Map(worlds.map(world => [world.id, world]));

  const notes = await prisma.playerNote.findMany({
    where: { userId: current.userId! },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  if (notes.length === 0) return [];

  type Access = { articles?: { where: Record<string, unknown> }; maps?: { where: Record<string, unknown> }; assetIds?: Set<string> };
  const access = new Map<string, Access>();
  async function accessFor(worldId: string): Promise<Access> {
    let entry = access.get(worldId);
    if (!entry) { entry = {}; access.set(worldId, entry); }
    if (!entry.articles) entry.articles = await readableWhere(worldId, "articles", current!);
    if (!entry.maps) entry.maps = await readableWhere(worldId, "maps", current!);
    if (!entry.assetIds) {
      const { where } = await readableWhere(worldId, "assets", current!);
      const assets = await prisma.imageAsset.findMany({ where: { ...where, displayRestricted: false }, select: { id: true } });
      entry.assetIds = new Set(assets.map(asset => asset.id));
    }
    return entry;
  }

  const references = new Map<string, PlayerNoteReference>();
  const referenced = notes.filter(note => note.worldId && note.resourceKind && note.resourceId);
  for (const world of worlds) {
    const worldNotes = referenced.filter(note => note.worldId === world.id);
    if (worldNotes.length === 0) continue;
    const resolved = await accessFor(world.id);

    const articleIds = worldNotes.filter(note => note.resourceKind === "article").map(note => note.resourceId!);
    if (articleIds.length > 0) {
      const articles = await prisma.article.findMany({
        where: { AND: [resolved.articles!.where, { worldId: world.id, id: { in: articleIds } }] },
        select: { id: true, title: true, slug: true },
      });
      for (const article of articles) {
        references.set(`article:${article.id}`, { kind: "article", resourceId: article.id, title: article.title, href: `/c/${world.slug}/a/${article.slug}` });
      }
    }

    const mapIds = worldNotes.filter(note => note.resourceKind === "map").map(note => note.resourceId!);
    if (mapIds.length > 0) {
      const maps = await prisma.map.findMany({
        where: { AND: [resolved.maps!.where, { worldId: world.id, id: { in: mapIds }, publication: { isNot: null } }] },
        select: { id: true, publication: { select: { snapshot: true } } },
      });
      for (const map of maps) {
        const snapshot = parseMapSnapshot(map.publication?.snapshot);
        if (!snapshot || !publicImage(snapshot.imageUrl, resolved.assetIds!)) continue;
        references.set(`map:${map.id}`, { kind: "map", resourceId: map.id, title: snapshot.title, href: `/c/${world.slug}/maps/${map.id}` });
      }
    }
  }

  return notes.map(note => {
    const world = note.worldId ? worldById.get(note.worldId) : undefined;
    const reference = note.resourceKind && note.resourceId ? references.get(`${note.resourceKind}:${note.resourceId}`) ?? null : null;
    return {
      id: note.id,
      title: note.title,
      content: note.content,
      version: note.version,
      worldId: world?.id ?? null,
      worldTitle: world?.title ?? null,
      updatedAt: note.updatedAt.toISOString(),
      reference,
    };
  });
}
