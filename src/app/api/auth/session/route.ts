import { sessionUser } from "@/lib/auth";
export async function GET() { return Response.json({ user: await sessionUser() }, { headers: { "Cache-Control": "private, no-store" } }); }
