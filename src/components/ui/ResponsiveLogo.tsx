"use client";

import { useState, useEffect, useRef } from "react";
import { Logo } from "./Logo";

interface ResponsiveLogoProps {
  className?: string;
  /** Text to show next to symbol-small at narrow widths */
  fallbackText?: string;
  /** Minimum container width for horizontal logo (default 300px per branding guide) */
  horizontalMinWidth?: number;
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
    return (
      <span ref={containerRef} className={`inline-flex items-center gap-2 ${className}`}>
        <Logo variant="symbol-small" ariaLabel="WorldForge" className="h-6 w-auto" />
        <span className="font-serif text-lg font-bold text-app-text-strong">{fallbackText}</span>
      </span>
    );
  }

  return (
    <span ref={containerRef} className={className}>
      <Logo variant="horizontal" ariaLabel="" />
    </span>
  );
}