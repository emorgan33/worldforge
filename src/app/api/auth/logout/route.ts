import { sameOrigin, revokeSession, AccessError } from "@/lib/auth";
export async function POST(request: Request) {
  try { sameOrigin(request); await revokeSession(); return Response.json({ success: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: "Unable to sign out." }, { status: error instanceof AccessError ? error.status : 500 }); }
}
