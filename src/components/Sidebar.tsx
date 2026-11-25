"use client";

import React from "react";
import Link from "next/link";
import {
  House,
  Map,
  Clock,
  Calendar,
  Variable as VariableIcon,
  ShieldAlert,
  ShieldCheck,
  Sword,
  FolderTree,
  Images,
  LogOut,
  Search,
  Users,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Logo } from "@/components/ui/Logo";
import { systemProfile } from "@/lib/rpg";
import { WorldSwitcher } from "@/components/worlds/WorldSwitcher";
import type { WorldSummary } from "@/components/WorldHome";

interface SidebarProps {
  onOpenSearch?: () => void;
  onPlayerView?: () => void;
  onSignOut?: () => void;
  worldTitle: string;
  system: string;
  activeView: "home" | "article" | "editor" | "map" | "timeline" | "variables" | "gm" | "blocks" | "manager" | "assets" | "sessions";
  onNavigateView: (view: "home" | "article" | "map" | "timeline" | "variables" | "gm" | "blocks" | "manager" | "assets" | "sessions") => void;
  worlds?: WorldSummary[];
  currentWorldId?: string | null;
  worldSwitchDisabled?: boolean;
  onSelectWorld?: (id: string) => void;
  onNewWorld?: () => void;
  onRefreshWorlds?: () => Promise<void> | void;
  actorId?: string | null;
  isAdmin?: boolean;
  onNavigateAdmin?: () => void;
  onManageWorld?: (action: "archive" | "duplicate" | "restore" | "purge" | "export" | "import", worldId?: string, summary?: WorldSummary) => void;
  onBeforeManageAction?: () => boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  mobile?: boolean;
  onCloseMobile?: () => void;
}

function navItemClass(active: boolean, mobile = false) {
  return `group relative flex min-h-[42px] w-full items-center rounded-lg border-l-[3px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-highlight-300 ${mobile ? "gap-2 px-1 text-xs" : "gap-3 px-3 text-[13px]"} ${active ? "border-l-highlight-400 bg-[var(--aw-accent-soft)] text-[var(--aw-accent-soft-text)]" : "border-l-transparent text-[var(--aw-sidebar-muted)] hover:bg-app-surface hover:text-app-text-strong"}`;
}

