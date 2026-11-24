import { sameOrigin, revokeSession, AccessError } from "@/lib/auth";
import { AccountLifecycleConflictError } from "@/lib/account-lifecycle";
import { cookies } from "next/headers";
import { currentTheme } from "@/lib/theme-server";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE } from "@/lib/theme";

export function createLogoutPost(revoke: typeof revokeSession = revokeSession) {
  return async function POST(request: Request) {
    try {
      sameOrigin(request);
      // Keep the signed-out device on the theme the user last saw. Theming must
      // never make sign-out fail, so resolution and the cookie write are
      // best-effort.
      let theme: string | null = null;
      try { theme = await currentTheme(); } catch {}
      await revoke();
      if (theme) {
        try {
          (await cookies()).set(THEME_COOKIE, theme, {
            httpOnly: true,
            sameSite: "lax",
            secure: (process.env.WORLDFORGE_ORIGIN || request.url).startsWith("https:"),
            path: "/",
            maxAge: THEME_COOKIE_MAX_AGE,
          });
        } catch {}
      }
      return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) {
      if (error instanceof AccountLifecycleConflictError) return Response.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
      return Response.json({ error: error instanceof AccessError ? error.message : "Unable to sign out." }, { status: error instanceof AccessError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}
