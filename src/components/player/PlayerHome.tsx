"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, BookOpen, LogOut, Trash2, Users } from "lucide-react";

type PlayerWorld = { id: string; slug: string; title: string; description?: string | null };
type ActivityItem = { id: string; kind: "article" | "map"; label: string; title: string; worldTitle: string; href: string; occurredAt: string };
type SavedItem = { id: string; resourceId: string; kind: "article" | "map"; title: string; worldTitle: string; href: string; createdAt: string };

function activityDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PlayerHome({ name, email }: { name: string | null; email: string }) {
  const router = useRouter();
  const [worlds, setWorlds] = useState<PlayerWorld[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const [savedError, setSavedError] = useState("");
  const [savedActionError, setSavedActionError] = useState("");
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

  useEffect(() => {
    let active = true;
    fetch("/api/player/activity", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load what's new.");
        if (active) setActivity(Array.isArray(data.items) ? data.items : []);
      })
      .catch(reason => { if (active) setActivityError(reason instanceof Error ? reason.message : "Could not load what's new."); })
      .finally(() => { if (active) setActivityLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/player/bookmarks", { cache: "no-store" })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load saved items.");
        if (active) setSaved(Array.isArray(data.items) ? data.items : []);
      })
      .catch(reason => { if (active) setSavedError(reason instanceof Error ? reason.message : "Could not load saved items."); })
      .finally(() => { if (active) setSavedLoading(false); });
    return () => { active = false; };
  }, []);

  async function removeSaved(item: SavedItem) {
    setSavedActionError("");
    try {
      const response = await fetch("/api/player/bookmarks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceKind: item.kind, resourceId: item.resourceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not remove this saved item.");
      setSaved(current => current.filter(candidate => candidate.id !== item.id));
    } catch (reason) {
      setSavedActionError(reason instanceof Error ? reason.message : "Could not remove this saved item.");
    }
  }

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
      <section aria-labelledby="player-whats-new" className="border-b border-app-border py-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="player-whats-new" className="font-serif text-2xl font-semibold">What&apos;s new</h2>
            <p className="mt-1 text-sm text-app-muted">Recently shared with you across your campaigns.</p>
          </div>
          {activity.length > 0 && <span className="text-xs uppercase tracking-wider text-app-subtle">{activity.length} update{activity.length === 1 ? "" : "s"}</span>}
        </div>
        {activityError ? <p role="alert" className="mt-4 rounded-lg border border-app-border bg-app-surface/40 px-4 py-3 text-sm text-app-muted">{activityError} Your worlds are still available below.</p> : activityLoading ? <p role="status" className="mt-4 text-sm text-app-muted">Loading updates…</p> : activity.length === 0 ? <p className="mt-4 rounded-xl border border-app-border bg-app-surface/40 px-4 py-6 text-sm text-app-muted">Nothing has been shared with you yet. New articles, recaps, and maps will appear here.</p> : <ul className="mt-4 grid gap-2">
          {activity.map(item => <li key={item.id}>
            <Link href={item.href} className="flex min-h-12 items-center gap-3 rounded-xl border border-app-border bg-app-surface/40 px-4 py-3 transition-colors hover:border-secondary-500/70 hover:bg-app-raised/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">
              <span className="w-24 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-primary-300">{item.label}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-app-text-strong">{item.title}</span>
                <span className="block truncate text-xs text-app-subtle">{item.worldTitle}</span>
              </span>
              <time dateTime={item.occurredAt} className="shrink-0 text-xs text-app-subtle">{activityDate(item.occurredAt)}</time>
            </Link>
          </li>)}
        </ul>}
      </section>
      <section aria-labelledby="player-saved" className="border-b border-app-border py-8">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="player-saved" className="font-serif text-2xl font-semibold">Saved</h2>
            <p className="mt-1 text-sm text-app-muted">Articles and maps you kept for later. Only you can see this list.</p>
          </div>
          {saved.length > 0 && <span className="text-xs uppercase tracking-wider text-app-subtle">{saved.length} saved</span>}
        </div>
        {savedError ? <p role="alert" className="mt-4 rounded-lg border border-app-border bg-app-surface/40 px-4 py-3 text-sm text-app-muted">{savedError}</p> : savedLoading ? <p role="status" className="mt-4 text-sm text-app-muted">Loading saved items…</p> : saved.length === 0 ? <p className="mt-4 rounded-xl border border-app-border bg-app-surface/40 px-4 py-6 text-sm text-app-muted">Nothing saved yet. Use <strong>Save</strong> on an article or map to keep it here.</p> : <>
          {savedActionError && <p role="alert" className="mt-4 rounded-lg border border-danger-900 bg-danger-950/40 px-4 py-3 text-sm text-danger-200">{savedActionError} The item is still saved.</p>}
          <ul className="mt-4 grid gap-2">
          {saved.map(item => <li key={item.id} className="flex items-center gap-2 rounded-xl border border-app-border bg-app-surface/40 pr-2 transition-colors hover:border-secondary-500/70">
            <Link href={item.href} className="flex min-h-12 min-w-0 flex-1 items-center gap-3 px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">
              <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-primary-300">{item.kind}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-app-text-strong">{item.title}</span>
                <span className="block truncate text-xs text-app-subtle">{item.worldTitle}</span>
              </span>
            </Link>
            <button type="button" onClick={() => void removeSaved(item)} aria-label={`Remove ${item.title} from saved`} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-app-subtle hover:bg-app-raised hover:text-danger-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
          </li>)}
        </ul></>}
      </section>
      <section className="py-8">
        {error && <p role="alert" className="rounded-lg border border-danger-900 bg-danger-950/40 p-4 text-sm text-danger-200">{error}</p>}
        {loading ? <p role="status" className="py-12 text-center text-app-muted">Loading your worlds…</p> : !error && worlds.length === 0 ? <div className="mx-auto max-w-xl rounded-2xl border border-app-border bg-app-surface/40 px-6 py-12 text-center"><Users className="mx-auto h-8 w-8 text-primary-400" /><h2 className="mt-4 font-serif text-2xl">No worlds yet</h2><p className="mt-2 text-app-muted">When a game master invites you to a world, accept the invitation link to see it here.</p></div> : <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{worlds.map(world => <Link key={world.id} href={`/c/${world.slug}`} className="group overflow-hidden rounded-2xl border border-app-border bg-app-surface/50 transition hover:-translate-y-0.5 hover:border-primary-500/60"><div className="flex h-44 items-center justify-center bg-gradient-to-br from-secondary-950 via-app-surface to-primary-950"><BookOpen className="h-10 w-10 text-primary-400/70" /></div><div className="p-5"><h2 className="font-serif text-xl font-semibold group-hover:text-primary-200">{world.title}</h2>{world.description && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-app-muted">{world.description}</p>}<span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-secondary-300">Open world <span aria-hidden="true">→</span></span></div></Link>)}</div>}
      </section>
    </div>
  </main>;
}