export function Sidebar({
  onOpenSearch,
  onPlayerView,
  onSignOut,
  worldTitle,
  system,
  activeView,
  onNavigateView,
  worlds = [],
  currentWorldId = null,
  worldSwitchDisabled = false,
  onSelectWorld,
  onNewWorld,
  onRefreshWorlds,
  actorId,
  isAdmin = false,
  onNavigateAdmin,
  onManageWorld,
  onBeforeManageAction,
  collapsed = false,
  onToggleCollapsed,
  mobile = false,
  onCloseMobile,
}: SidebarProps) {
  const compact = collapsed && !mobile;

  return (
    <aside role={mobile ? "dialog" : undefined} aria-modal={mobile || undefined} aria-label={mobile ? "World menu" : undefined} className={`relative flex h-full w-full select-none flex-col overflow-y-auto border-r border-[var(--aw-sidebar-border)] bg-[var(--aw-sidebar)] text-[var(--aw-text)] ${compact ? "md:items-center" : ""}`}>
      <div className={`flex min-w-0 shrink-0 flex-col gap-3 ${compact ? "items-center px-2 py-3" : "px-4 py-3"}`}>
        <div className={`flex min-w-0 items-center gap-3 ${compact ? "flex-col" : ""}`}>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Logo variant="symbol-small" ariaLabel={compact ? "WorldForge" : ""} className="h-9 w-auto shrink-0" />
            {!compact && <span className="truncate font-serif text-xl font-bold">WorldForge</span>}
          </div>
          {mobile ? (
            <button type="button" onClick={onCloseMobile} aria-label="Close campaign navigation" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-app-text-dim hover:bg-app-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><X aria-hidden="true" className="h-5 w-5" /></button>
          ) : onToggleCollapsed && (
            <button type="button" onClick={onToggleCollapsed} aria-label={compact ? "Expand navigation" : "Collapse navigation"} title={compact ? "Expand navigation" : "Collapse navigation"} aria-expanded={!compact} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-app-text-dim hover:bg-app-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">{compact ? <ChevronRight aria-hidden="true" className="h-4 w-4" /> : <ChevronLeft aria-hidden="true" className="h-4 w-4" />}</button>
          )}
        </div>
        {onSelectWorld ? (
          <WorldSwitcher compact={compact} worlds={worlds} currentWorldId={currentWorldId} actorId={actorId ?? null}
            disabled={worldSwitchDisabled} onSelect={onSelectWorld} onNewWorld={() => onNewWorld?.()}
            onRefresh={onRefreshWorlds} onManage={onManageWorld} onBeforeManageAction={onBeforeManageAction} />
        ) : !compact && (
          <div className="min-w-0">
            <h2 className="truncate text-sm font-extrabold tracking-tight">{worldTitle}</h2>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--aw-sidebar-muted)]">{systemProfile(system).short}{system === "PF_2E" ? " · Remaster" : ""}</span>
          </div>
        )}
      </div>
      {mobile && onOpenSearch && <div className="shrink-0 px-4 pt-4"><button type="button" onClick={onOpenSearch} aria-label="Search this world" className="flex h-11 w-full items-center gap-3 rounded-lg border border-[var(--aw-sidebar-control-border)] bg-[var(--aw-sidebar)] px-3 text-left text-sm text-[var(--aw-sidebar-muted)] hover:border-highlight-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><Search className="h-4 w-4" /><span>Search this world</span></button></div>}
      <nav aria-label="Campaign navigation" className={`shrink-0 border-b border-[var(--aw-sidebar-border)] px-3 py-4 ${mobile ? "grid grid-cols-2 gap-x-2 gap-y-1 pt-5" : "space-y-1"} ${compact ? "md:w-full md:px-2 md:py-3" : ""}`}>
        <h3 className={`mb-1 px-2 text-[11px] font-bold uppercase tracking-widest text-[var(--aw-sidebar-muted)] ${mobile ? "col-span-2 mb-3" : ""} ${compact ? "md:hidden" : ""}`}>{mobile ? "Destinations" : "Workspace"}</h3>
        {[
          ["home", "Home", House], ["manager", "Articles", FolderTree], ["map", "Maps", Map], ["timeline", "Timelines", Clock], ["sessions", "Sessions", Calendar], ["blocks", "Compendium", Sword], ["gm", `${systemProfile(system).gm} tools`, ShieldAlert],
        ].map(([view, label, Icon]) => {
          const target = view as Exclude<SidebarProps["activeView"], "editor">;
          const current = activeView === target || (target === "manager" && (activeView === "article" || activeView === "editor"));
          return <button key={view as string} type="button" onClick={() => onNavigateView(target)} aria-label={label as string} title={compact ? label as string : undefined} aria-current={current ? "page" : undefined} className={`${navItemClass(current, mobile)} ${mobile ? "h-11 min-h-[44px]" : ""} ${compact ? "md:mx-auto md:h-11 md:min-h-11 md:w-11 md:justify-center md:px-0" : ""}`}>
            <Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${current ? "text-[var(--aw-accent)]" : "text-[var(--aw-sidebar-muted)]"}`} />
            <span className={compact ? "md:hidden" : ""}>{label as string}</span>
            {compact && <span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-app-surface px-2 py-1 text-xs text-app-text-strong opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label as string}</span>}
          </button>;
        })}
      </nav>
      {mobile && <details className="shrink-0 px-3 pt-3">
        <summary className="cursor-pointer rounded-lg px-2 py-2 text-xs font-semibold text-app-text-dim hover:bg-app-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">More tools</summary>
        <div className="mt-1 space-y-1">{[["assets", "Image library", Images], ["variables", "Variables", VariableIcon]].map(([view, label, Icon]) => <button key={view as string} type="button" onClick={() => onNavigateView(view as "assets" | "variables")} className={navItemClass(activeView === view, true)}><Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${activeView === view ? "text-[var(--aw-accent)]" : "text-[var(--aw-sidebar-muted)]"}`} /><span>{label as string}</span></button>)}</div>
        {onPlayerView && <button type="button" onClick={onPlayerView} className={navItemClass(false, true)}><Users aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[var(--aw-sidebar-muted)]" /><span>Player view</span></button>}
        {onSignOut && <button type="button" onClick={onSignOut} className={navItemClass(false, true)}><LogOut aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[var(--aw-sidebar-muted)]" /><span>Sign out</span></button>}
      </details>}
      <nav aria-label="More workspace tools" className={`shrink-0 space-y-1 px-3 py-3 ${mobile || compact ? "hidden" : ""}`}>
        {[["assets", "Image library", Images], ["variables", "Variables", VariableIcon]].map(([view, label, Icon]) => {
          const target = view as "assets" | "variables";
          const current = activeView === target;
          return <button key={target} type="button" onClick={() => onNavigateView(target)} aria-current={current ? "page" : undefined} className={navItemClass(current)}><Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${current ? "text-[var(--aw-accent)]" : "text-[var(--aw-sidebar-muted)]"}`} /><span>{label as string}</span></button>;
        })}
      </nav>
      {compact && <nav aria-label="More workspace tools" className="hidden shrink-0 space-y-1 border-t border-[var(--aw-sidebar-border)] px-2 py-3 md:block">
        {[["assets", "Image library", Images], ["variables", "Variables", VariableIcon]].map(([view, label, Icon]) => <button key={view as string} type="button" onClick={() => onNavigateView(view as "assets" | "variables")} aria-label={label as string} title={label as string} aria-current={activeView === view ? "page" : undefined} className={`${navItemClass(activeView === view)} group mx-auto h-11 min-h-11 w-11 justify-center px-0`}><Icon aria-hidden="true" className="h-[18px] w-[18px] text-[var(--aw-sidebar-muted)]" /><span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-app-surface px-2 py-1 text-xs text-app-text-strong opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label as string}</span></button>)}
      </nav>}
      {isAdmin && (
        <div className={`px-3 pb-2 ${compact ? "md:px-2" : ""}`}>
          {onNavigateAdmin ? (
            <button type="button" onClick={onNavigateAdmin} title="Administration" className={`${navItemClass(false, mobile)} ${compact ? "md:mx-auto md:h-11 md:min-h-11 md:w-11 md:justify-center md:px-0" : ""}`}>
              <ShieldCheck aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[var(--aw-sidebar-muted)]" />
              <span className={compact ? "md:hidden" : ""}>Administration</span>
              {compact && <span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-app-surface px-2 py-1 text-xs text-app-text-strong opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Administration</span>}
            </button>
          ) : (
            <Link href="/admin/users" title="Administration" className={`${navItemClass(false, mobile)} ${compact ? "md:mx-auto md:h-11 md:min-h-11 md:w-11 md:justify-center md:px-0" : ""}`}>
              <ShieldCheck aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-[var(--aw-sidebar-muted)]" />
              <span className={compact ? "md:hidden" : ""}>Administration</span>
              {compact && <span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-app-surface px-2 py-1 text-xs text-app-text-strong opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Administration</span>}
            </Link>
          )}
        </div>
      )}
    </aside>
  );
}
