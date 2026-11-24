"use client";

import { useState } from "react";
import { THEME_IDS, THEME_LABELS, type ThemeId } from "@/lib/theme";

/**
 * Compact theme chooser. The selection is applied to <html> immediately and
 * persisted through the preference route, which also updates the cookie so the
 * next server render and anonymous pages agree.
 */
export function ThemeSwitcher({ current, className = "" }: { current: ThemeId; className?: string }) {
  const [theme, setTheme] = useState<ThemeId>(current);
  const [error, setError] = useState("");

  async function change(next: ThemeId) {
    const previous = theme;
    setTheme(next);
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
      setTheme(previous);
      document.documentElement.dataset.theme = previous;
      setError("Could not save the theme.");
    }
  }

  return (
    <label className={`inline-flex items-center gap-2 text-xs text-app-muted ${className}`}>
      <span className="hidden sm:inline">Theme</span>
      <select
        aria-label="Interface theme"
        value={theme}
        onChange={event => void change(event.target.value as ThemeId)}
        className="min-h-10 rounded-lg border border-app-border-strong bg-app-surface px-2 text-xs text-app-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"
      >
        {THEME_IDS.map(id => <option key={id} value={id}>{THEME_LABELS[id]}</option>)}
      </select>
      {error && <span role="alert" className="text-danger-300">{error}</span>}
    </label>
  );
}
