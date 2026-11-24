"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, LogOut, Users } from "lucide-react";

type PlayerWorld = { id: string; slug: string; title: string; description?: string | null };

export default function PlayerHome({ name, email }: { name: string | null; email: string }) {
  const router = useRouter();
  const [worlds, setWorlds] = useState<PlayerWorld[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/player/worlds", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load your worlds.");
        if (active) setWorlds(Array.isArray(data.worlds) ? data.worlds : []);
      })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Could not load your worlds."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally { setSigningOut(false); }
  }

  return <main className="min-h-screen bg-app-canvas px-5 py-8 text-app-text-strong sm:px-8">
    <div className="mx-auto max-w-6xl">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-app-border pb-6">
        <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-400">WorldForge · Player</p><h1 className="mt-2 font-serif text-3xl font-bold">Your worlds</h1><p className="mt-1 text-sm text-app-muted">Welcome{ name ? `, ${name}` : ""}. Choose a world to continue reading.</p></div>
        <div className="flex flex-wrap items-center gap-3"><Link href="/" className="inline-flex items-center gap-2 rounded-lg border border-app-border-strong px-3 py-2 text-sm text-app-text-dim hover:border-app-border-emphasis-strong hover:text-app-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to main site</Link><span className="hidden text-sm text-app-subtle sm:inline">{email}</span><button onClick={signOut} disabled={signingOut} className="inline-flex items-center gap-2 rounded-lg border border-app-border-strong px-3 py-2 text-sm text-app-text-dim hover:border-app-border-emphasis-strong disabled:opacity-50"><LogOut className="h-4 w-4" />{signingOut ? "Signing out…" : "Sign out"}</button></div>
      </header>
      <section className="py-8">
        {error && <p role="alert" className="rounded-lg border border-danger-900 bg-danger-950/40 p-4 text-sm text-danger-200">{error}</p>}
        {loading ? <p role="status" className="py-12 text-center text-app-muted">Loading your worlds…</p> : !error && worlds.length === 0 ? <div className="mx-auto max-w-xl rounded-2xl border border-app-border bg-app-surface/40 px-6 py-12 text-center"><Users className="mx-auto h-8 w-8 text-primary-400" /><h2 className="mt-4 font-serif text-2xl">No worlds yet</h2><p className="mt-2 text-app-muted">When a game master invites you to a world, accept the invitation link to see it here.</p></div> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{worlds.map(world => <Link key={world.id} href={`/c/${world.slug}`} className="group overflow-hidden rounded-2xl border border-app-border bg-app-surface/50 transition hover:-translate-y-0.5 hover:border-primary-500/60"><div className="flex h-44 items-center justify-center bg-gradient-to-br from-secondary-950 via-app-surface to-primary-950"><BookOpen className="h-10 w-10 text-primary-400/70" /></div><div className="p-5"><h2 className="font-serif text-xl font-semibold group-hover:text-primary-200">{world.title}</h2>{world.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-app-muted">{world.description}</p>}<span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-secondary-300">Open world <span aria-hidden="true">→</span></span></div></Link>)}</div>}
      </section>
    </div>
  </main>;
}
