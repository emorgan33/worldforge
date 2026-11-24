/**
 * Application chrome themes. Stored values are stable identifiers; the
 * `system` value is resolved by CSS, not by the server.
 */
export const THEME_IDS = ["night-watch", "daylight", "system"] as const;
export type ThemeId = (typeof THEME_IDS)[number];
export const DEFAULT_THEME: ThemeId = "night-watch";

export const THEME_COOKIE = "wf_theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const THEME_LABELS: Record<ThemeId, string> = {
  "night-watch": "Night watch",
  daylight: "Daylight",
  system: "Match system",
};

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEME_IDS as readonly string[]).includes(value);
}

/**
 * The account value is authoritative; the cookie is its projection. Both are
 * validated, and anything unrecognized falls back to the default.
 */
export function resolveTheme(accountTheme: unknown, cookieTheme: unknown): ThemeId {
  if (isThemeId(accountTheme)) return accountTheme;
  if (isThemeId(cookieTheme)) return cookieTheme;
  return DEFAULT_THEME;
}

/** Browsers need `color-scheme` to style native controls and scrollbars. */
export function colorSchemeFor(theme: ThemeId): "dark" | "light" {
  if (theme === "daylight") return "light";
  if (theme === "system") return "dark";
  return "dark";
}
