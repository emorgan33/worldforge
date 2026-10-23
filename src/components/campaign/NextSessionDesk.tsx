"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import { useState } from "react";
import {
  Calendar,
  Plus,
  Clock,
  MapPin,
  ScrollText,
  CheckCircle,
  Play,
  Star,
  ChevronDown,
  ChevronRight,
  Trash2,
  X,
  Link as LinkIcon,
} from "lucide-react";
import { EntityRelationshipPicker } from "./EntityRelationshipPicker";

export interface SessionEntityLinkItem {
  id: string;
  kind: string;
  entityId: string;
  label?: string | null;
}

export interface SessionItem {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  sessionDate?: string | null;
  inWorldDate?: string | null;
  currentLocation?: string | null;
  recap?: string | null;
  nextPrep?: string | null;
  isNext: boolean;
  order: number;
  linkedEntities: SessionEntityLinkItem[];
}

interface NextSessionDeskProps {
  worldId: string;
  sessions: SessionItem[];
  onRefresh: () => void;
  onGuardChange?: (registration: { dirty: boolean; busy: boolean } | null) => void;
}

function statusColor(status: string): string {
  switch (status) {
    case "PLANNED": return "text-violet-200 bg-violet-500/10 border-violet-400/30";
    case "PLAYED": return "text-emerald-200 bg-emerald-500/10 border-emerald-400/30";
    case "CANCELLED": return "text-zinc-300 bg-zinc-800/60 border-zinc-700";
    default: return "text-zinc-400 bg-zinc-800/40 border-zinc-700";
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

export function NextSessionDesk({ worldId, sessions, onRefresh, onGuardChange }: NextSessionDeskProps) {
  const [pendingWrites, setPendingWrites] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const paused = useWorldGuard({ dirty: !!newTitle, busy: pendingWrites > 0 }, "session", onGuardChange);
  const [showPlayed, setShowPlayed] = useState(false);
  const [recapOpen, setRecapOpen] = useState<Record<string, boolean>>({});
  const [addingLinkTo, setAddingLinkTo] = useState<string | null>(null);
  const [error, setError] = useState("");

  const planned = sessions.filter(s => s.status === "PLANNED");
  const played = sessions.filter(s => s.status === "PLAYED" || s.status === "CANCELLED");

  const nextSession = sessions.find(s => s.isNext) || planned[0];
  const nonNextPlanned = planned.filter(s => s.id !== nextSession?.id);

  async function handleCreate() {
    if (!newTitle.trim()) { setValidationMessage("Enter a title for this session."); return; }
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
    setSuccessMessage("");
    setValidationMessage("");
    try {
      const res = await fetch(`/api/worlds/${worldId}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create session.");
      }
      setNewTitle("");
      setCreating(false);
      setSuccessMessage("Session created.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create session.");
    } finally { setPendingWrites(count => count - 1); }
  }

  async function handleUpdateStatus(sessionId: string, status: string) {
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update session.");
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update session.");
    } finally { setPendingWrites(count => count - 1); }
  }

  async function handleMakeNext(sessionId: string) {
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isNext: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to set next session.");
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to set next session.");
    } finally { setPendingWrites(count => count - 1); }
  }

  async function handleDelete(sessionId: string) {
    if (!window.confirm("Delete this session? This action cannot be undone.")) return;
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete session.");
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to delete session.");
    } finally { setPendingWrites(count => count - 1); }
  }

  async function handleAddLink(kind: string, entityId: string, label?: string) {
    if (!addingLinkTo) return;
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${addingLinkTo}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, entityId, label }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add link.");
      }
      setAddingLinkTo(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to add link.");
    } finally { setPendingWrites(count => count - 1); }
  }

  async function handleRemoveLink(sessionId: string, linkId: string) {
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
    try {
      const res = await fetch(`/api/sessions/${sessionId}/links?linkId=${linkId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove link.");
      }
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove link.");
    } finally { setPendingWrites(count => count - 1); }
  }

  function renderSessionCard(session: SessionItem, isNext: boolean) {
    const isRecapOpen = recapOpen[session.id] ?? false;
    return (
      <div
        key={session.id}
        className={`rounded-xl border p-5 transition-colors ${
          isNext
            ? "border-violet-500/50 bg-violet-950/25"
            : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="break-words text-lg font-semibold leading-snug text-zinc-100">{session.title}</h4>
              {isNext && (
                <span className="flex items-center gap-1 rounded-full border border-violet-400/40 bg-violet-500/15 px-2.5 py-1 text-xs font-semibold text-violet-200">
                  <Star size={12} aria-hidden="true" /> Next session
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-zinc-500">
              <span className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${statusColor(session.status)}`}>
                {session.status}
              </span>
              {session.sessionDate && (
                <span className="flex items-center gap-1">
                  <Calendar size={11} />
                  {formatDate(session.sessionDate)}
                </span>
              )}
              {session.inWorldDate && (
                <span className="flex items-center gap-1">
                  <Clock size={11} />
                  {session.inWorldDate}
                </span>
              )}
              {session.currentLocation && (
                <span className="flex items-center gap-1">
                  <MapPin size={11} />
                  {session.currentLocation}
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            {session.status === "PLANNED" && (
              <>
                <button
                  onClick={() => handleUpdateStatus(session.id, "PLAYED")}
                  className="flex min-h-11 items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-600/20 px-3 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-600/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                  title="Mark as played"
                >
                  <Play size={12} /> Start
                </button>
                {!isNext && (
                  <button
                    onClick={() => handleMakeNext(session.id)}
                    aria-label="Make next session"
                    className="flex h-11 w-11 items-center justify-center rounded-lg bg-zinc-800 text-zinc-300 transition-colors hover:bg-zinc-700 hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                    title="Make next session"
                  >
                    <Star size={13} />
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => handleDelete(session.id)}
              aria-label="Delete session"
              className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-red-900/20 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              title="Delete session"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {/* Linked Entities */}
        {session.linkedEntities.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {session.linkedEntities.map(link => (
              <span
                key={link.id}
                className="inline-flex items-center gap-1 rounded bg-zinc-800/70 px-2 py-0.5 text-[10px] text-zinc-300 border border-zinc-700/50"
              >
                <LinkIcon size={10} className="text-zinc-500" />
                {link.label || link.entityId.slice(0, 8)}
                <button
                  onClick={() => handleRemoveLink(session.id, link.id)}
                  aria-label={`Remove ${link.label || "linked entity"}`}
                  className="ml-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded text-zinc-400 hover:bg-red-900/20 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Add Link Button */}
        <button
          onClick={() => setAddingLinkTo(addingLinkTo === session.id ? null : session.id)}
          className="mt-2 inline-flex min-h-11 items-center text-xs font-semibold text-zinc-400 transition-colors hover:text-violet-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
        >
          {addingLinkTo === session.id ? "Cancel" : "+ Link entity"}
        </button>

        {addingLinkTo === session.id && (
          <div className="mt-2">
            <EntityRelationshipPicker
              worldId={worldId}
              onSelect={(kind, entityId, label) => handleAddLink(kind, entityId, label)}
            />
          </div>
        )}

        {/* Recap (collapsible) */}
        {session.recap && (
          <div className="mt-3">
            <button
              onClick={() => setRecapOpen(prev => ({ ...prev, [session.id]: !isRecapOpen }))}
              aria-expanded={isRecapOpen}
              className="flex min-h-11 items-center gap-2 text-xs font-semibold text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
            >
              {isRecapOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <ScrollText size={13} />
              Recap
            </button>
            {isRecapOpen && (
              <div className="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs text-zinc-300 leading-relaxed whitespace-pre-wrap">
                {session.recap}
              </div>
            )}
          </div>
        )}

        {/* Next Prep */}
        {session.nextPrep && (
          <div className="mt-2 text-xs text-zinc-400">
            <span className="font-semibold text-zinc-500">Next prep: </span>
            {session.nextPrep}
          </div>
        )}

        {session.description && (
          <p className="mt-2 text-xs text-zinc-500 italic">{session.description}</p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-xl font-semibold text-zinc-100">
          <Calendar size={18} className="text-zinc-400" aria-hidden="true" />
          Next Session
        </h3>
        {!(sessions.length === 0 && !creating) && <button
          onClick={() => setCreating(!creating)}
          disabled={pendingWrites > 0}
          aria-expanded={creating}
          className={`flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-wait disabled:opacity-60 ${creating ? "border border-zinc-600 bg-transparent text-zinc-200 hover:border-zinc-400 hover:bg-zinc-800" : "bg-violet-400 text-zinc-950 hover:bg-violet-300"}`}
        >
          <Plus size={16} aria-hidden="true" />
          {creating ? "Cancel" : "New Session"}
        </button>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {successMessage && <p role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/30 p-3 text-sm text-emerald-200">{successMessage}</p>}

      {/* Create Form */}
      {creating && (
        <form onSubmit={event => { event.preventDefault(); void handleCreate(); }} className="rounded-xl border border-zinc-700 bg-zinc-950/40 p-4">
          <label htmlFor="new-session-title" className="mb-1.5 block text-sm font-semibold text-zinc-200">Session title</label>
          <div className="flex flex-col gap-2 min-[1150px]:flex-row">
            <input
              id="new-session-title"
              type="text"
              value={newTitle}
              onChange={e => { setNewTitle(e.target.value); setValidationMessage(""); }}
              placeholder="e.g. Session 1: The Awakening"
              aria-invalid={!!validationMessage}
              aria-describedby={validationMessage ? "new-session-error" : undefined}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30"
              autoFocus
            />
            <button
              type="submit"
              disabled={pendingWrites > 0}
              className="min-h-11 shrink-0 rounded-lg bg-violet-400 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 disabled:cursor-wait disabled:opacity-60"
            >
              {pendingWrites > 0 ? "Creating…" : "Create session"}
            </button>
          </div>
          {validationMessage && <p id="new-session-error" role="alert" className="mt-2 text-sm text-red-300">{validationMessage}</p>}
        </form>
      )}

      {/* Empty State */}
      {sessions.length === 0 && !creating && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 p-5">
          <Calendar size={22} aria-hidden="true" className="mb-3 text-zinc-500" />
          <p className="text-sm font-semibold text-zinc-200">No sessions planned yet</p>
          <p className="mt-1 text-sm text-zinc-400">Create a session to set the next date, track table notes, and link the people and places involved.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-violet-400 px-4 text-sm font-semibold text-zinc-950 transition-colors hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"
          >
            <Plus size={16} aria-hidden="true" />
            Create first session
          </button>
        </div>
      )}

      {/* Next Session Card */}
      {nextSession && nextSession.status === "PLANNED" && renderSessionCard(nextSession, true)}

      {/* Other Planned Sessions */}
      {nonNextPlanned.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Upcoming Sessions ({nonNextPlanned.length})
          </h4>
          {nonNextPlanned.map(s => renderSessionCard(s, false))}
        </div>
      )}

      {/* Played Sessions (collapsible) */}
      {played.length > 0 && (
        <div className="space-y-2">
          <button
            onClick={() => setShowPlayed(!showPlayed)}
            aria-expanded={showPlayed}
            className="flex min-h-11 items-center gap-2 text-xs font-semibold text-zinc-400 transition-colors hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
          >
            {showPlayed ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <CheckCircle size={13} />
            Past Sessions ({played.length})
          </button>
          {showPlayed && (
            <div className="space-y-2 opacity-70">
              {played.map(s => renderSessionCard(s, false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
