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
  worldSystem: string;
  onGuardChange?: (registration: { dirty: boolean; busy: boolean } | null) => void;
}

function statusColor(status: string): string {
  switch (status) {
    case "PLANNED": return "text-amber-400 bg-amber-500/10 border-amber-500/30";
    case "PLAYED": return "text-emerald-400 bg-emerald-500/10 border-emerald-500/30";
    case "CANCELLED": return "text-zinc-500 bg-zinc-800/40 border-zinc-700";
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

export function NextSessionDesk({ worldId, sessions, onRefresh, worldSystem, onGuardChange }: NextSessionDeskProps) {
  const [pendingWrites, setPendingWrites] = useState(0);
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");

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
    if (!newTitle.trim()) return;
    if (paused) return;
    setPendingWrites(count => count + 1);
    setError("");
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
            ? "border-amber-600/50 bg-gradient-to-br from-amber-950/30 via-zinc-900 to-zinc-950 shadow-lg shadow-amber-900/10"
            : "border-zinc-800 bg-zinc-900/40 hover:border-zinc-700"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h4 className="font-serif text-lg text-amber-100 truncate">{session.title}</h4>
              {isNext && (
                <span className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-400 border border-amber-500/30">
                  <Star size={10} /> NEXT
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
          <div className="flex items-center gap-1.5 shrink-0">
            {session.status === "PLANNED" && (
              <>
                <button
                  onClick={() => handleUpdateStatus(session.id, "PLAYED")}
                  className="flex items-center gap-1 rounded-lg bg-emerald-600/20 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 transition-colors"
                  title="Mark as played"
                >
                  <Play size={12} /> Start
                </button>
                {!isNext && (
                  <button
                    onClick={() => handleMakeNext(session.id)}
                    className="rounded-lg bg-zinc-800 p-1.5 text-zinc-400 hover:text-amber-300 hover:bg-zinc-700 transition-colors"
                    title="Make next session"
                  >
                    <Star size={13} />
                  </button>
                )}
              </>
            )}
            <button
              onClick={() => handleDelete(session.id)}
              className="rounded-lg p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 transition-colors"
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
                  className="text-zinc-500 hover:text-red-400 ml-0.5"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Add Link Button */}
        <button
          onClick={() => setAddingLinkTo(addingLinkTo === session.id ? null : session.id)}
          className="mt-2 text-[10px] font-semibold text-zinc-500 hover:text-amber-400 transition-colors"
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
              className="flex items-center gap-1 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
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
        <h3 className="font-serif text-xl text-amber-100 flex items-center gap-2">
          <Calendar size={18} className="text-amber-500" />
          Next Session
        </h3>
        <button
          onClick={() => setCreating(!creating)}
          className="flex items-center gap-1 rounded-lg bg-amber-600/20 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-600/30 border border-amber-500/30 transition-colors"
        >
          <Plus size={14} />
          {creating ? "Cancel" : "New Session"}
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-900/40 bg-red-950/20 p-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* Create Form */}
      {creating && (
        <div className="rounded-xl border border-amber-800/40 bg-amber-950/20 p-4">
          <label className="block text-xs font-semibold text-amber-300 mb-1.5">Session Title</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
              placeholder="e.g. Session 1: The Awakening"
              className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900/80 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              autoFocus
            />
            <button
              onClick={handleCreate}
              disabled={!newTitle.trim()}
              className="rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Create
            </button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {sessions.length === 0 && !creating && (
        <div className="rounded-xl border border-dashed border-zinc-700 bg-zinc-900/20 p-8 text-center">
          <Calendar size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-sm text-zinc-400 font-semibold">No sessions yet</p>
          <p className="mt-1 text-xs text-zinc-500">Create your first session to start tracking your campaign.</p>
          <button
            onClick={() => setCreating(true)}
            className="mt-4 inline-flex items-center gap-1 rounded-lg bg-amber-600/20 px-3 py-2 text-xs font-semibold text-amber-300 hover:bg-amber-600/30 border border-amber-500/30 transition-colors"
          >
            <Plus size={14} />
            Create First Session
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
            className="flex items-center gap-1 text-xs font-semibold text-zinc-500 hover:text-zinc-300 transition-colors"
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
