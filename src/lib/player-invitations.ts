import { prisma } from "./db";
import { newToken, tokenHash } from "./passwords";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const validInviteToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const normalizeInviteEmail = (value: unknown) => typeof value === "string" ? value.trim().toLowerCase() : "";
export const validInviteEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export async function createInvitation(worldId: string, email: string, issuedById: string) {
  const token = newToken();
  const invitation = await prisma.$transaction(async tx => {
    await tx.playerInvitation.updateMany({ where: { worldId, email, claimedAt: null, cancelledAt: null }, data: { cancelledAt: new Date() } });
    return tx.playerInvitation.create({ data: { worldId, email, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + INVITE_TTL_MS), issuedById }, select: { id: true, email: true, expiresAt: true, createdAt: true } });
  });
  return { invitation, token };
}
