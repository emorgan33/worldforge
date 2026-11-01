import { sameOrigin, revokeSession, AccessError } from "@/lib/auth";
import { AccountLifecycleConflictError } from "@/lib/account-lifecycle";

export function createLogoutPost(revoke: typeof revokeSession = revokeSession) {
  return async function POST(request: Request) {
    try { sameOrigin(request); await revoke(); return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) {
      if (error instanceof AccountLifecycleConflictError) return Response.json({ error: error.message }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "2" } });
      return Response.json({ error: error instanceof AccessError ? error.message : "Unable to sign out." }, { status: error instanceof AccessError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
    }
  };
}
