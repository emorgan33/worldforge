"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2, NotebookPen, Plus, Search, Trash2 } from "lucide-react";

type PlayerWorld = { id: string; title: string };
type NoteReference = { kind: "article" | "map"; resourceId: string; title: string; href: string };
type NoteItem = {
  id: string;
  title: string;
  content: string;
  version: number;
  worldId: string | null;
  worldTitle: string | null;
  updatedAt: string;
  reference: NoteReference | null;
};
type Draft = {
  id: string | null;
  title: string;
  content: string;
  version: number;
  worldId: string | null;
  reference: { kind: "article" | "map"; resourceId: string; title: string; href?: string } | null;
};

const EMPTY_DRAFT: Draft = { id: null, title: "", content: "", version: 0, worldId: null, reference: null };

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function draftFromNote(note: NoteItem): Draft {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    version: note.version,
    worldId: note.worldId,
    reference: note.reference ? { kind: note.reference.kind, resourceId: note.reference.resourceId, title: note.reference.title, href: note.reference.href } : null,
  };
}

export default function PlayerNotebook() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [worlds, setWorlds] = useState<PlayerWorld[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [query, setQuery] = useState("");
  const [worldFilter, setWorldFilter] = useState("");
  const [conflict, setConflict] = useState<{ title: string; content: string; version: number; worldId: string | null } | null>(null);
  const [campaignDirty, setCampaignDirty] = useState(false);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const [notesResponse, worldsResponse] = await Promise.all([
      fetch("/api/player/notes", { cache: "no-store" }),
      fetch("/api/player/worlds", { cache: "no-store" }),
    ]);
    const notesData = await notesResponse.json().catch(() => ({}));
    if (!notesResponse.ok) throw new Error(notesData.error || "Could not load your notebook.");
    const worldsData = await worldsResponse.json().catch(() => ({}));
    setNotes(Array.isArray(notesData.notes) ? notesData.notes : []);
    setWorlds(Array.isArray(worldsData.worlds) ? worldsData.worlds.map((world: PlayerWorld) => ({ id: world.id, title: world.title })) : []);
  }, []);

  useEffect(() => {
    let active = true;
    load()
      .catch(reason => { if (active) setLoadError(reason instanceof Error ? reason.message : "Could not load your notebook."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load]);

  // Prefill from "Take a note" on an article or map page.
  useEffect(() => {
    if (initialized.current || loading) return;
    initialized.current = true;
    const kind = searchParams.get("kind");
    const resourceId = searchParams.get("resourceId");
    const label = searchParams.get("label");
    const worldId = searchParams.get("worldId");
    if ((kind !== "article" && kind !== "map") || !resourceId || !label) return;
    setDraft({
      ...EMPTY_DRAFT,
      title: label.slice(0, 200),
      worldId: worldId || null,
      reference: { kind, resourceId, title: label },
    });
    setDirty(true);
    router.replace("/player/notebook");
  }, [loading, router, searchParams]);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const visibleNotes = useMemo(() => notes.filter(note => {
    if (worldFilter && note.worldId !== worldFilter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return note.title.toLowerCase().includes(needle) || note.content.toLowerCase().includes(needle);
  }), [notes, query, worldFilter]);

  const pending = saving || deleting;

  function selectNote(note: NoteItem) {
    if (pending) return;
    if (dirty && !window.confirm("Discard unsaved changes to this note?")) return;
    setDraft(draftFromNote(note));
    setDirty(false);
    setCampaignDirty(false);
    setConflict(null);
    setActionError("");
    setNotice("");
  }

  function newNote() {
    if (pending) return;
    if (dirty && !window.confirm("Discard unsaved changes to this note?")) return;
    setDraft({ ...EMPTY_DRAFT, worldId: worldFilter || null });
    setDirty(false);
    setCampaignDirty(false);
    setConflict(null);
    setActionError("");
    setNotice("");
  }

  function updateDraft(changes: Partial<Draft>) {
    setDraft(current => ({ ...current, ...changes }));
    setDirty(true);
    setNotice("");
  }

  async function save() {
    if (!draft.title.trim()) { setActionError("Give the note a title before saving."); return; }
    const submitted = draft;
    setSaving(true); setActionError(""); setNotice("");
    try {
      const response = await fetch("/api/player/notes", {
        method: submitted.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted.id
          ? { id: submitted.id, title: submitted.title, content: submitted.content, version: submitted.version, ...(campaignDirty ? { worldId: submitted.worldId } : {}) }
          : {
              title: submitted.title,
              content: submitted.content,
              worldId: submitted.worldId,
              resourceKind: submitted.reference?.kind ?? null,
              resourceId: submitted.reference?.resourceId ?? null,
            }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.note) {
        setConflict({ title: data.note.title, content: data.note.content, version: data.note.version, worldId: data.note.worldId ?? null });
        return;
      }
      if (!response.ok) throw new Error(data.error || "Could not save this note.");

      // Adopt the server identity immediately; a failed list refresh must not
      // leave a committed note as a retryable create.
      setDraft(current => submitted.id
        ? { ...current, version: typeof data.version === "number" ? data.version : submitted.version + 1 }
        : { ...submitted, id: data.note.id, version: data.note.version, worldId: data.note.worldId ?? submitted.worldId });
      setDirty(false);
      setCampaignDirty(false);
      setConflict(null);
      setNotice("Saved.");
      try {
        await load();
      } catch {
        setActionError("Saved, but the note list could not refresh. Reload the page to see it.");
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not save this note.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!draft.id) return;
    if (!window.confirm(`Delete “${draft.title}”? This cannot be undone.`)) return;
    setDeleting(true); setActionError(""); setNotice("");
    try {
      const response = await fetch("/api/player/notes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: draft.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not delete this note.");
      setDraft(EMPTY_DRAFT);
      setDirty(false);
      setConflict(null);
      setNotice("Note deleted.");
      try {
        await load();
      } catch {
        setActionError("Deleted, but the note list could not refresh. Reload the page to confirm.");
      }
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Could not delete this note.");
    } finally { setDeleting(false); }
  }

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(`${draft.title}\n\n${draft.content}`);
      setNotice("Copied your draft.");
    } catch { setActionError("Could not copy the draft. Select the text instead."); }
  }

  const selectedWorld = draft.worldId ? worlds.find(world => world.id === draft.worldId) ?? null : null;

  return (
    <main className="min-h-screen bg-app-canvas px-5 py-8 text-app-text-strong sm:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-app-border pb-6">
          <div>
            <Link href="/player" onNavigate={event => { if (dirty && !window.confirm("Discard unsaved changes to this note?")) event.preventDefault(); }} className="inline-flex items-center gap-2 text-sm text-secondary-300 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Player portal</Link>
            <h1 className="mt-2 flex items-center gap-2 font-serif text-3xl font-bold"><NotebookPen className="h-7 w-7 text-primary-400" aria-hidden="true" />Notebook</h1>
            <p className="mt-1 text-sm text-app-muted">Private notes on your campaigns. Only you can read them.</p>
          </div>
          <button type="button" onClick={newNote} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-app-on-accent hover:bg-primary-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><Plus className="h-4 w-4" aria-hidden="true" />New note</button>
        </header>

        {loadError ? <p role="alert" className="mt-6 rounded-lg border border-danger-900 bg-danger-950/40 p-4 text-sm text-danger-200">{loadError}</p> : loading ? <p role="status" className="mt-6 flex items-center gap-2 text-sm text-app-muted"><Loader2 className="h-4 w-4 animate-spin" />Loading your notebook…</p> : <div className="mt-6 grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <aside aria-label="Your notes" className="space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wider text-app-subtle">Search notes
              <span className="relative mt-1 block">
                <Search className="pointer-events-none absolute left-2 top-3 h-4 w-4 text-app-subtle" aria-hidden="true" />
                <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Title or text" className="w-full rounded-lg border border-app-border bg-app-surface py-2 pl-8 pr-3 text-sm text-app-text-strong focus:border-primary-500 focus:outline-none" />
              </span>
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wider text-app-subtle">Campaign
              <select value={worldFilter} onChange={event => setWorldFilter(event.target.value)} className="mt-1 w-full rounded-lg border border-app-border bg-app-surface px-2 py-2 text-sm text-app-text-strong">
                <option value="">All campaigns</option>
                {worlds.map(world => <option key={world.id} value={world.id}>{world.title}</option>)}
              </select>
            </label>
            <ul className="max-h-[32rem] space-y-1 overflow-y-auto pr-1">
              {visibleNotes.map(note => <li key={note.id}>
                <button type="button" onClick={() => selectNote(note)} disabled={pending} aria-current={draft.id === note.id ? "true" : undefined} className={`w-full rounded-lg border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300 ${draft.id === note.id ? "border-primary-500/70 bg-primary-950/25" : "border-app-border bg-app-surface/40 hover:bg-app-raised/60"}`}>
                  <span className="block truncate text-sm font-medium text-app-text-strong">{note.title}</span>
                  <span className="mt-0.5 flex justify-between gap-2 text-xs text-app-subtle"><span className="truncate">{note.worldTitle || "No campaign"}</span><span className="shrink-0">{formatDate(note.updatedAt)}</span></span>
                </button>
              </li>)}
              {visibleNotes.length === 0 && <li className="rounded-lg border border-app-border bg-app-surface/40 px-3 py-6 text-sm text-app-muted">{notes.length === 0 ? "No notes yet. Start with New note." : "No notes match this search."}</li>}
            </ul>
          </aside>

          <section aria-label="Note editor" className="space-y-3 rounded-xl border border-app-border bg-app-surface/40 p-4 sm:p-5">
            {draft.reference && <p className="rounded-lg border border-app-border bg-app-canvas/50 px-3 py-2 text-xs text-app-muted">About: {draft.reference.href ? <Link href={draft.reference.href} onNavigate={event => { if (dirty && !window.confirm("Discard unsaved changes to this note?")) event.preventDefault(); }} className="font-semibold text-secondary-300 underline">{draft.reference.title}</Link> : <strong className="text-app-text-dim">{draft.reference.title}</strong>} ({draft.reference.kind})</p>}
            <label className="block text-xs font-semibold uppercase tracking-wider text-app-subtle">Title
              <input value={draft.title} disabled={pending} onChange={event => updateDraft({ title: event.target.value })} maxLength={200} className="mt-1 w-full rounded-lg border border-app-border bg-app-canvas px-3 py-2 text-lg text-app-text-strong focus:border-primary-500 focus:outline-none" placeholder="What is this note about?" />
            </label>
            <label className="block text-xs font-semibold uppercase tracking-wider text-app-subtle">Note
              <textarea value={draft.content} disabled={pending} onChange={event => updateDraft({ content: event.target.value })} maxLength={20000} rows={14} className="mt-1 w-full rounded-lg border border-app-border bg-app-canvas px-3 py-2 text-sm leading-relaxed text-app-text-strong focus:border-primary-500 focus:outline-none" placeholder="Clues, plans, names, things to ask the GM…" />
            </label>
            <div className="flex flex-wrap items-center gap-3 text-xs text-app-subtle">
              <label className="flex items-center gap-2">Campaign
                <select
                  value={draft.worldId ?? ""}
                  disabled={pending || Boolean(draft.reference)}
                  onChange={event => { updateDraft({ worldId: event.target.value || null }); setCampaignDirty(true); }}
                  className="rounded-lg border border-app-border bg-app-canvas px-2 py-1.5 text-sm text-app-text-strong disabled:opacity-60"
                >
                  <option value="">No campaign</option>
                  {worlds.map(world => <option key={world.id} value={world.id}>{world.title}</option>)}
                </select>
              </label>
              {draft.reference && <span>· reference locked to {selectedWorld?.title || "its campaign"}</span>}
              <span className="ml-auto">{dirty ? "Unsaved changes" : draft.id ? "Saved" : ""}</span>
            </div>

            {conflict && <div role="alert" className="rounded-lg border border-primary-700/60 bg-primary-950/25 px-3 py-2 text-sm text-primary-200">
              <p className="font-semibold">This note changed on another device.</p>
              <p className="mt-1 text-xs">Your draft is still here. Load the latest version or copy your draft before replacing it.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setDraft(current => ({ ...current, title: conflict.title, content: conflict.content, version: conflict.version, worldId: conflict.worldId })); setConflict(null); setDirty(false); setCampaignDirty(false); setNotice("Loaded the latest version."); }} className="rounded border border-primary-500/60 px-2 py-1 text-xs text-primary-100 hover:bg-primary-900/40">Load latest</button>
                <button type="button" onClick={() => setConflict(null)} className="rounded border border-app-border px-2 py-1 text-xs text-app-text">Keep my draft</button>
                <button type="button" onClick={() => void copyDraft()} className="rounded border border-app-border px-2 py-1 text-xs text-app-text">Copy my draft</button>
              </div>
            </div>}

            {actionError && <p role="alert" className="rounded-lg border border-danger-900 bg-danger-950/40 px-3 py-2 text-sm text-danger-200">{actionError}</p>}
            {notice && <p role="status" className="text-xs text-success-300">{notice}</p>}

            <div className="flex flex-wrap items-center gap-2 border-t border-app-border pt-3">
              <button type="button" onClick={() => void save()} disabled={pending || !draft.title.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-app-on-accent hover:bg-primary-500 disabled:opacity-50">{saving ? "Saving…" : draft.id ? "Save changes" : "Save note"}</button>
              {draft.id && <button type="button" onClick={() => void remove()} disabled={pending} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-app-border px-3 text-sm text-danger-300 hover:bg-app-raised disabled:opacity-50"><Trash2 className="h-4 w-4" aria-hidden="true" />{deleting ? "Deleting…" : "Delete"}</button>}
            </div>
          </section>
        </div>}
      </div>
    </main>
  );
}
