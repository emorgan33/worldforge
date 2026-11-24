"use client";

import { useRef, useState } from "react";
import { Info, HelpCircle } from "lucide-react";
import { THEME_IDS, THEME_LABELS, type ThemeId } from "@/lib/theme";

/**
 * Compact theme chooser. The selection is applied to <html> immediately and
 * persisted through the preference route, which also updates the cookie so the
 * next server render and anonymous pages agree.
 *
 * Writes are serialized: the control is disabled while a save is in flight, so
 * rapid changes cannot commit out of order, and a stale response can never roll
 * back a newer selection.
 */
export function ThemeSwitcher({ current, className = "" }: { current: ThemeId; className?: string }) {
  const [theme, setTheme] = useState<ThemeId>(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);

  async function change(next: ThemeId) {
    if (saving || next === theme) return;
    const previous = theme;
    const ticket = ++request.current;
    setTheme(next);
    setSaving(true);
    setError("");
    document.documentElement.dataset.theme = next;
    try {
      const response = await fetch("/api/preferences/theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: next }),
      });
      if (!response.ok) throw new Error("save failed");
    } catch {
      if (request.current === ticket) {
        setTheme(previous);
        document.documentElement.dataset.theme = previous;
        setError("Could not save the theme.");
      }
    } finally {
      if (request.current === ticket) setSaving(false);
    }
  }

  const themeDescriptions: Record<ThemeId, string> = {
    "night-watch": "Original dark workspace palette (default)",
    "true-black": "Pure black canvas for OLED; surfaces just above black",
    "daylight": "Neutral warm light palette",
    "pathfinder": "Matches Pathfinder 2e Remaster world theme",
    "dnd": "Matches D&D 5e 2014 world theme",
    "system": "Follows your operating system light/dark preference",
  };

  return (
    <label className={`inline-flex items-center gap-2 text-xs text-app-muted group ${className}`}>
      <span className="hidden sm:inline">Theme</span>
      <div className="relative">
        <select
        aria-label="Interface theme"
        value={theme}
        disabled={saving}
        onChange={event => void change(event.target.value as ThemeId)}
        className="min-h-10 rounded-lg border border-app-border-strong bg-app-surface px-2 text-xs text-app-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300 disabled:opacity-60"
      >
        {THEME_IDS.map(id => <option key={id} value={id}>{THEME_LABELS[id]}</option>)}
      </select>
        <HelpCircle
          className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-app-muted pointer-events-none"
          aria-hidden="true"
        />
        <div className="absolute bottom-full right-0 mb-2 w-72 p-3 rounded-lg border border-app-border-strong bg-app-surface shadow-lg text-xs text-app-text opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity z-10">
          <p className="font-semibold mb-2">Interface theme</p>
          <ul className="space-y-1">
            {THEME_IDS.map(id => (
              <li key={id}><strong>{THEME_LABELS[id]}</strong>: {themeDescriptions[id]}</li>
            ))}
          </ul>
          <p className="mt-2 text-app-muted">Your choice syncs across devices when signed in.</p>
        </div>
      </div>
      {error && <span role="alert" className="text-danger-300">{error}</span>}
    </label>
  );
}
