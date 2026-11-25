"use client";

import { useEffect, useRef } from "react";
import { Sparkles } from "lucide-react";
import { TemplateIcon } from "@/components/TemplateIcon";
import { ARTICLE_TEMPLATES } from "@/lib/templates";
import type { ArticleTemplateType } from "@/types";

export function ArticleTemplatePicker({ open, onClose, onSelect }: {
  open: boolean;
  onClose: () => void;
  onSelect: (template: ArticleTemplateType) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled])") ?? [])].filter(element => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-app-scrim p-4 backdrop-blur-sm">
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="template-picker-title" className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-app-border bg-app-surface shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-center justify-between border-b border-app-border p-6">
          <div>
            <h2 id="template-picker-title" className="flex items-center gap-2 text-lg font-bold text-app-text-strong"><Sparkles className="h-5 w-5 text-highlight-300" />Choose an Article Template</h2>
            <p className="mt-1 text-xs text-app-muted">Choose a template for characters, creatures, spells, items, encounters and world lore.</p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close template picker" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-app-text-dim hover:bg-app-raised hover:text-app-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">✕</button>
        </div>
        <div className="grid grid-cols-1 gap-3 overflow-y-auto p-6 md:grid-cols-2">
          {Object.values(ARTICLE_TEMPLATES).map(template => (
            <button key={template.type} type="button" onClick={() => { onClose(); onSelect(template.type); }} className="group flex items-start gap-3 rounded-xl border border-app-border bg-app-canvas/60 p-3.5 text-left transition-all hover:border-highlight-500/50 hover:bg-highlight-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">
              <div className="rounded-lg border border-app-border bg-app-surface p-2 text-app-muted transition-colors group-hover:bg-highlight-600/20 group-hover:text-highlight-300"><TemplateIcon template={template.type} className="h-4 w-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-app-text-strong group-hover:text-highlight-200">{template.label}</div>
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-app-muted">{template.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
