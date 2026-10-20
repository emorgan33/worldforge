import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { RPG_SYSTEMS, type RpgSystem } from "@/lib/rpg";

export type WorldCreationPayload = { title: string; description: string; system: RpgSystem; requestId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeWorldCreation(input: unknown): WorldCreationPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["title", "description", "system", "requestId"].includes(key))) return null;
  if (typeof value.title !== "string" || typeof value.system !== "string" || typeof value.requestId !== "string") return null;
  if (value.description !== undefined && typeof value.description !== "string") return null;
  const title = value.title.normalize("NFC").trim().replace(/\s+/gu, " ");
  const description = (value.description as string | undefined ?? "").normalize("NFC").trim();
  if (!title || title.length > 200 || description.length > 10000) return null;
  if (!RPG_SYSTEMS.some(profile => profile.id === value.system) || !UUID.test(value.requestId)) return null;
  return { title, description, system: value.system as RpgSystem, requestId: value.requestId.toLowerCase() };
}

export function worldCreationHash(payload: WorldCreationPayload) {
  return createHash("sha256").update(JSON.stringify({ title: payload.title, description: payload.description, system: payload.system })).digest("hex");
}

export function readableWorldSlug(title: string) {
  const base = title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "world";
  return `${base}-${randomBytes(5).toString("hex")}`;
}

export async function createWorld(ownerId: string, payload: WorldCreationPayload, slugFactory = readableWorldSlug, requestIdentity?: string) {
  const hash = requestIdentity ? createHash("sha256").update(requestIdentity).digest("hex") : worldCreationHash(payload);
  const previous = await prisma.world.findUnique({ where: { ownerId_creationRequestId: { ownerId, creationRequestId: payload.requestId } } });
  if (previous) return { world: previous, created: false, conflict: previous.creationPayloadHash !== hash };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const world = await prisma.world.create({ data: { id: randomUUID(), ownerId, title: payload.title, description: payload.description, system: payload.system, slug: slugFactory(payload.title), creationRequestId: payload.requestId, creationPayloadHash: hash } });
      return { world, created: true, conflict: false };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
      const raced = await prisma.world.findUnique({ where: { ownerId_creationRequestId: { ownerId, creationRequestId: payload.requestId } } });
      if (raced) return { world: raced, created: false, conflict: raced.creationPayloadHash !== hash };
      if (attempt === 4) throw error;
    }
  }
  throw new Error("Unable to allocate a world slug");
}
