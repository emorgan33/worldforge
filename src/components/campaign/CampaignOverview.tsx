"use client";

import { useState } from "react";
import { BookOpen, Scroll, Shield, Sword, WandSparkles, Users, Gem, ArrowRight } from "lucide-react";
import { ArticleListItem, ArticleTemplateType } from "@/types";
import { BlockCategory, RpgBlockItem, systemProfile } from "@/lib/rpg";
import { NextSessionDesk, SessionEntityLinkItem } from "./NextSessionDesk";

export function CampaignOverview({ system, articles, blocks, sessions, worldId, onChangeSystem, onNewArticle, onOpenCompendium, onOpenGm, onRefreshSessions }: {
  system: string;
  articles: ArticleListItem[];
  blocks: RpgBlockItem[];
  sessions?: { id: string; title: string; description?: string | null; status: string; sessionDate?: string | null; inWorldDate?: string | null; currentLocation?: string | null; recap?: string | null; nextPrep?: string | null; isNext: boolean; order: number; linkedEntities: SessionEntityLinkItem[]; }[];
  worldId?: string;
  onChangeSystem: (system: string) => Promise<void>;
  onNewArticle: (template: ArticleTemplateType) => void;
  onOpenCompendium: (category?: BlockCategory) => void;
  onOpenGm: () => void;
  onRefreshSessions?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pf = system === "PF_2E";
  const profile = systemProfile(system);
  const ownBlocks = blocks.filter(block => block.system === system);
  async function changeSystem(value: string) {
    setSaving(true); setError("");
    try { await onChangeSystem(value); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to change campaign system."); }
    finally { setSaving(false); }
  }
  const shortcuts = [
    { title: "Bestiary", count: ownBlocks.filter(block => ["MONSTER", "NPC"].includes(block.category)).length, icon: Sword, action: () => onOpenCompendium() },
    { title: "Spellbook", count: ownBlocks.filter(block => block.category === "SPELL").length, icon: WandSparkles, action: () => onOpenCompendium("SPELL") },
    { title: "Treasure", count: ownBlocks.filter(block => block.category === "ITEM").length, icon: Gem, action: () => onOpenCompendium("ITEM") },
    { title: "Session journals", count: articles.filter(article => article.template === "REPORT").length, icon: Scroll, action: () => onNewArticle("REPORT") },
  ];
  return <div className="space-y-5">
    <section className="relative overflow-hidden rounded-xl border border-amber-800/40 bg-gradient-to-br from-amber-950/45 via-zinc-900 to-zinc-950 p-6 sm:p-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-500"><Shield size={16} /> {profile.gm} campaign desk</p><span className="rounded-full border border-amber-700/40 px-3 py-1 text-xs text-amber-200">{profile.short}{pf ? " · Remaster" : ""}</span></div>
      <h2 className="max-w-xl font-serif text-3xl leading-tight text-amber-50 sm:text-4xl">A world worth adventuring in.</h2>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400">Prepare your next session, build memorable foes, and keep your campaign lore within reach.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {[{ id: "DND_5E", title: "Dungeons & Dragons 5e", subtitle: "2014 rules · CR, ability scores & attunement" }, { id: "PF_2E", title: "Pathfinder 2e", subtitle: "Remaster · levels, traits & three-action turns" }].map(option => <button key={option.id} disabled={saving} aria-pressed={system === option.id} onClick={() => changeSystem(option.id)} className={`rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${system === option.id ? "border-amber-500/70 bg-amber-950/35" : "border-zinc-700 bg-zinc-950/40 hover:border-amber-700"}`}><span className="flex items-center justify-between gap-2 font-serif text-lg text-amber-100">{option.title}<span className="text-[10px] font-sans uppercase tracking-wider text-amber-500">{system === option.id ? "Active" : "Choose"}</span></span><span className="mt-1 block text-xs text-zinc-400">{option.subtitle}</span></button>)}
      </div>
      <p className="mt-3 text-xs text-zinc-500">This sets defaults for new content. Existing statblocks keep their rules system.</p>
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{shortcuts.map(({ title, count, icon: Icon, action }) => <button key={title} onClick={action} className="group rounded-lg border border-zinc-800 bg-zinc-900/70 p-4 text-left hover:border-amber-800"><span className="flex items-center justify-between"><Icon size={19} className="text-amber-500" /><span className="font-serif text-2xl text-zinc-200">{count}</span></span><span className="mt-3 flex items-center justify-between text-xs font-medium text-zinc-300">{title}<ArrowRight size={13} className="text-zinc-500 group-hover:text-amber-400" /></span></button>)}</div>
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5"><h3 className="font-serif text-xl text-amber-100">Prepare the next adventure</h3><div className="mt-4 grid grid-cols-2 gap-2">{[{ label: "NPC / character", template: "CHARACTER", icon: Users }, { label: "Creature", template: "CREATURE", icon: Sword }, { label: "Spell", template: "SPELL", icon: WandSparkles }, { label: "Item", template: "ITEM", icon: Gem }, { label: "Encounter", template: "ENCOUNTER", icon: Sword }, { label: "Adventure / quest", template: "PLOT", icon: Sword }, { label: "Dungeon / location", template: "BUILDING", icon: BookOpen }, { label: "Session recap", template: "REPORT", icon: Scroll }].map(({ label, template, icon: Icon }) => <button key={template} onClick={() => onNewArticle(template as ArticleTemplateType)} className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3 text-left text-xs text-zinc-300 hover:border-amber-800"><Icon size={14} className="shrink-0 text-amber-500" />{label}</button>)}</div><button onClick={onOpenGm} className="mt-4 text-xs font-semibold text-amber-400">Open {profile.gm} screen & secrets →</button></section>
      <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
        {sessions && onRefreshSessions ? (
          <NextSessionDesk worldId={worldId || ""} sessions={sessions} onRefresh={onRefreshSessions} worldSystem={system} />
        ) : (
          <><h3 className="font-serif text-xl text-amber-100">At your table</h3><p className="mt-3 text-sm leading-relaxed text-zinc-400">{pf ? "Track creature levels, Perception and the three saves. Give abilities a one-, two- or three-action cost, a reaction, or a free action." : "Prepare challenge ratings, Armor Class, Hit Points and ability scores. Separate actions, bonus actions and reactions when writing abilities."}</p><div className="mt-4 flex flex-wrap gap-2">{(pf ? ["Creature level", "Fortitude · Reflex · Will", "Spell rank", "Invested items"] : ["Challenge rating", "Six ability scores", "Spell level", "Attunement"]).map(term => <span key={term} className="rounded bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300">{term}</span>)}</div><a target="_blank" rel="noreferrer" href={pf ? "https://2e.aonprd.com/Rules.aspx?ID=2007" : "https://www.dndbeyond.com/sources/dnd/basic-rules-2014/combat"} className="mt-4 inline-block text-xs font-semibold text-amber-400">{pf ? "Pathfinder rules · Archives of Nethys" : "D&D 2014 Basic Rules · Combat"} ↗</a></>
        )}
      </section>
    </div>
  </div>;
}
