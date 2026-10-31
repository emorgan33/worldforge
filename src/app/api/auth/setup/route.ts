import { sameOrigin, createSessionRecord, setSessionCookie, AccessError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { newToken, tokenHash, hashPassword, validPassword } from "@/lib/passwords";
import { normalizeEmail } from "@/lib/admin-policy";
import { AccountEligibilityError, requireActiveAccount, withAccountLifecycleLock } from "@/lib/account-lifecycle";
import { SESSION_SECONDS } from "@/lib/auth-constants";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await request.json();
    const normalizedEmail = normalizeEmail(body?.email);
    if (typeof body?.token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.token) || !normalizedEmail || !validPassword(body.password)) throw new AccessError("Use the setup link, a valid email and a password of 12–128 characters.", 400);
    const setup = await prisma.accountSetup.findUnique({ where: { tokenHash: tokenHash(body.token) } });
    if (!setup || setup.usedAt || setup.expiresAt <= new Date()) throw new AccessError("This setup link has expired or has already been used.", 400);
    const passwordHash = await hashPassword(body.password);
    const sessionToken = newToken();
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
    try {
      await withAccountLifecycleLock(prisma, async (tx) => {
        const user = await requireActiveAccount(tx, setup.userId);
        const account = await tx.user.findUnique({ where: { id: user.id }, select: { email: true } });
        if (!account || normalizeEmail(account.email) !== normalizedEmail) throw new AccessError("The setup email must match this account.", 400);
        const claimed = await tx.accountSetup.updateMany({ where: { tokenHash: setup.tokenHash, userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
        if (!claimed.count) throw new AccessError("This setup link has already been used.", 400);
        await tx.user.update({ where: { id: user.id }, data: { passwordHash, accountVersion: { increment: 1 } } });
        await tx.accountSetup.updateMany({ where: { userId: setup.userId }, data: { usedAt: new Date() } });
        await tx.authSession.deleteMany({ where: { userId: setup.userId } });
        await createSessionRecord(tx, user.id, sessionToken, expiresAt);
      });
    } catch (error) {
      if (error instanceof AccountEligibilityError) throw new AccessError("This setup link is not available for this account.", 400);
      throw error;
    }
    await setSessionCookie(sessionToken, request);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof AccessError ? error.message : "Unable to set up this account. The email may already be in use." }, { status: error instanceof AccessError ? error.status : 400 }); }
}
