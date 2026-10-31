import { sameOrigin, issueSession, AccessError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { verifyPassword, validPassword } from "@/lib/passwords";
import { allowLogin, releaseSuccessfulLogin, loginSource } from "@/lib/login-limit";
import { AccountLifecycleConflictError } from "@/lib/account-lifecycle";
export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase().slice(0, 254) : "";
    const source = loginSource(request);
    if (!await allowLogin(email, source)) return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429, headers: { "Retry-After": "900" } });
    const user = await prisma.user.findFirst({ where: { email: { equals: email } }, select: { id: true, passwordHash: true, accountVersion: true } });
    const encoded = user?.passwordHash || `scrypt-v1:${"0".repeat(32)}:${"0".repeat(128)}`;
    const verified = validPassword(body.password) && await verifyPassword(body.password, encoded);
    if (!user?.passwordHash || !verified) {
      return Response.json({ error: "Email or password is incorrect." }, { status: 401 });
    }
    if (!await issueSession(user.id, request, { passwordHash: user.passwordHash, accountVersion: user.accountVersion })) return Response.json({ error: "Email or password is incorrect." }, { status: 401, headers: { "Cache-Control": "no-store" } });
    await releaseSuccessfulLogin(email, source);
    return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AccessError) return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    if (error instanceof AccountLifecycleConflictError) return Response.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
    return Response.json({ error: "Unable to sign in." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
