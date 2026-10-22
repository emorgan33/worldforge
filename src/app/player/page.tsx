import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth";
import PlayerHome from "@/components/player/PlayerHome";

export const instant = false;

export default async function PlayerPage() {
  const user = await sessionUser();
  if (!user) redirect("/login");
  return <PlayerHome name={user.name} email={user.email} />;
}
