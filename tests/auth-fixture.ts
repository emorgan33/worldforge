import { randomBytes, createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { SESSION_COOKIE } from "../src/lib/auth-constants";
export async function authorFetch(db: PrismaClient, userId: string, origin: string) {
  const token = randomBytes(32).toString("base64url");
  await db.authSession.create({ data: { userId, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 60_000 * 30) } });
  return (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers); headers.set("Cookie", `${SESSION_COOKIE}=${token}`); if (!headers.has("Origin")) headers.set("Origin", origin);
    return fetch(input, { ...init, headers });
  };
}
