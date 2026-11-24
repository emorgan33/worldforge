import { cookies } from "next/headers";
import { sessionUser } from "./authorization-core";
import { prisma } from "./db";
import { resolveTheme, THEME_COOKIE, type ThemeId } from "./theme";

/**
 * Resolve the chrome theme for the current request. The account value is
 * authoritative; the cookie is a projection that keeps anonymous pages (and
 * the first paint before a session is established) in sync.
 */
export async function currentTheme(): Promise<ThemeId> {
  const [cookieTheme, user] = await Promise.all([
    cookies().then(jar => jar.get(THEME_COOKIE)?.value),
    sessionUser(),
  ]);
  if (!user) return resolveTheme(null, cookieTheme);
  const account = await prisma.user.findUnique({ where: { id: user.id }, select: { theme: true } });
  return resolveTheme(account?.theme, cookieTheme);
}
