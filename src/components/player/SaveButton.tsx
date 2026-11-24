"use client";

import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import type { BookmarkKind } from "@/lib/player-bookmarks";

/**
 * Save/Saved toggle for a campaign article or published map. The bookmark is
 * private to the signed-in account and re-checked for access when the Saved
 * list loads.
 */
export function SaveButton({ kind, resourceId, initialSaved, className = "" }: {
  kind: BookmarkKind;
  resourceId: string;
  initialSaved: boolean;
  className?: string;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function toggle() {
    setBusy(true);
    setError("");
    const next = !saved;
    try {
      const response = await fetch("/api/player/bookmarks", {
        method: next ? "POST" : "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceKind: kind, resourceId }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update this bookmark.");
      setSaved(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update this bookmark.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        aria-pressed={saved}
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300 disabled:opacity-50 ${saved ? "border-primary-500/70 bg-primary-950/30 text-primary-200" : "border-app-border-strong text-app-text-dim hover:border-primary-500/60 hover:text-primary-200"}`}
      >
        {saved ? <BookmarkCheck className="h-4 w-4" aria-hidden="true" /> : <Bookmark className="h-4 w-4" aria-hidden="true" />}
        {busy ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
      {error && <p role="alert" className="text-xs text-danger-300">{error}</p>}
    </div>
  );
}
