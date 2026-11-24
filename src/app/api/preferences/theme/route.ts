import { cookies } from "next/headers";
import { AccessError, sameOrigin, sessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isThemeId, THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "@/lib/theme";

export async function POST(request: Request) {
  try {
    sameOrigin(request);
    const body = await request.json().catch(() => null);
    const theme = body?.theme;
    if (!isThemeId(theme)) throw new AccessError("Choose a supported theme.", 400);

    const user = await sessionUser();
    if (user) await prisma.user.update({ where: { id: user.id }, data: { theme } });

    (await cookies()).set(THEME_COOKIE, theme, {
      httpOnly: true,
      sameSite: "lax",
      secure: (process.env.WORLDFORGE_ORIGIN || request.url).startsWith("https:"),
      path: "/",
      maxAge: THEME_COOKIE_MAX_AGE,
    });

    return Response.json({ theme }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof AccessError) {
      return Response.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } });
    }
    console.error("Theme preference failed", error);
    return Response.json({ error: "Unable to save this theme." }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
}
