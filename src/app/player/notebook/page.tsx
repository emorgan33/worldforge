import { Suspense } from "react";
import { redirect } from "next/navigation";
import { resolvePageActor } from "@/lib/access";
import { ReaderThemeBar } from "@/components/theme/ReaderThemeBar";
import PlayerNotebook from "@/components/player/PlayerNotebook";

export const instant = false;

export default async function PlayerNotebookPage() {
  const actor = await resolvePageActor();
  if (!actor.userId) redirect("/login");
  // The notebook belongs to a real account; a GM preview must not read it.
  if (actor.kind === "PREVIEW") redirect("/");
  return (
    <>
      <ReaderThemeBar />
      <Suspense fallback={<main className="min-h-screen bg-app-canvas p-8 text-sm text-app-muted">Loading your notebook…</main>}>
        <PlayerNotebook />
      </Suspense>
    </>
  );
}
