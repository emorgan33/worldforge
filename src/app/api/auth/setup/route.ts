import { sameOrigin, issueSession, AccessError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { tokenHash, hashPassword, validPassword } from "@/lib/passwords";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await request.json();
    if (typeof body?.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || typeof body.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) || body.email.length > 254 || !validPassword(body.password)) throw new AccessError("Use the setup link, a valid email and a password of 12–128 characters.", 400);
    const setup = await prisma.accountSetup.findUnique({ where: { tokenHash: tokenHash(body.token) } });
    if (!setup || setup.usedAt || setup.expiresAt <= new Date()) throw new AccessError("This setup link has expired or has already been used.", 400);
    const passwordHash = await hashPassword(body.password);
    await prisma.$transaction(async tx => {
      const claimed = await tx.accountSetup.updateMany({ where: { tokenHash: setup.tokenHash, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
      if (!claimed.count) throw new AccessError("This setup link has already been used.", 400);
      await tx.user.update({ where: { id: setup.userId }, data: { email: body.email.trim().toLowerCase(), passwordHash } });
      await tx.accountSetup.updateMany({ where: { userId: setup.userId }, data: { usedAt: new Date() } });
      await tx.authSession.deleteMany({ where: { userId: setup.userId } });
    });
    await issueSession(setup.userId, request);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof AccessError ? error.message : "Unable to set up this account. The email may already be in use." }, { status: error instanceof AccessError ? error.status : 400 }); }
}
