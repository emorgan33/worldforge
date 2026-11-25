"use client";

import { useState, useEffect, useRef } from "react";
import { Logo } from "./Logo";

interface ResponsiveLogoProps {
  className?: string;
  /** Text to show next to symbol-small at narrow widths */
  fallbackText?: string;
  /** Minimum container width for horizontal logo (default 300px per branding guide) */
  horizontalMinWidth?: number;
  /** Whether adjacent visible text already names "WorldForge" (default: true).
   * When true, horizontal logo is decorative (alt=""). When false, horizontal logo gets alt="WorldForge".
   * In narrow mode, the symbol is always decorative since fallbackText is visible. */
  adjacentTextNamesApp?: boolean;
}

/**
 * Responsive logo that shows horizontal variant when space permits,
 * and falls back to symbol-small + text at narrow widths.
 * Uses a ResizeObserver on the parent element to detect available width.
 */
export function ResponsiveLogo({
  className = "",
  fallbackText = "WorldForge",
  horizontalMinWidth = 300,
  adjacentTextNamesApp = true,
}: ResponsiveLogoProps) {
  const [isNarrow, setIsNarrow] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const parent = container.parentElement;
    if (!parent) return;

    const checkWidth = () => {
      setIsNarrow(parent.clientWidth < horizontalMinWidth);
    };

    checkWidth();

    const resizeObserver = new ResizeObserver(checkWidth);
    resizeObserver.observe(parent);

    return () => resizeObserver.disconnect();
  }, [horizontalMinWidth]);

  if (isNarrow) {
    // Symbol is decorative because fallbackText is visible next to it
    return (
      <span ref={containerRef} className={`inline-flex items-center gap-2 ${className}`}>
        <Logo variant="symbol-small" ariaLabel="" className="h-6 w-auto" />
        <span className="font-serif text-lg font-bold text-app-text-strong">{fallbackText}</span>
      </span>
    );
  }

  // Horizontal logo: decorative if adjacent text names the app, otherwise informative
  return (
    <span ref={containerRef} className={className}>
      <Logo variant="horizontal" ariaLabel={adjacentTextNamesApp ? "" : "WorldForge"} />
    </span>
  );
}