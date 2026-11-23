"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, Gem, Scroll, Settings2, Shield, Sword, WandSparkles, Users } from "lucide-react";
import { ArticleListItem, ArticleTemplateType } from "@/types";
import { BlockCategory, RpgBlockItem, systemProfile } from "@/lib/rpg";
import { sortOrdered } from "@/lib/category-tree";
import { ARTICLE_TEMPLATES } from "@/lib/templates";
import { TemplateIcon } from "@/components/TemplateIcon";
import { NextSessionDesk, SessionEntityLinkItem } from "./NextSessionDesk";
import { MemberManager } from "./MemberManager";

export function CampaignOverview({ system, worldTitle, articles, blocks, sessions, worldId, onNewArticle, onSelectArticle, onOpenCompendium, onOpenGm, onOpenWorldSettings = () => {}, onRefreshSessions }: {
  system: string;
  worldTitle: string;
  articles: ArticleListItem[];
  blocks: RpgBlockItem[];
  sessions?: { id: string; title: string; description?: string | null; status: string; sessionDate?: string | null; inWorldDate?: string | null; currentLocation?: string | null; recap?: string | null; nextPrep?: string | null; isNext: boolean; order: number; linkedEntities: SessionEntityLinkItem[]; }[];
  worldId?: string;
  onNewArticle: (template: ArticleTemplateType) => void;
  onSelectArticle: (id: string) => void;
  onOpenCompendium: (category?: BlockCategory) => void;
  onOpenGm: () => void;
  onOpenWorldSettings?: () => void;
  onRefreshSessions?: () => void;
}) {
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const [showAllArticles, setShowAllArticles] = useState(false);
  const profile = systemProfile(system);
  const orderedArticles = sortOrdered(articles);
  const displayedArticles = showAllArticles ? orderedArticles : orderedArticles.slice(0, 5);
  const rulesLabel = `${profile.short}${system === "PF_2E" ? " · Remaster" : ""}`;
  const ownBlocks = blocks.filter(block => block.system === system);
  const shortcuts = [
    { title: "Bestiary", count: ownBlocks.filter(block => ["MONSTER", "NPC"].includes(block.category)).length, icon: Sword, action: () => onOpenCompendium() },
    { title: "Spellbook", count: ownBlocks.filter(block => block.category === "SPELL").length, icon: WandSparkles, action: () => onOpenCompendium("SPELL") },
    { title: "Treasure", count: ownBlocks.filter(block => block.category === "ITEM").length, icon: Gem, action: () => onOpenCompendium("ITEM") },
    { title: "Session journals", count: articles.filter(article => article.template === "REPORT").length, icon: Scroll, action: () => onNewArticle("REPORT") },
  ];
  const createActions: { label: string; template: ArticleTemplateType; icon: typeof Users }[] = [
    { label: "NPC / character", template: "CHARACTER", icon: Users },
    { label: "Creature", template: "CREATURE", icon: Sword },
    { label: "Spell", template: "SPELL", icon: WandSparkles },
    { label: "Item", template: "ITEM", icon: Gem },
    { label: "Location", template: "BUILDING", icon: BookOpen },
    { label: "Session recap", template: "REPORT", icon: Scroll },
  ];

  return <div className="space-y-8 text-app-text-strong">
    <header className="border-b border-app-border pb-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary-400"><Shield size={16} aria-hidden="true" /> {profile.gm} campaign desk</p>
        <span className="rounded-full border border-primary-700/50 bg-primary-950/30 px-3 py-1 text-xs font-medium text-primary-200">{rulesLabel}</span>
      </div>
      <h1 className="mt-3 break-words text-3xl font-semibold leading-tight tracking-tight text-app-text-bright sm:text-4xl">{worldTitle}</h1>
      <p className="mt-2 text-sm text-app-muted">Your campaign desk for session prep, world content, and table tools.</p>
    </header>

    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(19rem,0.85fr)]">
    <section aria-labelledby="create-world-content" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 min-[1024px]:max-[1150px]:flex-col min-[1024px]:max-[1150px]:items-start">
        <div><p className="text-xs font-semibold uppercase tracking-widest text-app-subtle">Start with the next task</p><h2 id="create-world-content" className="mt-1 text-xl font-semibold text-app-text-strong">Create for your world</h2></div>
        <button type="button" onClick={() => setShowAllTemplates(value => !value)} aria-expanded={showAllTemplates} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-highlight-500/50 px-3 text-sm font-semibold text-highlight-200 hover:bg-highlight-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300 min-[1024px]:max-[1150px]:self-end">All templates <ArrowRight size={15} aria-hidden="true" /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {createActions.map(({ label, template, icon: Icon }) => <button key={template} type="button" onClick={() => onNewArticle(template)} className="flex min-h-12 min-w-0 items-center gap-2 rounded-lg border border-app-border bg-app-surface/60 px-3 py-3 text-left text-sm text-app-text transition-colors hover:border-highlight-500/60 hover:bg-highlight-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><Icon size={17} className="shrink-0 text-highlight-300" aria-hidden="true" /><span className="min-w-0">{label}</span></button>)}
      </div>
      {showAllTemplates && <div className="grid gap-2 rounded-xl border border-app-border bg-app-surface/50 p-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="All article templates">
        {Object.values(ARTICLE_TEMPLATES).map(template => <button key={template.type} type="button" onClick={() => { setShowAllTemplates(false); onNewArticle(template.type); }} className="flex min-h-12 min-w-0 items-start gap-3 rounded-lg border border-app-border bg-app-canvas/40 p-3 text-left hover:border-highlight-500/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><span className="mt-0.5 text-highlight-300"><TemplateIcon template={template.type} className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-sm font-semibold text-app-text-strong">{template.label}</span><span className="mt-1 block text-xs leading-relaxed text-app-muted">{template.description}</span></span></button>)}
      </div>}
    </section>

    <section aria-labelledby="next-session-heading" className="aw-panel rounded-xl border p-4 sm:p-5">
      {sessions && onRefreshSessions ? <NextSessionDesk worldId={worldId || ""} sessions={sessions} onRefresh={onRefreshSessions} /> : <>
        <h2 id="next-session-heading" className="text-xl font-semibold text-app-text-strong">Next session</h2>
        <p className="mt-2 text-sm text-app-muted">Plan what comes next for your table.</p>
      </>}
    </section>
    </div>

    <section aria-labelledby="world-content-heading" className="space-y-3">
      <div><h2 id="world-content-heading" className="text-xl font-semibold text-app-text-strong">World content</h2><p className="mt-1 text-sm text-app-muted">Browse your articles in their saved order.</p></div>
      {articles.length > 0 ? <><ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{displayedArticles.map(article => <li key={article.id} className="min-w-0"><button type="button" onClick={() => onSelectArticle(article.id)} className="block min-h-12 w-full rounded-lg border border-app-border bg-app-surface/40 p-3 text-left text-sm text-app-text hover:border-highlight-500/60 hover:text-highlight-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><span className="block break-words font-medium">{article.title}</span><span className="mt-1 block text-xs text-app-muted">{article.category?.name || article.template}</span></button></li>)}</ul>{orderedArticles.length > 5 && <button type="button" onClick={() => setShowAllArticles(value => !value)} aria-expanded={showAllArticles} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-highlight-200 hover:bg-highlight-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">{showAllArticles ? "Show fewer articles" : `Browse all articles (${orderedArticles.length})`} <ArrowRight size={15} aria-hidden="true" /></button>}</> : <div className="rounded-xl border border-app-border bg-app-surface/30 p-5"><p className="text-sm font-semibold text-app-text">Your world is ready for its first article.</p><p className="mt-1 text-sm text-app-muted">Start with a character, place, or piece of lore.</p><button type="button" onClick={() => onNewArticle("GENERIC")} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg bg-highlight-400 px-4 text-sm font-semibold text-app-on-accent hover:bg-highlight-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-200">Create first article <ArrowRight size={15} aria-hidden="true" /></button></div>}
    </section>

    <section aria-labelledby="compendium-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h2 id="compendium-heading" className="text-xl font-semibold text-app-text-strong">Compendium</h2><p className="mt-1 text-sm text-app-muted">Entries using {profile.short} rules.</p></div><button type="button" onClick={() => onOpenCompendium()} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-highlight-200 hover:bg-highlight-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">Open compendium <ArrowRight size={15} aria-hidden="true" /></button></div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{shortcuts.map(({ title, count, icon: Icon, action }) => <button key={title} type="button" onClick={action} className="flex min-h-16 items-center gap-3 rounded-lg border border-app-border bg-app-surface/35 p-3 text-left hover:border-highlight-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300"><Icon size={18} className="shrink-0 text-app-muted" aria-hidden="true" /><span className="min-w-0 flex-1 text-sm text-app-text-dim">{title}</span><span className="text-lg font-semibold tabular-nums text-app-text-strong">{count}</span></button>)}</div>
    </section>

    <section aria-labelledby="world-management-heading" className="aw-panel flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-start gap-3"><Settings2 size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-app-muted" /><div className="min-w-0"><h2 id="world-management-heading" className="text-base font-semibold text-app-text-strong">World settings & GM tools</h2><p className="mt-1 text-sm text-app-muted">Edit campaign rules, styling, publishing, and integrations.</p></div></div><div className="flex flex-col gap-2 sm:flex-row"><button type="button" onClick={onOpenWorldSettings} className="inline-flex min-h-11 items-center justify-center rounded-lg border border-highlight-500/50 px-3 text-sm font-semibold text-highlight-200 hover:bg-highlight-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">Edit world & styling</button><button type="button" onClick={onOpenGm} className="min-h-11 rounded-lg border border-app-border-strong px-3 text-sm text-app-text hover:border-highlight-500/60 hover:text-highlight-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-highlight-300">Open {profile.gm} tools</button></div></section>
    {worldId && <MemberManager worldId={worldId} />}
  </div>;
}
