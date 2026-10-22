import { Suspense } from "react";
import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth";
import AuthorWorkspace from "@/components/AuthorWorkspace";
async function Workspace() { const user = await sessionUser(); if (!user) redirect("/login"); if (user.role === "PLAYER") redirect("/player"); return <AuthorWorkspace />; }
export default function HomePage() { return <Suspense fallback={<p className="p-8 text-zinc-400">Opening your workspace…</p>}><Workspace /></Suspense>; }
