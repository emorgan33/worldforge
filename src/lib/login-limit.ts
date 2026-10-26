import { prisma } from "./db";
import { tokenHash } from "./passwords";
// A durable server-wide bound avoids trusting spoofable forwarding headers on this self-hosted app.
export async function allowLogin(email: string) {
  const now = new Date();
  return prisma.$transaction(async tx => {
    // Keep throttling isolated to the attempted account. A shared global
    // bucket lets unauthenticated traffic deny sign-in for every user.
    const key = tokenHash(email.toLowerCase());
    const existing = await tx.loginLimit.findUnique({ where: { key } });
    if (existing && existing.resetsAt > now && existing.attempts >= 8) return false;
    await tx.loginLimit.upsert({ where: { key }, create: { key, attempts: 1, resetsAt: new Date(now.getTime() + 15 * 60_000) }, update: existing && existing.resetsAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetsAt: new Date(now.getTime() + 15 * 60_000) } });
    return true;
  });
}
