import { isIP } from "node:net";
import { prisma } from "./db";
import { tokenHash } from "./passwords";
import { AccessError } from "./authorization-core";

const WINDOW_MS = 15 * 60_000;

export function loginSource(request: Request): string {
  // Generic forwarding headers are never used as identities. This dedicated
  // header is accepted only from an explicitly trusted proxy or in development.
  if (process.env.WORLDFORGE_TRUSTED_PROXY !== "1" && process.env.NODE_ENV === "production") {
    if (process.env.WORLDFORGE_ORIGIN?.startsWith("https://")) throw new AccessError("Trusted proxy is required for public sign-in.", 503);
    return "local";
  }
  const source = request.headers.get("x-worldforge-client-ip");
  if (!source && process.env.WORLDFORGE_TRUSTED_PROXY === "1" && process.env.NODE_ENV === "production") throw new AccessError("Trusted proxy client address is missing.", 503);
  if (!source) return "local";
  if (!isIP(source)) throw new AccessError("Invalid client address from the trusted proxy.", 503);
  return source;
}

function keys(email: string, source: string) {
  return [tokenHash(`login-source:${source}`), tokenHash(`login-account:${source}:${email.toLowerCase()}`)] as const;
}

export async function allowLogin(email: string, source: string): Promise<boolean> {
  const now = new Date();
  const [sourceKey, accountKey] = keys(email, source);
  return prisma.$transaction(async tx => {
    const limits = await Promise.all([sourceKey, accountKey].map(key => tx.loginLimit.findUnique({ where: { key } })));
    if (limits.some((limit, index) => limit && limit.resetsAt > now && limit.attempts >= (index === 0 ? 30 : 8))) return false;
    for (const [index, key] of [sourceKey, accountKey].entries()) {
      const existing = limits[index];
      await tx.loginLimit.upsert({ where: { key }, create: { key, attempts: 1, resetsAt: new Date(now.getTime() + WINDOW_MS) }, update: existing && existing.resetsAt > now ? { attempts: { increment: 1 } } : { attempts: 1, resetsAt: new Date(now.getTime() + WINDOW_MS) } });
    }
    return true;
  });
}

export async function releaseSuccessfulLogin(email: string, source: string) {
  const [sourceKey, accountKey] = keys(email, source);
  await prisma.$transaction(async tx => {
    await tx.loginLimit.updateMany({ where: { key: sourceKey, attempts: { gt: 0 } }, data: { attempts: { decrement: 1 } } });
    await tx.loginLimit.deleteMany({ where: { key: sourceKey, attempts: 0 } });
    await tx.loginLimit.deleteMany({ where: { key: accountKey } });
  });
}
