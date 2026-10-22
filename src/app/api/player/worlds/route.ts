import { sessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await sessionUser();
  if (!user) return Response.json({ error: "Sign in to see your worlds." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const memberships = await prisma.worldMember.findMany({ where: { userId: user.id, status: "ACTIVE", world: { deletedAt: null } }, select: { world: { select: { id: true, slug: true, title: true, description: true } } }, orderBy: { joinedAt: "desc" } });
  return Response.json({ worlds: memberships.map(member => member.world) }, { headers: { "Cache-Control": "private, no-store" } });
}
