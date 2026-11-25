"use client";

import { useEffect, useState } from "react";

export type LogoVariant = "horizontal" | "stacked" | "symbol" | "symbol-small";
export type LogoColor = "slate" | "reversed" | "black";

interface LogoProps {
  variant?: LogoVariant;
  className?: string;
  /** Accessible label. Defaults to "WorldForge" for symbol variants, empty for wordmark variants. */
  ariaLabel?: string;
}

/**
 * Theme-aware WorldForge logo component.
 * Selects the appropriate color variant based on the current theme:
 * - Dark themes (night-watch, true-black, system when dark): reversed (parchment on dark)
 * - Light themes (daylight, pathfinder, dnd, system when light): slate (slate on light)
 *
 * Accessibility: horizontal and stacked variants include the "WORLDFORGE" wordmark,
 * so they should be decorative (alt="") when adjacent text names the app.
 * Symbol variants are emblem-only and need alt="WorldForge" when standalone.
 */
export function Logo({ variant = "horizontal", className = "", ariaLabel }: LogoProps) {
  const [theme, setTheme] = useState<ThemeId | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(false);

  useEffect(() => {
    const rootTheme = document.documentElement.dataset.theme as ThemeId | undefined;
    setTheme(rootTheme ?? "night-watch");
    setSystemPrefersDark(window.matchMedia("(prefers-color-scheme: dark)").matches);

    // Listen for theme changes
    const observer = new MutationObserver(() => {
      const newTheme = document.documentElement.dataset.theme as ThemeId | undefined;
      setTheme(newTheme ?? "night-watch");
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    // Also listen for OS color-scheme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = (e: MediaQueryListEvent) => {
      setSystemPrefersDark(e.matches);
      // If using "system" theme, force re-render to pick up new color
      if (document.documentElement.dataset.theme === "system") {
        setTheme("system");
      }
    };
    mediaQuery.addEventListener("change", handleChange);

    return () => {
      observer.disconnect();
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, []);

  const darkThemes: ThemeId[] = ["night-watch", "true-black"];
  const lightThemes: ThemeId[] = ["daylight", "pathfinder", "dnd"];

  const isDark = theme ? darkThemes.includes(theme) || (theme === "system" && systemPrefersDark) : false;
  const color: LogoColor = isDark ? "reversed" : "slate";

  const variantPath = variant === "horizontal" ? "horizontal" : variant === "stacked" ? "stacked" : variant === "symbol-small" ? "symbol-small" : "symbol";

  // Horizontal and stacked include the wordmark; treat as decorative by default.
  // Symbol variants are emblem-only; provide alt text by default.
  const defaultAria = variant === "symbol" || variant === "symbol-small" ? "WorldForge" : "";
  const alt = ariaLabel ?? defaultAria;

  // Intrinsic dimensions per branding guide (width:height aspect ratios)
  // Provide width/height for layout stability; let CSS control display size
  const intrinsicWidth = variant === "horizontal" ? 316 : variant === "stacked" ? 200 : 80;
  const intrinsicHeight = variant === "horizontal" ? 74 : variant === "stacked" ? 132 : 84;

  return (
    <img
      src={`/brand/worldforge/worldforge-${variantPath}-${color}.svg`}
      alt={alt}
      className={className}
      width={intrinsicWidth}
      height={intrinsicHeight}
      // No inline height:auto - let caller control proportional sizing via CSS
    />
  );
}

type ThemeId = "night-watch" | "true-black" | "daylight" | "pathfinder" | "dnd" | "system";