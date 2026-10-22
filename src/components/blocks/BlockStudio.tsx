"use client";
import { useWorldGuard } from "@/components/worlds/WorldGuard";

import { useMemo, useState } from "react";
import { BookOpen, Plus, Search, Sword, X } from "lucide-react";
import { ATTRIBUTES, BLOCK_CATEGORIES, BlockCategory, BlockInput, BlockStats, CATEGORY_LABELS, RPG_SYSTEMS, RpgBlockItem, blockFields, blockRating, isDnd, parseBlockStats, signed, starterStats, statText, systemProfile } from "@/lib/rpg";
import { StatblockCard } from "./StatblockCard";
import { FoundryImport } from "@/components/foundry/FoundryImport";
import { ShareResource } from "@/components/campaign/ShareResource";
import type { GuardRegistration } from "@/lib/navigation-guard";

interface BlockStudioProps {
  blocks: RpgBlockItem[];
  worldId: string;
  system: string;
  initialCategory?: BlockCategory;
  onSaveBlock: (block: BlockInput) => Promise<RpgBlockItem>;
  onDeleteBlock: (id: string) => Promise<void>;
  onRefreshBlocks?: () => Promise<void> | void;
  focusBlockId?: string | null;
  onGuardChange?: (registration: GuardRegistration) => void;
}
interface ActionDraft { name: string; cost: string; desc: string; [key: string]: unknown }
const inputClass = "mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 focus:border-amber-500 focus:outline-none";

