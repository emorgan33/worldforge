"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorldSummary } from "@/components/WorldHome";
import { RPG_SYSTEMS } from "@/lib/rpg";
import { WorldManagement } from "@/components/worlds/WorldManagement";

export function WorldSwitcher({ worlds, currentWorldId, actorId, disabled = false, compact = false, brand = false, mobileCard = false, onSelect, onNewWorld, onRefresh, onManage, onBeforeManageAction }: {
  worlds: WorldSummary[];
  currentWorldId: string | null;
  actorId: string | null;
  disabled?: boolean;
  compact?: boolean;
  brand?: boolean;
  mobileCard?: boolean;
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
    <button ref={trigger} type="button" disabled={disabled} aria-label={compact || brand || mobileCard ? `Switch world${current ? `, current world ${current.title}` : ""}` : undefined} title={compact ? "Switch world" : undefined} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(value => !value)} className={`flex max-w-full items-center gap-2 rounded-lg text-left text-sm text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 disabled:opacity-50 ${compact ? "h-10 w-10 justify-center border border-[#303540] bg-[#181b22] p-0" : brand ? "w-full gap-3 border-0 bg-transparent p-0 hover:bg-transparent" : mobileCard ? "h-[50px] w-full gap-3 border border-[#303540] bg-[#1d212a] px-3 py-2 hover:border-violet-500" : "min-h-11 border border-zinc-700 bg-zinc-900 px-3 py-2 hover:border-violet-500"}`}>
      {compact ? <span aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#2b2850] text-base font-bold text-[#9b8cfa]">W</span> : brand ? <>
        <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-[#2b2850] text-[19px] font-bold text-[#9b8cfa]">W</span>
        <span className="min-w-0 text-left"><span className="block text-[11px] font-bold tracking-wide text-[#f1f2f5]">WORLDFORGE</span><span className="block truncate text-xs font-semibold tracking-wide text-[#a9afbb]">{current?.title ?? "Choose a world"}</span></span>
      </> : mobileCard ? <>
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#2b2850] text-[15px] font-bold text-[#9b8cfa]">W</span>
        <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{current?.title ?? "Choose a world"}</span>{current && <span className="block truncate text-[10px] text-zinc-400">{RPG_SYSTEMS.find(option => option.id === current.system)?.short ?? current.system} · Switch world</span>}</span><span aria-hidden="true" className="text-zinc-400">▾</span>
      </> : <>
      <span className="min-w-0"><span className="block truncate font-semibold">{current?.title ?? "Choose a world"}</span>{current && <span className="block text-xs text-zinc-400">{RPG_SYSTEMS.find(option => option.id === current.system)?.short ?? current.system}</span>}</span><span aria-hidden="true" className="text-zinc-400">▾</span>
      </>}
    </button>
    {open && <div role="listbox" aria-label="Your worlds" onKeyDown={onListKeyDown} className={`absolute left-0 top-full z-50 mt-2 max-h-[min(70vh,32rem)] ${mobileCard ? "w-full max-w-full" : "w-[min(22rem,90vw)]"} overflow-auto rounded-xl border border-zinc-700 bg-zinc-950 p-2 text-zinc-100 shadow-2xl`}>
      {worlds.length > 5 && <label className="block px-2 pb-2 text-xs text-zinc-400">Search worlds<input ref={search} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a world" className="mt-1 min-h-11 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-500 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-400/30" /></label>}
      {filtered.length ? filtered.map(world => {
        const duplicate = (duplicateTitles.get(world.title.toLocaleLowerCase()) ?? 0) > 1;
        const profile = RPG_SYSTEMS.find(option => option.id === world.system);
        return <button key={world.id} type="button" role="option" aria-selected={world.id === currentWorldId} data-world-option="" onClick={() => { close(false); if (world.id !== currentWorldId) onSelect(world.id); }} className={`block min-h-11 w-full rounded-lg px-3 py-2 text-left hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300 ${world.id === currentWorldId ? "bg-violet-950/50" : ""}`}>
          <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{world.title}</span>{world.id === currentWorldId && <span className="shrink-0 text-[10px] uppercase tracking-wider text-violet-200">Current</span>}</span>
          <span className="mt-0.5 block text-xs text-zinc-400">{profile?.id === "PF_2E" ? "Pathfinder 2e Remaster" : profile?.id === "DND_5E" ? "D&D 5e 2014" : profile?.label ?? world.system}{duplicate && <span> · {world.slug}</span>}</span>
        </button>;
      }) : <p className="px-3 py-4 text-sm text-zinc-400">No matching worlds.</p>}
      <div className="mt-2 border-t border-zinc-800 pt-2"><button type="button" onClick={() => { close(false); onNewWorld(); }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-violet-200 hover:bg-violet-950/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">New world</button><button type="button" onClick={() => { close(false); setManagementOpen(true); }} className="min-h-11 w-full rounded-lg px-3 text-left text-sm font-semibold text-zinc-300 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-300">Manage worlds</button></div>
    </div>}
    {managementOpen && <WorldManagement worlds={worlds} currentWorldId={currentWorldId} actorId={actorId} onClose={closeManagement} onRefresh={async () => { await onRefresh?.(); }} onBeforeAction={() => onBeforeManageAction?.() ?? true} onActionComplete={(action, worldId, summary) => onManage?.(action, worldId, summary)} />}
  </div>;
}
