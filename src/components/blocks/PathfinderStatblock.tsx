import type { ReactNode } from "react";
import { ATTRIBUTES, parseBlockStats, signed, type BlockStats, type RpgBlockItem } from "@/lib/rpg";
import { pfText as text, pfTitle, pfTraits } from "@/lib/pf2-statblocks";
import { ActionCostBadge, RulesEmblem } from "./RulesIcons";

type Entry = { name?: unknown; cost?: unknown; desc?: unknown; section?: unknown; trigger?: unknown; requirements?: unknown; frequency?: unknown };
function Lines({ value, effect = false }: { value: unknown; effect?: boolean }) {
  return <>{text(value).split(/\n\s*\n|\n/).filter(Boolean).map((line,index) => {
    const result = /^(Critical Success|Critical Failure|Success|Failure|Heightened(?:\s*\([^)]*\))?|Special)(?:[.:]|\s)\s*(.*)$/.exec(line);
    return <p key={index} className={result ? "pf-result" : effect ? "pf-effect" : "pf-line"}>{result ? <><strong>{result[1]}</strong> {result[2]}</> : line}</p>;
  })}</>;
}
function Entries({ entries }: { entries: unknown[] }) {
  return <>{entries.map((raw,index) => {
    if (typeof raw === "string") return <div className="pf-entry" key={index}><Lines value={raw} /></div>;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const entry = raw as Entry;
    return <div className="pf-entry" key={index}><p className="pf-line"><strong>{text(entry.name)}</strong>{text(entry.cost) && <> <ActionCostBadge system="PF_2E" cost={entry.cost} /></>}{text(entry.frequency) && <> <strong>Frequency</strong> {text(entry.frequency)};</>}{text(entry.trigger) && <> <strong>Trigger</strong> {text(entry.trigger)};</>}{text(entry.requirements) && <> <strong>Requirements</strong> {text(entry.requirements)};</>}{text(entry.trigger) || text(entry.requirements) ? <> <strong>Effect</strong> </> : " "}{text(entry.desc).split('\n')[0]}</p>{text(entry.desc).includes('\n') && <Lines value={text(entry.desc).split('\n').slice(1).join('\n')} />}</div>;
  })}</>;
}
export function PathfinderStatblock({ block }: { block: RpgBlockItem }) {
  const stats = parseBlockStats(block.statsJson);
  const creature = ["MONSTER", "NPC"].includes(block.category), hazard = block.category === "HAZARD";
  const actions = Array.isArray(stats.actions) ? stats.actions : [];
  const defensive = actions.filter(value => value && typeof value === "object" && value.section === "defense");
  const offensive = actions.filter(value => !defensive.includes(value));
  const abilities = Array.isArray(stats.traits) ? stats.traits : [];
  const traits = pfTraits(stats);
  const field = (key: string, label: string, value: unknown = stats[key]) => text(value) ? <span key={key}><strong>{label}</strong> {text(value)}</span> : null;
  const row = (fields: [string,string][]) => { const present = fields.filter(([key]) => text(stats[key])); return present.length ? <p className="pf-line">{present.map(([key,label],i) => <span key={key}>{i > 0 ? "; " : ""}{field(key,label)}</span>)}</p> : null; };
  const line = (key: string, label: string) => row([[key,label]]);
  const section = (content: ReactNode, show: boolean) => show ? <div className="pf-rule-section">{content}</div> : null;
  const has = (...keys: string[]) => keys.some(key => text(stats[key]));
  const attributes = stats.attributes && typeof stats.attributes === "object" && !Array.isArray(stats.attributes) ? stats.attributes as BlockStats : null;
  const traitStrip = traits.length ? <ul aria-label="Creature and rules traits" className="pf-trait-strip">{traits.map(tag => <li key={tag} data-trait={tag.toLowerCase()}>{tag}</li>)}</ul> : null;
  const effect = <><Lines value={stats.description} effect />{([['criticalSuccess','Critical Success'],['success','Success'],['failure','Failure'],['criticalFailure','Critical Failure']] as const).map(([key,label]) => text(stats[key]) ? <p key={key} className="pf-result"><strong>{label}</strong> {text(stats[key])}</p> : null)}</>;
  return <article aria-label={`${block.name} statblock`} data-rules-style="pf2-remaster" data-pf-block={block.category.toLowerCase()} className="statblock-card pf-reference">
    <header className="statblock-heading"><div className="pf-title"><RulesEmblem system="PF_2E" /><h3>{block.name}</h3>{!creature && !hazard && <ActionCostBadge system="PF_2E" cost={stats.actionCost} />}</div><span className="pf-type">{pfTitle(block.category,stats)}</span></header>
    {traitStrip}
    {creature ? <>
      {text(stats.description) && <p className="pf-description">{text(stats.description)}</p>}
      {row([["perception","Perception"],["senses","Senses"]])}{line("languages","Languages")}{line("skills","Skills")}
      {attributes && <p className="pf-line pf-attributes">{ATTRIBUTES.filter(key => text(attributes[key])).map((key,index) => <span key={key}>{index ? ", " : ""}<strong>{key[0].toUpperCase()+key.slice(1)}</strong> {Number.isFinite(Number(attributes[key])) ? signed(Number(attributes[key])) : text(attributes[key])}</span>)}</p>}
      {!attributes && stats.stats != null && <p className="pf-line">Legacy ability scores are preserved. Edit this entry to add Remaster attribute modifiers.</p>}
      {line("items","Items")}
      {section(<>{row([["ac","AC"],["fortitude","Fort"],["reflex","Ref"],["will","Will"]])}{row([["hp","HP"],["damageImmunities","Immunities"],["weaknesses","Weaknesses"],["resistances","Resistances"]])}<Entries entries={abilities} /><Entries entries={defensive} /></>,has("ac","fortitude","reflex","will","hp","damageImmunities","weaknesses","resistances") || abilities.length > 0 || defensive.length > 0)}
      {section(<>{line("speed","Speed")}<Entries entries={offensive} />{text(stats.spellcasting) && <div className="pf-entry"><strong>Spellcasting</strong><Lines value={stats.spellcasting} /></div>}{Array.isArray(stats.spells) && stats.spells.length > 0 && <div className="pf-entry"><strong>Spells</strong>{stats.spells.map((spell,index) => <Lines key={index} value={spell} />)}</div>}</>,has("speed","spellcasting") || offensive.length > 0 || Array.isArray(stats.spells) && stats.spells.length > 0)}
    </> : hazard ? <>
      {line("stealth","Stealth")}{line("description","Description")}
      {section(<>{line("disable","Disable")}{row([["ac","AC"],["fortitude","Fort"],["reflex","Ref"],["will","Will"]])}{row([["hardness","Hardness"],["hp","HP"],["brokenThreshold","BT"],["damageImmunities","Immunities"],["weaknesses","Weaknesses"],["resistances","Resistances"]])}<Entries entries={defensive} /></>,has("disable","ac","fortitude","reflex","will","hardness","hp","brokenThreshold","damageImmunities","weaknesses","resistances") || defensive.length > 0)}
      <Entries entries={offensive} />{line("routine","Routine")}{line("reset","Reset")}
    </> : block.category === "SPELL" ? <>
      {line("traditions","Traditions")}{line("cast","Cast")}{row([["requirements","Requirements"],["trigger","Trigger"]])}{row([["range","Range"],["area","Area"],["targets","Targets"]])}{row([["save","Defense"],["duration","Duration"]])}
      {section(effect,has("description","criticalSuccess","success","failure","criticalFailure"))}<Entries entries={actions} />
      {section(<Lines value={text(stats.heightened).split('\n').map(value => /^Heightened/.test(value) ? value : `Heightened ${value}`).join('\n')} />,has("heightened"))}
    </> : block.category === "FEAT" ? <>
      {line("prerequisites","Prerequisites")}{line("requirements","Requirements")}{row([["frequency","Frequency"],["trigger","Trigger"]])}
      {section(effect,has("description","criticalSuccess","success","failure","criticalFailure"))}<Entries entries={actions} />{section(line("special","Special"),has("special"))}
    </> : block.category === "ITEM" ? <>
      {line("price","Price")}{row([["usage","Usage"],["bulk","Bulk"]])}{line("activation","Activate")}{row([["frequency","Frequency"],["requirements","Requirements"],["trigger","Trigger"]])}
      {section(effect,has("description"))}<Entries entries={actions} />{section(line("special","Special"),has("special"))}
    </> : <><Lines value={stats.description} effect /><Entries entries={abilities} /><Entries entries={actions} />{Array.isArray(stats.spells) && stats.spells.map((spell,index) => <Lines key={index} value={spell} />)}</>}
  </article>;
}
