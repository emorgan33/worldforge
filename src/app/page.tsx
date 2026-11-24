import { requireRequestTime } from "@/lib/request-time";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { sessionUser } from "@/lib/auth";
import AuthorWorkspace from "@/components/AuthorWorkspace";
import { currentTheme } from "@/lib/theme-server";

async function Workspace() { await requireRequestTime(); const user = await sessionUser(); if (!user) redirect("/login"); if (user.role === "PLAYER") redirect("/player"); const theme = await currentTheme(); return <AuthorWorkspace theme={theme} />; }
export default function HomePage() { return <Suspense fallback={<p className="p-8 text-app-muted">Opening your workspace…</p>}><Workspace /></Suspense>; }
