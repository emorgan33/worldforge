"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Globe } from "lucide-react";
import type { WorldSummary } from "@/components/WorldHome";
import { RPG_SYSTEMS } from "@/lib/rpg";
import { WorldManagement } from "@/components/worlds/WorldManagement";

export function WorldSwitcher({ worlds, currentWorldId, actorId, disabled = false, compact = false, onSelect, onNewWorld, onRefresh, onManage, onBeforeManageAction }: {
  worlds: WorldSummary[];
  currentWorldId: string | null;
  actorId: string | null;
  disabled?: boolean;
  compact?: boolean;
  onSelect: (id: string) => void;
  onNewWorld: () => void;
  onRefresh?: () => Promise<void> | void;
  onManage?: (action: "archive" | "duplicate" | "restore" | "purge" | "export" | "import", worldId?: string, summary?: WorldSummary) => void;
  onBeforeManageAction?: () => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [managementOpen, setManagementOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const current = worlds.find(world => world.id === currentWorldId);
  const closeManagement = useCallback(() => { setManagementOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }, []);
  const filtered = worlds.filter(world => `${world.title} ${world.slug} ${world.system}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const duplicateTitles = new Map<string, number>();
  worlds.forEach(world => duplicateTitles.set(world.title.toLocaleLowerCase(), (duplicateTitles.get(world.title.toLocaleLowerCase()) ?? 0) + 1));

  useEffect(() => {
    if (!open) return;
    void Promise.resolve(onRefresh?.()).catch(() => { /* Workspace shows the refresh error. */ });
    if (worlds.length > 5) search.current?.focus();
    function outside(event: MouseEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", outside);
    return () => document.removeEventListener("mousedown", outside);
  }, [open, onRefresh, worlds.length]);

  function close(returnFocus = true) { setOpen(false); setQuery(""); if (returnFocus) requestAnimationFrame(() => trigger.current?.focus()); }
  function onListKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>("[data-world-option]") ?? [])];
    const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (currentIndex + 1) % buttons.length : (currentIndex <= 0 ? buttons.length - 1 : currentIndex - 1);
    if (buttons.length) { event.preventDefault(); buttons[next].focus(); }
  }

  return <div ref={root} className="relative">
    <button ref={trigger} type="button" disabled={disabled} aria-label={`Switch world${current ? `, current world ${current.title}` : ""}`} title={compact ? "Switch world" : undefined} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-[var(--aw-sidebar-control-border)] text-left text-sm text-app-text-strong hover:border-highlight-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-highlight-300 disabled:opacity-50 ${compact ? "w-11 justify-center bg-[var(--aw-sidebar)]" : "w-full bg-[var(--aw-sidebar-control)] px-3 py-2"}`}>
      {compact ? <Globe aria-hidden="true" className="h-5 w-5" /> : <>
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{current?.title ?? "Choose a world"}</span>{current && <span className="block truncate text-xs text-app-muted">{RPG_SYSTEMS.find(option => option.id === current.system)?.short ?? current.system} · Switch world</span>}</span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-app-muted" />
      </>}
    </button>
    {open && <div role="listbox" aria-label="Your worlds" onKeyDown={onListKeyDown} className={`z-[55] max-h-[min(65dvh,32rem)] overflow-auto rounded-xl border border-app-border-strong bg-app-canvas p-2 text-app-text-strong shadow-2xl ${compact ? "fixed left-[68px] top-16 w-[min(22rem,calc(100vw-68px))]" : "absolute left-0 top-full mt-2 w-full"}`}>
      {worlds.length > 5 && <label className="block px-2 pb-2 text-xs text-app-muted">Search worlds<input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a world" className="mt-1 min-h-11 w-full rounded-lg border border-app-border-strong bg-app-surface px-3 py-2 text-sm text-app-text-strong placeholder:text-app-subtle focus:border-highlight-400 focus:outline-none focus:ring-2 focus:ring-highlight-400/30" /></label>}
      {filtered.length ? filtered.map(world => {
        const duplicate = (duplicateTitles.get(world.title.toLocaleLowerCase()) ?? 0) > 1;
        const profile = RPG_SYSTEMS.find(option => option.id === world.system);
        return <button key={world.id} type="button" role="option" aria-selected={world.id === currentWorldId} data-world-option="" onClick={() => { close(false); if (world.id !== currentWorldId) onSelect(world.id); }} className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left hover:bg-app-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-highlight-300 ${world.id === currentWorldId ? "bg-highlight-950/50" : ""}`}>
          <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{world.title}</span>{world.id === currentWorldId && <span className="shrink-0 text-[10px] uppercase tracking-wider text-highlight-200">Current</span>}</span>
          <span className="mt-0.5 block text-xs text-app-muted">{profile?.id === "PF_2E" ? "Pathfinder 2e Remaster" : profile?.id === "DND_5E" ? "D&D 5e 2014" : profile?.label ?? world.system}{duplicate && <span> · {world.slug}</span>}</span>
        </button>;
      }) : <p className="px-3 py-4 text-sm text-app-muted">No matching worlds.</p>}
      <div className="mt-2 border-t border-app-border pt-2"><button type="button" onClick={() => { close(false); onNewWorld(); }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-highlight-200 hover:bg-highlight-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-highlight-300">New world</button><button type="button" onClick={() => { close(false); setManagementOpen(true); }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-app-text-dim hover:bg-app-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-highlight-300">Manage worlds</button></div>
    </div>}
    {managementOpen && <WorldManagement worlds={worlds} currentWorldId={currentWorldId} actorId={actorId} onClose={closeManagement} onRefresh={async () => { await onRefresh?.(); }} onBeforeAction={() => onBeforeManageAction?.() ?? true} onActionComplete={(action, worldId, summary) => onManage?.(action, worldId, summary)} />}
  </div>;
}
