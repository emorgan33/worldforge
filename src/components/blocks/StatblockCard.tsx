import { PathfinderStatblock } from "./PathfinderStatblock";
import { ActionCostBadge, RulesEmblem } from "./RulesIcons";
import { ATTRIBUTES, blockFields, blockRating, isDnd, parseBlockStats, RpgBlockItem, signed, statText, systemProfile } from "@/lib/rpg";

export function StatblockCard({ block }: { block: RpgBlockItem }) {
  if (block.system === "PF_2E") return <PathfinderStatblock block={block} />;
  const stats = parseBlockStats(block.statsJson);
  const pf = block.system === "PF_2E";
  const creature = ["MONSTER", "NPC"].includes(block.category);
  const attributes = pf ? stats.attributes : stats.stats;
  const values = attributes && typeof attributes === "object" ? attributes as Record<string, unknown> : null;
  const traitTags = pf ? [...new Set([statText(stats.rarity), statText(stats.size), ...statText(stats.traitsText).split(/[,;]/)].map(tag => tag.trim()).filter(tag => tag && tag.toLowerCase() !== "common"))].slice(0, 20) : [];
  const actions = Array.isArray(stats.actions) ? stats.actions : [];
  return <article data-rules-style={pf ? "pf2-remaster" : isDnd(block.system) ? "dnd-2014" : undefined} aria-label={`${block.name} statblock`} className={`statblock-card rounded-xl border border-amber-800/50 bg-[#201c17] p-6 text-amber-50 shadow-xl ${pf ? "border-t-4 border-t-red-700" : "border-t-4 border-t-amber-500"}`}>
    <div className="statblock-heading flex flex-wrap items-start justify-between gap-3 border-b border-amber-800/60 pb-4">
      <div className="flex min-w-0 items-center gap-3"><RulesEmblem system={block.system} /><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">{systemProfile(block.system).short}{pf ? " · Remaster" : ""}</p><h3 className="mt-1 font-serif text-3xl text-amber-100">{block.name}</h3></div></div>
      <span className="rounded border border-amber-700/60 px-2 py-1 text-xs font-bold text-amber-300">{blockRating(block)}</span>
    </div>
    {traitTags.length > 0 && <ul aria-label="Creature and rules traits" className="pf-trait-strip">{traitTags.map(tag => <li key={tag} data-trait={tag.toLowerCase()}>{tag}</li>)}</ul>}
    <dl className="mt-4 space-y-2 text-sm">
      {blockFields(block.system, block.category).map(field => {
        const text = statText(stats[field.key]);
        return text ? <div key={field.key} className={field.multiline ? "border-t border-amber-800/40 pt-3" : ""}><dt className="inline font-semibold text-amber-400">{field.label}: </dt><dd className="inline whitespace-pre-wrap leading-relaxed text-amber-50/85">{text}</dd></div> : null;
      })}
    </dl>
    {creature && values && <div className="my-4 grid grid-cols-3 gap-2 rounded-lg border border-amber-800/40 bg-black/15 p-3 text-center sm:grid-cols-6">
      {ATTRIBUTES.map(key => {
        const score = Number(values[key]);
        return <div key={key}><span className="block text-[10px] font-bold uppercase tracking-wider text-amber-500">{key}</span><span className="text-sm font-semibold">{Number.isFinite(score) ? pf ? signed(score) : `${score} (${signed(Math.floor((score - 10) / 2))})` : "—"}</span></div>;
      })}
    </div>}
    {creature && pf && !values && stats.stats != null && <p className="mt-4 text-xs text-amber-300">Legacy ability scores are preserved. Edit this entry to add Remaster attribute modifiers.</p>}
    {Array.isArray(stats.traits) && stats.traits.length > 0 && <section className="mt-5 space-y-2"><h4 className="border-b border-amber-800/40 pb-1 font-serif text-lg text-amber-300">Abilities</h4>{stats.traits.map((trait, index) => <p key={index} className="text-sm">{typeof trait === "string" ? trait : trait && typeof trait === "object" ? <><strong>{statText(trait.name)}. </strong>{statText(trait.desc)}</> : null}</p>)}</section>}
    {actions.length > 0 && <section className="mt-5 space-y-3"><h4 className="border-b border-amber-800/40 pb-1 font-serif text-lg text-amber-300">{pf ? "Actions & reactions" : "Actions"}</h4>{actions.map((action, index) => <div key={index} className="text-sm leading-relaxed">{typeof action === "string" ? action : action && typeof action === "object" ? <><div className="flex flex-wrap items-center gap-2"><strong>{statText(action.name)}</strong><ActionCostBadge system={block.system} cost={action.cost} /></div><p className="mt-1 whitespace-pre-wrap text-amber-50/80">{statText(action.desc)}</p></> : null}</div>)}</section>}
    {Array.isArray(stats.spells) && stats.spells.length > 0 && <section className="mt-5 space-y-2"><h4 className="border-b border-amber-800/40 pb-1 font-serif text-lg text-amber-300">Spellcasting</h4>{stats.spells.map((spell, index) => <p key={index} className="text-sm">{statText(spell)}</p>)}</section>}
    {isDnd(block.system) && statText(stats.legendaryActions) && <section className="mt-5"><h4 className="font-serif text-lg text-amber-300">Legendary actions</h4><p className="mt-2 whitespace-pre-wrap text-sm">{statText(stats.legendaryActions)}</p></section>}
  </article>;
}
