import { redirect } from "next/navigation";
import { requireRequestTime } from "@/lib/request-time";
import { sessionUser } from "@/lib/auth";
import PlayerHome from "@/components/player/PlayerHome";

export const instant = false;

export default async function PlayerPage() {
  await requireRequestTime();
  const user = await sessionUser();
  if (!user) redirect("/login");
  return <PlayerHome name={user.name} email={user.email} />;
}
