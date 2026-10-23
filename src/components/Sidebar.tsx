"use client";

import React, { useState } from "react";
import {
  House,
  Map,
  Clock,
  Calendar,
  Variable as VariableIcon,
  ShieldAlert,
  Sword,
  Plus,
  Search,
  Sparkles,
  FolderTree,
  Images,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { ArticleTree, TreeMove } from "./ArticleTree";
import { ArticleListItem, ArticleTemplateType, CategoryItem } from "@/types";
import { TemplateIcon } from "@/components/TemplateIcon";
import { systemProfile } from "@/lib/rpg";
import { ARTICLE_TEMPLATES } from "@/lib/templates";
import { WorldSwitcher } from "@/components/worlds/WorldSwitcher";
import type { WorldSummary } from "@/components/WorldHome";

interface SidebarProps {
  onOpenSearch: () => void;
  worldTitle: string;
  system: string;
  articles: ArticleListItem[];
  categories: CategoryItem[];
  selectedCategoryId: string | null;
  onSelectCategory: (id: string | null) => void;
  onMove: (move: TreeMove) => Promise<void>;
  organizationBusy: boolean;
  organizationError: string;
  activeView: "home" | "article" | "editor" | "map" | "timeline" | "variables" | "gm" | "blocks" | "manager" | "assets" | "sessions";
  selectedArticleId: string | null;
  onSelectArticle: (id: string) => void;
  onNavigateView: (view: "home" | "article" | "map" | "timeline" | "variables" | "gm" | "blocks" | "manager" | "assets" | "sessions") => void;
  onNewArticle: (template?: ArticleTemplateType) => void;
  worlds?: WorldSummary[];
  currentWorldId?: string | null;
  worldSwitchDisabled?: boolean;
  onSelectWorld?: (id: string) => void;
  onNewWorld?: () => void;
  onRefreshWorlds?: () => Promise<void> | void;
  actorId?: string | null;
  onManageWorld?: (action: "archive" | "duplicate" | "restore" | "purge" | "export" | "import", worldId?: string, summary?: WorldSummary) => void;
  onBeforeManageAction?: () => boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  mobile?: boolean;
  onCloseMobile?: () => void;
}

function navItemClass(active: boolean, mobile = false) {
  return `group relative flex min-h-[42px] w-full items-center rounded-lg border-l-[3px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-300 ${mobile ? "gap-2 px-1 text-xs" : "gap-3 px-3 text-[13px]"} ${active ? "border-l-violet-400 bg-[#2b2850] text-[#f1f2f5]" : "border-l-transparent text-[#a9afbb] hover:bg-zinc-900 hover:text-zinc-100"}`;
}

export function Sidebar({
  onOpenSearch,
  worldTitle,
  system,
  articles,
  categories,
  selectedCategoryId,
  onSelectCategory,
  onMove,
  organizationBusy,
  organizationError,
  activeView,
  selectedArticleId,
  onSelectArticle,
  onNavigateView,
  onNewArticle,
  worlds = [],
  currentWorldId = null,
  worldSwitchDisabled = false,
  onSelectWorld,
  onNewWorld,
  onRefreshWorlds,
  actorId,
  onManageWorld,
  onBeforeManageAction,
  collapsed = false,
  onToggleCollapsed,
  mobile = false,
  onCloseMobile,
}: SidebarProps) {
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  return (
    <aside role={mobile ? "dialog" : undefined} aria-modal={mobile || undefined} aria-label={mobile ? "World menu" : undefined} className={`relative flex h-full w-full select-none flex-col border-r border-[var(--aw-border)] bg-[var(--aw-sidebar)] text-[var(--aw-text)] ${collapsed && !mobile ? "md:items-center" : ""}`}>
      {mobile && <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-[#303540] bg-[#181b22] px-5"><span className="text-xs font-bold">WORLD MENU</span><button type="button" onClick={onCloseMobile} aria-label="Close campaign navigation" className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"><X className="h-5 w-5" /></button></div>}
      <div className={`flex h-16 shrink-0 items-center gap-3 bg-[#181b22]/50 ${collapsed && !mobile ? "md:h-auto md:flex-col md:gap-2 md:px-2 md:py-3" : "px-4 py-2"}`}>
        <div className={`min-w-0 ${collapsed && !mobile ? "md:hidden" : "flex-1"}`}>
          {onSelectWorld ? <WorldSwitcher brand={!mobile} mobileCard={mobile} worlds={worlds} currentWorldId={currentWorldId} actorId={actorId ?? null} disabled={worldSwitchDisabled} onSelect={onSelectWorld} onNewWorld={() => onNewWorld?.()} onRefresh={onRefreshWorlds} onManage={onManageWorld} onBeforeManageAction={onBeforeManageAction} /> : <><h2 className="truncate text-sm font-extrabold tracking-tight">{worldTitle}</h2><span className="text-xs font-semibold uppercase tracking-wider text-[#a9afbb]">{systemProfile(system).short}{system === "PF_2E" ? " · Remaster" : ""}</span></>}
        </div>
        {onSelectWorld && collapsed && !mobile && <div className="hidden md:block"><WorldSwitcher compact worlds={worlds} currentWorldId={currentWorldId} actorId={actorId ?? null} disabled={worldSwitchDisabled} onSelect={onSelectWorld} onNewWorld={() => onNewWorld?.()} onRefresh={onRefreshWorlds} onManage={onManageWorld} onBeforeManageAction={onBeforeManageAction} /></div>}
        <div className={`${collapsed && !mobile ? "hidden md:block" : "hidden"} flex-1`} />
        {!mobile && onToggleCollapsed && <button type="button" onClick={onToggleCollapsed} aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} title={collapsed ? "Expand navigation" : "Collapse navigation"} aria-expanded={!collapsed} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">{collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}</button>}
      </div>
      {mobile && <div className="shrink-0 px-4 pt-4"><button type="button" onClick={onOpenSearch} aria-label="Search this world" className="flex h-11 w-full items-center gap-3 rounded-lg border border-[#303540] bg-[#181b22] px-3 text-left text-sm text-[#a9afbb] hover:border-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"><Search className="h-4 w-4" /><span>Search this world</span></button></div>}
      {!mobile && <button type="button" onClick={onOpenSearch} aria-label="Search this world" title="Search this world" className={`group relative mx-3 mt-2 flex min-h-11 items-center gap-3 rounded-lg border border-[#303540] bg-[#181b22] px-3 text-sm text-[#a9afbb] hover:border-violet-500 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 ${collapsed ? "md:hidden" : ""}`}><Search className="h-4 w-4 shrink-0" /><span>Search this world</span><kbd className="ml-auto text-xs text-[#a9afbb]">⌘ K</kbd></button>}
      <nav aria-label="Campaign navigation" className={`shrink-0 border-b border-[#303540] px-3 py-4 ${mobile ? "grid grid-cols-2 gap-x-2 gap-y-1 pt-5" : "space-y-1"} ${collapsed && !mobile ? "md:w-full md:px-2 md:py-3" : ""}`}>
        <h3 className={`mb-1 px-2 text-[11px] font-bold uppercase tracking-widest text-[#a9afbb] ${mobile ? "col-span-2 mb-3" : ""} ${collapsed && !mobile ? "md:hidden" : ""}`}>{mobile ? "Destinations" : "Workspace"}</h3>
        {[
          ["home", "Home", House], ["manager", "Articles", FolderTree], ["map", "Maps", Map], ["timeline", "Timelines", Clock], ["sessions", "Sessions", Calendar], ["blocks", "Compendium", Sword], ["gm", `${systemProfile(system).gm} tools`, ShieldAlert],
        ].map(([view, label, Icon]) => {
          const target = view as Exclude<SidebarProps["activeView"], "editor">;
          const current = activeView === target || (target === "manager" && (activeView === "article" || activeView === "editor"));
          return <button key={view as string} type="button" onClick={() => onNavigateView(target)} aria-label={label as string} title={collapsed && !mobile ? label as string : undefined} aria-current={current ? "page" : undefined} className={`${navItemClass(current, mobile)} ${mobile ? "h-11 min-h-[44px]" : ""} ${collapsed && !mobile ? "md:mx-auto md:h-11 md:min-h-11 md:w-11 md:justify-center md:px-0" : ""}`}>
            <Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${current ? "text-[#9b8cfa]" : "text-[#a9afbb]"}`} />
            <span className={collapsed && !mobile ? "md:hidden" : ""}>{label as string}</span>
            {collapsed && !mobile && <span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label as string}</span>}
          </button>;
        })}
      </nav>
      {collapsed && !mobile && <button type="button" onClick={onOpenSearch} aria-label="Search this world" title="Search this world" className="group relative mx-2 mt-3 hidden h-11 w-11 items-center justify-center rounded-lg border border-[#303540] bg-[#181b22] text-[#a9afbb] hover:border-violet-500 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 md:flex"><Search className="h-4 w-4" /><span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">Search this world</span></button>}
      <section aria-label="World contents" className={`sidebar-lore-scroll min-h-0 flex-1 border-b border-[#303540] p-3 ${mobile ? "flex flex-col overflow-hidden" : "overflow-y-auto"} ${collapsed && !mobile ? "md:hidden" : ""}`}>
        <h3 className="mb-2 shrink-0 px-2 text-[11px] font-bold uppercase tracking-widest text-[#a9afbb]">World contents <span className="font-semibold">· {articles.length}</span></h3>
        {organizationError && <p role="alert" className="mb-2 rounded border border-red-900/40 p-2 text-xs text-red-300">{organizationError}</p>}
        <div className={`sidebar-lore-scroll overflow-x-hidden overflow-y-auto ${mobile ? "min-h-0 flex-1" : "max-h-[min(38vh,21rem)]"}`}><ArticleTree categories={categories} articles={articles} selectedArticleId={activeView === "article" ? selectedArticleId : null} selectedCategoryId={activeView === "manager" ? selectedCategoryId : undefined} onSelectArticle={onSelectArticle} onSelectCategory={onSelectCategory} onMove={onMove} disabled={organizationBusy} mobile={mobile} /></div>
        {mobile && <details className="mt-3 shrink-0 border-t border-[#303540] pt-3">
          <summary className="cursor-pointer rounded-lg px-2 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300">More tools</summary>
          <div className="mt-1 space-y-1">{[["assets", "Image library", Images], ["variables", "Variables", VariableIcon]].map(([view, label, Icon]) => <button key={view as string} type="button" onClick={() => onNavigateView(view as "assets" | "variables")} className={navItemClass(activeView === view)}><Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${activeView === view ? "text-[#9b8cfa]" : "text-[#a9afbb]"}`} /><span>{label as string}</span></button>)}</div>
        </details>}
      </section>
      <nav aria-label="More workspace tools" className={`shrink-0 space-y-1 px-3 py-3 ${mobile ? "hidden" : ""} ${collapsed && !mobile ? "md:hidden" : ""}`}>
        {[ ["assets", "Image library", Images], ["variables", "Variables", VariableIcon] ].map(([view, label, Icon]) => {
          const target = view as "assets" | "variables";
          const current = activeView === target;
          return <button key={target} type="button" onClick={() => onNavigateView(target)} aria-current={current ? "page" : undefined} className={navItemClass(current)}><Icon aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${current ? "text-[#9b8cfa]" : "text-[#a9afbb]"}`} /><span>{label as string}</span></button>;
        })}
      </nav>
      {collapsed && !mobile && <nav aria-label="More workspace tools" className="hidden shrink-0 space-y-1 border-t border-[#303540] px-2 py-3 md:block">
        {[["assets", "Image library", Images], ["variables", "Variables", VariableIcon]].map(([view, label, Icon]) => <button key={view as string} type="button" onClick={() => onNavigateView(view as "assets" | "variables")} aria-label={label as string} title={label as string} aria-current={activeView === view ? "page" : undefined} className={`${navItemClass(activeView === view)} group mx-auto h-11 min-h-11 w-11 justify-center px-0`}><Icon aria-hidden="true" className="h-[18px] w-[18px] text-[#a9afbb]" /><span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">{label as string}</span></button>)}
      </nav>}
      {!mobile && collapsed && <div className="hidden md:block"><button type="button" onClick={() => setShowTemplateModal(true)} aria-label="New article" title="New article" className="group relative mx-2 mt-3 flex h-11 w-11 items-center justify-center rounded-lg bg-[#9b8cfa] text-[#111318] hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200"><Plus className="h-4 w-4" /><span aria-hidden="true" className="pointer-events-none absolute left-full top-1/2 z-40 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs text-zinc-100 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">New article</span></button></div>}
      <div className={`mt-auto ${mobile ? "px-4 pb-5 pt-3" : "p-3"} ${collapsed && !mobile ? "md:hidden" : ""}`}><button type="button" onClick={() => setShowTemplateModal(true)} aria-label="New article" className={`flex min-h-11 w-full items-center gap-3 rounded-lg bg-[#9b8cfa] px-4 text-left text-sm font-bold text-[#111318] hover:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-200 ${mobile ? "h-[50px]" : ""}`}><Plus className="h-[18px] w-[18px]" /><span>New article</span></button></div>

      {/* New Article Template Picker Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-violet-300" />
                  <span>Choose an Article Template</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Choose a template for characters, creatures, spells, items, encounters and world lore.
                </p>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                type="button"
                aria-label="Close template picker"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.values(ARTICLE_TEMPLATES).map((tmpl) => (
                <button
                  key={tmpl.type}
                  onClick={() => {
                    setShowTemplateModal(false);
                    onNewArticle(tmpl.type);
                  }}
                  className="text-left p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:bg-violet-950/20 hover:border-violet-500/50 transition-all group flex items-start gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300"
                >
                  <div className="p-2 rounded-lg bg-zinc-900 group-hover:bg-violet-600/20 text-zinc-400 group-hover:text-violet-300 border border-zinc-800 transition-colors">
                    <TemplateIcon template={tmpl.type} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-zinc-100 group-hover:text-violet-200">
                      {tmpl.label}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2 leading-relaxed">
                      {tmpl.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
