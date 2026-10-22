"use client";

import React, { useState } from "react";
import {
  Compass,
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
}: SidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [showTemplateModal, setShowTemplateModal] = useState(false);

  return (
    <aside className="w-full h-full bg-zinc-950 border-r border-zinc-800 flex flex-col select-none">
      {/* World Switcher — replaces the display-only identity bar (milestone 3). */}
      <div className="p-4 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          {onSelectWorld ? <WorldSwitcher worlds={worlds} currentWorldId={currentWorldId} actorId={actorId ?? null} disabled={worldSwitchDisabled} onSelect={onSelectWorld} onNewWorld={() => onNewWorld?.()} onRefresh={onRefreshWorlds} onManage={onManageWorld} onBeforeManageAction={onBeforeManageAction} /> : <><h2 className="text-sm font-extrabold text-zinc-100 truncate tracking-tight">
              {worldTitle}
            </h2>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
              {systemProfile(system).short}{system === "PF_2E" ? " · Remaster" : ""}
            </span></>}
        </div>

        <button
          onClick={() => setShowTemplateModal(true)}
          className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20 transition-all shrink-0"
          title="New article — choose a template"
          aria-label="New article"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <button onClick={() => onNavigateView("home")} className={`px-6 py-3 text-left text-sm font-semibold ${activeView === "home" ? "bg-indigo-500/15 text-indigo-300" : "text-zinc-400 hover:bg-zinc-900"}`}>Campaign home</button>

      <button onClick={() => onNavigateView("manager")} className={`flex items-center gap-2 px-6 py-3 text-left text-xs font-semibold ${activeView === "manager" ? "bg-amber-500/10 text-amber-300" : "text-zinc-400 hover:bg-zinc-900"}`}><FolderTree size={15} />Articles & Categories</button>

      <button onClick={() => onNavigateView("assets")} className={`flex items-center gap-2 px-6 py-3 text-left text-xs font-semibold ${activeView === "assets" ? "bg-indigo-500/15 text-indigo-300" : "text-zinc-400 hover:bg-zinc-900"}`}><Images size={15} />Image library</button>

      {/* Primary Navigation Views */}
      <div className="p-3 border-b border-zinc-800/80 space-y-1">
        <button
          onClick={() => onNavigateView("map")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "map"
              ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <Compass className="w-4 h-4 text-sky-400" />
          <span>Interactive Maps</span>
        </button>

        <button
          onClick={() => onNavigateView("timeline")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "timeline"
              ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <Clock className="w-4 h-4 text-amber-400" />
          <span>Chronicles & Timelines</span>
        </button>

        <button
          onClick={() => onNavigateView("sessions")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "sessions"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <Calendar className="w-4 h-4 text-amber-400" />
          <span>Sessions</span>
        </button>

        <button
          onClick={() => onNavigateView("variables")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "variables"
              ? "bg-indigo-500/15 text-indigo-300 border border-indigo-500/30"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <VariableIcon className="w-4 h-4 text-emerald-400" />
          <span>Variable Macros</span>
        </button>

        <button
          onClick={() => onNavigateView("blocks")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "blocks"
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/30"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <Sword className="w-4 h-4 text-amber-400" />
          <span>Bestiary & Spellbook</span>
        </button>

        <button
          onClick={() => onNavigateView("gm")}
          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${
            activeView === "gm"
              ? "bg-red-500/15 text-red-300 border border-red-500/30"
              : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
          }`}
        >
          <ShieldAlert className="w-4 h-4 text-red-400" />
          <span>{systemProfile(system).gm} Screen & Secrets</span>
        </button>
      </div>

      <button type="button" onClick={onOpenSearch} className="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-xs text-zinc-400 hover:border-indigo-500 hover:text-zinc-100"><Search className="h-3.5 w-3.5" /><span className="flex-1 text-left">Search campaign</span><kbd className="text-[10px]">Ctrl/Cmd K</kbd></button>
      {/* Article Search Bar */}
      <div className="p-3 border-b border-zinc-800/80">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input
            type="text"
            placeholder="Search articles..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
          />
        </div>
      </div>

      <div className="sidebar-lore-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-3">
        <div className="mb-2 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500"><span>Campaign Lore</span><span>{articles.length}</span></div>
        {organizationError && <p role="alert" className="mb-3 rounded border border-red-900/40 p-2 text-xs text-red-300">{organizationError}</p>}
        <ArticleTree categories={categories} articles={articles} selectedArticleId={activeView === "article" ? selectedArticleId : null} selectedCategoryId={activeView === "manager" ? selectedCategoryId : undefined} onSelectArticle={onSelectArticle} onSelectCategory={onSelectCategory} onMove={onMove} query={searchQuery} disabled={organizationBusy} />
      </div>

      {/* New Article Template Picker Modal */}
      {showTemplateModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-indigo-400" />
                  <span>Choose an Article Template</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-1">
                  Choose a template for characters, creatures, spells, items, encounters and world lore.
                </p>
              </div>
              <button
                onClick={() => setShowTemplateModal(false)}
                className="text-zinc-400 hover:text-zinc-200 text-sm font-semibold p-1"
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
                  className="text-left p-3.5 rounded-xl border border-zinc-800 bg-zinc-950/60 hover:bg-indigo-950/20 hover:border-indigo-500/50 transition-all group flex items-start gap-3"
                >
                  <div className="p-2 rounded-lg bg-zinc-900 group-hover:bg-indigo-600/20 text-zinc-400 group-hover:text-indigo-400 border border-zinc-800 transition-colors">
                    <TemplateIcon template={tmpl.type} className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-zinc-100 group-hover:text-indigo-300">
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