export function BlockStudio({ blocks, worldId, system, initialCategory, onSaveBlock, onDeleteBlock, onRefreshBlocks, focusBlockId, onGuardChange }: BlockStudioProps) {
  const [filterSystem, setFilterSystem] = useState(system);
  const [filterCategory, setFilterCategory] = useState<string>(initialCategory ?? "ALL");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(focusBlockId ?? null);
  const [editing, setEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [name, setName] = useState("");
  const [formSystem, setFormSystem] = useState(system);
  const [category, setCategory] = useState<BlockCategory>(initialCategory ?? "MONSTER");
  const [stats, setStats] = useState<BlockStats>(() => starterStats(system, initialCategory ?? "MONSTER"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const lcQuery = query.toLowerCase(); // Pre-lowercase outside hot path

  useWorldGuard({ dirty: editing, busy }, "compendium", onGuardChange);
  const filtered = useMemo(() => blocks.filter(block =>
    (filterSystem === "ALL" || block.system === filterSystem) &&
    (filterCategory === "ALL" || block.category === filterCategory) &&
    block.name.toLowerCase().includes(lcQuery)),
  [blocks, filterSystem, filterCategory, lcQuery]);
  const selected = filtered.find(block => block.id === selectedId) ?? filtered[0];
  const pf = formSystem === "PF_2E";
  const hasActions = ["MONSTER", "NPC", "HAZARD", "ITEM"].includes(category);
  const creature = category === "MONSTER" || category === "NPC";
  const attributeKey = pf ? "attributes" : "stats";
  const rawAttributes = stats[attributeKey];
  const attributes = rawAttributes && typeof rawAttributes === "object" ? rawAttributes as Record<string, unknown> : {};
  const actions: ActionDraft[] = useMemo(() => Array.isArray(stats.actions)
    ? stats.actions.filter(action => typeof action === "string" || action && typeof action === "object")
      .map(action => typeof action === "string"
        ? { name: "", cost: "", desc: action }
        : { ...action, name: statText(action.name), cost: statText(action.cost), desc: statText(action.desc) })
    : [],
  [stats.actions]);

  function open(block?: RpgBlockItem) {
    setEditingId(block?.id); setName(block?.name ?? "");
    const creationSystem = filterSystem === "ALL" ? system : filterSystem;
    setFormSystem(block?.system ?? creationSystem);
    const nextCategory = (block?.category as BlockCategory) ?? (filterCategory !== "ALL" ? filterCategory as BlockCategory : "MONSTER");
    setCategory(nextCategory);
    setStats(block ? parseBlockStats(block.statsJson) : starterStats(creationSystem, nextCategory));
    setError(""); setDeleting(false); setEditing(true);
  }
  function setField(key: string, value: unknown) { setStats(previous => ({ ...previous, [key]: value })); }
  function updateAction(index: number, key: string, value: string) { setField("actions", actions.map((action, i) => i === index ? { ...action, [key]: value } : action)); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const saved = await onSaveBlock({ id: editingId, worldId, name: name.trim(), system: formSystem, category, stats });
      setFilterSystem(formSystem); setFilterCategory(category); setQuery(""); setSelectedId(saved.id); setEditing(false);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to save statblock."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected) return; setBusy(true); setError("");
    try { await onDeleteBlock(selected.id); setDeleting(false); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to delete statblock."); }
    finally { setBusy(false); }
  }

  async function openImportedBlock(id: string) {
    try {
      await onRefreshBlocks?.();
      setFilterSystem("PF_2E"); setFilterCategory("ALL"); setQuery(""); setSelectedId(id);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to refresh imported entries."); }
  }

  return <section className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-amber-900/50 bg-gradient-to-br from-amber-950/35 to-zinc-900 p-6">
      <div><p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-amber-500"><Sword size={15} /> {systemProfile(system).short}</p><h1 className="font-serif text-3xl text-amber-50">Bestiary & spellbook</h1><p className="mt-2 max-w-xl text-sm text-zinc-400">Build creatures, NPCs, spells and treasure for D&D 5e 2014 and Pathfinder 2e Remaster.</p></div>
      <div className="flex flex-wrap gap-2"><FoundryImport worldId={worldId} onComplete={onRefreshBlocks} onOpenBlock={id => { void openImportedBlock(id); }} /><button onClick={() => open()} className="flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 hover:bg-amber-400"><Plus size={16} /> Create statblock</button></div>
    </header>
    {!editing && error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs text-zinc-400"><span className="flex items-center gap-2"><Search size={12} /> Search compendium</span><input className={inputClass} value={query} onChange={event => setQuery(event.target.value)} placeholder="Creature, spell or item name…" /></label>
      <label className="text-xs text-zinc-400">Rules system<select aria-label="Rules system" className={inputClass} value={filterSystem} onChange={event => { setFilterSystem(event.target.value); if (event.target.value !== "ALL" && event.target.value !== "PF_2E" && ["HAZARD", "FEAT"].includes(filterCategory)) setFilterCategory("ALL"); setDeleting(false); }}>{RPG_SYSTEMS.map(profile => <option key={profile.id} value={profile.id}>{profile.short}{profile.id === "PF_2E" ? " · Remaster" : ""}</option>)}<option value="ALL">All systems</option></select></label>
      <label className="text-xs text-zinc-400">Entry type<select aria-label="Entry type" className={inputClass} value={filterCategory} onChange={event => { setFilterCategory(event.target.value); setDeleting(false); }}><option value="ALL">All entries</option>{BLOCK_CATEGORIES.filter(value => filterSystem === "ALL" || filterSystem === "PF_2E" || !["HAZARD", "FEAT"].includes(value)).map(value => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}</select></label>
    </div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(230px,1fr)_2fr]">
      <div className="space-y-2"><p className="mb-3 text-xs uppercase tracking-wider text-zinc-500">{filtered.length} compendium entries</p>{filtered.map(block => <button key={block.id} onClick={() => { setSelectedId(block.id); setDeleting(false); }} className={`w-full rounded-lg border p-4 text-left ${selected?.id === block.id ? "border-amber-600 bg-amber-950/20" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"}`}><span className="block text-sm font-semibold text-zinc-100">{block.name}</span><span className="mt-1 block text-xs text-zinc-400">{systemProfile(block.system).short} · {blockRating(block)}</span></button>)}{!filtered.length && <div className="rounded-lg border border-dashed border-zinc-700 p-6 text-sm text-zinc-400"><BookOpen className="mb-3 text-amber-500" size={24} />No entries for these filters. Create a statblock or select another system.</div>}</div>
      <div className="space-y-3">{selected ? <>
        <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
          {deleting ? <><span className="text-red-300">Delete {selected.name}?</span><button disabled={busy} onClick={remove} className="rounded border border-red-800 px-3 py-1 text-red-300">Confirm delete</button><button onClick={() => setDeleting(false)} disabled={busy} className="px-2 text-zinc-400">Cancel</button></> : <><button onClick={() => open(selected)} className="rounded border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800">Edit statblock</button><button onClick={() => setDeleting(true)} className="px-2 py-1.5 text-red-400">Delete</button></>}
        </div><StatblockCard block={selected} /><ShareResource key={selected.id} kind="statblocks" resourceId={selected.id} title={selected.name} />
      </> : <div className="rounded-xl border border-zinc-800 p-12 text-center text-zinc-500">Your next encounter starts here.</div>}</div>
    </div>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget && !busy) setEditing(false); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="statblock-title" className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-amber-800/50 bg-zinc-900 p-5 shadow-2xl sm:p-7" onKeyDown={event => {
        if (event.key === "Escape" && !busy) setEditing(false);
        if (event.key === "Tab") {
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, textarea, [tabindex="0"]'));
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
        <div className="mb-5 flex items-center justify-between"><div><p className="text-xs uppercase tracking-wider text-amber-500">Homebrew compendium</p><h2 id="statblock-title" className="mt-1 font-serif text-2xl">{editingId ? "Edit statblock" : "Create statblock"}</h2></div><button type="button" disabled={busy} aria-label="Close statblock editor" onClick={() => setEditing(false)} className="p-2 text-zinc-400"><X size={20} /></button></div>
        <form onSubmit={save} className="space-y-5">
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          <label className="block text-sm">Name<input autoFocus required maxLength={200} value={name} onChange={event => setName(event.target.value)} className={inputClass} placeholder="e.g. Ashen Watch Sentinel" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm">Rules system<select aria-label="Rules system" className={inputClass} value={formSystem} disabled={!!editingId} onChange={event => { const nextCategory = event.target.value !== "PF_2E" && ["HAZARD", "FEAT"].includes(category) ? "MONSTER" : category; setCategory(nextCategory); setFormSystem(event.target.value); setStats(starterStats(event.target.value, nextCategory)); }}>{RPG_SYSTEMS.map(profile => <option key={profile.id} value={profile.id}>{profile.short}{profile.id === "PF_2E" ? " · Remaster" : ""}</option>)}</select></label>
            <label className="text-sm">Entry type<select aria-label="Entry type" className={inputClass} value={category} disabled={!!editingId} onChange={event => { setCategory(event.target.value as BlockCategory); setStats(starterStats(formSystem, event.target.value)); }}>{BLOCK_CATEGORIES.filter(value => pf || !["HAZARD", "FEAT"].includes(value)).map(value => <option key={value} value={value}>{CATEGORY_LABELS[value]}</option>)}</select></label>
          </div>
          <p className="text-xs text-zinc-400">{editingId ? "Editing keeps all existing fields, including fields not shown below." : "Starting values are homebrew placeholders. Adjust them for your creature or spell."}</p>
          <div className="grid gap-4 sm:grid-cols-2">{blockFields(formSystem, category).map((field, index, fields) => <div key={field.key} className={field.multiline || field.group && fields[index-1]?.group !== field.group ? "sm:col-span-2" : ""}>{field.group && fields[index-1]?.group !== field.group && <h3 className="mb-3 border-b border-zinc-700 pb-2 text-sm font-semibold text-amber-200">{field.group}</h3>}<label className={`text-xs font-medium text-zinc-300 ${field.multiline ? "sm:col-span-2" : ""}`}>{field.label}{field.multiline ? <textarea aria-label={field.label} rows={3} value={statText(stats[field.key])} onChange={event => setField(field.key, event.target.value)} className={inputClass} /> : <input aria-label={field.label} value={statText(stats[field.key])} onChange={event => setField(field.key, event.target.value)} placeholder={field.placeholder} className={inputClass} />}</label></div>)}</div>
          {creature && (pf || isDnd(formSystem)) && <fieldset className="rounded-lg border border-zinc-700 p-4"><legend className="px-2 text-xs font-semibold text-amber-400">{pf ? "Attribute modifiers" : "Ability scores"}</legend><div className="grid grid-cols-3 gap-3 sm:grid-cols-6">{ATTRIBUTES.map(key => <label key={key} className="text-center text-xs uppercase text-zinc-400">{key}<input aria-label={`${key.toUpperCase()} ${pf ? "modifier" : "score"}`} type="number" min={pf ? -10 : 1} max={pf ? 20 : 30} value={statText(attributes[key])} onChange={event => setField(attributeKey, { ...attributes, [key]: event.target.value === "" ? "" : Number(event.target.value) })} className={inputClass} />{!pf && statText(attributes[key]) && <span className="mt-1 block text-amber-500">{signed(Math.floor((Number(attributes[key]) - 10) / 2))}</span>}</label>)}</div></fieldset>}
          {hasActions && <section className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-serif text-lg text-amber-200">{pf ? "Actions & reactions" : "Actions"}</h3><button type="button" onClick={() => setField("actions", [...actions, { name: "", cost: pf ? "1" : "action", desc: "" }])} className="text-xs text-amber-400">+ Add ability</button></div>{actions.map((action, index) => <div key={index} className="space-y-3 rounded-lg border border-zinc-700 bg-zinc-950/50 p-3"><div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Ability name<input aria-label="Ability name" value={action.name} onChange={event => updateAction(index, "name", event.target.value)} className={inputClass} /></label><label className="text-xs">Action cost<select aria-label="Action cost" value={action.cost} onChange={event => updateAction(index, "cost", event.target.value)} className={inputClass}><option value="">Unspecified</option>{(pf ? [["1", "1 action"], ["2", "2 actions"], ["3", "3 actions"], ["reaction", "Reaction"], ["free", "Free action"], ["passive", "Passive"]] : [["action", "Action"], ["bonus", "Bonus action"], ["reaction", "Reaction"], ["legendary", "Legendary action"], ["passive", "Passive"]]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>{pf && <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs">Placement<select aria-label="Ability placement" value={statText(action.section) || "offense"} onChange={event => updateAction(index,"section",event.target.value)} className={inputClass}><option value="offense">Offense / effect</option><option value="defense">Defensive ability</option></select></label>{["trigger", "requirements", "frequency"].map(key => <label key={key} className="text-xs">{key[0].toUpperCase()+key.slice(1)}<input aria-label={`Ability ${key}`} value={statText(action[key])} onChange={event => updateAction(index,key,event.target.value)} className={inputClass} /></label>)}</div>}<label className="block text-xs">Effect<textarea aria-label="Effect" rows={2} value={action.desc} onChange={event => updateAction(index, "desc", event.target.value)} className={inputClass} /></label><button type="button" aria-label={`Remove ability ${index + 1}`} onClick={() => setField("actions", actions.filter((_, i) => i !== index))} className="text-xs text-red-400">Remove ability</button></div>)}</section>}
          {pf && <details className="rounded-lg border border-zinc-700 p-3"><summary className="cursor-pointer text-sm text-amber-200">Preview statblock</summary><div className="mt-3"><StatblockCard block={{ id: editingId || "preview", worldId, system: formSystem, category, name: name || "Untitled", statsJson: JSON.stringify(stats) }} /></div></details>}
          <div className="flex justify-end gap-3 border-t border-zinc-800 pt-4"><button type="button" disabled={busy} onClick={() => setEditing(false)} className="rounded-lg border border-zinc-700 px-4 py-2 text-sm">Cancel</button><button disabled={busy || !name.trim()} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-zinc-950 disabled:opacity-40">{busy ? "Saving…" : "Save statblock"}</button></div>
        </form>
      </div>
    </div>}
  </section>;
}
