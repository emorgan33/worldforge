"use client";

import type { ArticleTemplateMeta } from "@/types";
import { templateFieldGroups } from "@/lib/templates";
import { articleBlockCategory, articleFacts, articleStatblock, articleStatblockKey } from "@/lib/article-template-content";
import type { RpgBlockItem } from "@/lib/rpg";
import { StatblockCard } from "@/components/blocks/StatblockCard";
import { Search } from "lucide-react";

const inputClass = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none";
const selectClass = "mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-amber-500 focus:outline-none";

function getParticipantKeys(system: string): string[] {
  const prefix = system === "PF_2E" ? "pf2e" : "dnd5e";
  return Array.from({ length: 6 }, (_, i) => `${prefix}Participant${i + 1}`);
}

function findStatblockById(blocks: RpgBlockItem[], id: string): RpgBlockItem | undefined {
  return blocks.find(b => b.id === id);
}

export function ArticleTemplateFields({ template, system, metadata, blocks, onChange }: {
  template: ArticleTemplateMeta; system: string; metadata: Record<string, string>; blocks: RpgBlockItem[];
  onChange: (key: string, value: string) => void;
}) {
  const category = articleBlockCategory(template.type);
  const key = articleStatblockKey(system);
  const choices = blocks.filter(block => block.system === system && block.category === category);
  const linked = articleStatblock(template.type, system, metadata, blocks);
  const { other } = articleFacts(template, metadata);
  const isEncounter = template.type === "ENCOUNTER";
  const participantKeys = isEncounter ? getParticipantKeys(system) : [];
  const linkedParticipants = participantKeys.map(pk => metadata[pk]).filter(Boolean).map(id => findStatblockById(blocks, id)).filter((b): b is RpgBlockItem => b !== undefined);
  const hasParticipantLinks = linkedParticipants.length > 0;

  return <div className="space-y-5">
    {templateFieldGroups(template).map(group => {
      if (isEncounter && group.name === "Participants") {
        const participantFields = group.fields.filter(f => f.key.includes("Participant"));
        return <>
          <fieldset key={group.name} className="rounded-xl border border-amber-800/50 bg-zinc-900/50 p-4">
            <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-amber-400">{group.name}</legend>
            <p className="mb-4 text-xs text-zinc-400">Link creatures and NPCs from your compendium. Previews appear below after linking.</p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {participantFields.map(field => {
                const value = metadata[field.key] || "";
                const monsterChoices = blocks.filter(b => b.system === system && (b.category === "MONSTER" || b.category === "NPC"));
                return <label key={field.key} htmlFor={`article-meta-${field.key}`} className="block text-xs text-zinc-300">
                  <span className="flex items-center gap-1"><Search size={11} /> {field.label}</span>
                  <select aria-label={field.label} id={`article-meta-${field.key}`} value={value} onChange={event => onChange(field.key, event.target.value)} className={selectClass}>
                    <option value="">— None —</option>
                    {value && !monsterChoices.some(b => b.id === value) && <option value={value}>Saved: {value.slice(0, 8)}…</option>}
                    {monsterChoices.map(block => <option key={block.id} value={block.id}>{block.name}</option>)}
                  </select>
                </label>;
              })}
            </div>
          </fieldset>
          {hasParticipantLinks && <section className="space-y-3 rounded-xl border border-amber-800/30 bg-zinc-900/30 p-4">
            <h4 className="text-xs font-semibold text-amber-300">Participant Previews</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              {linkedParticipants.map(block => (
                <div key={block.id} className="rounded-lg border border-zinc-700 bg-zinc-950/50 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-zinc-200">{block.name}</span>
                    <span className="text-xs text-zinc-500">{block.category}</span>
                  </div>
                  <StatblockCard block={block} />
                </div>
              ))}
            </div>
            <p className="text-xs text-zinc-500">Full creature mechanics are linked from the compendium. Update the statblock there to keep these in sync.</p>
          </section>}
        </>;
      }
      return <fieldset key={group.name} className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <legend className="px-2 text-xs font-semibold uppercase tracking-wider text-amber-400">{group.name}</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{group.fields.map(field => {
          const value = metadata[field.key] || "";
          const legacyNumber = field.type === "number" && value !== "" && (!Number.isInteger(Number(value)) || (field.min !== undefined && Number(value) < field.min) || (field.max !== undefined && Number(value) > field.max));
          return <label key={field.key} htmlFor={`article-meta-${field.key}`} className={`block text-xs text-zinc-300 ${field.type === "textarea" ? "sm:col-span-2 lg:col-span-3" : ""}`}>
            {field.label}
            {field.type === "select" ? <select aria-label={field.label} id={`article-meta-${field.key}`} value={value} onChange={event => onChange(field.key, event.target.value)} className={inputClass}>
              <option value="">Not specified</option>
              {value && !field.options?.includes(value) && <option value={value}>{value} (saved value)</option>}
              {field.options?.map(option => <option key={option} value={option}>{option}</option>)}
            </select> : field.type === "textarea" ? <textarea aria-label={field.label} id={`article-meta-${field.key}`} rows={3} value={value} placeholder={field.placeholder} onChange={event => onChange(field.key, event.target.value)} className={inputClass} /> :
              <input aria-label={field.label} id={`article-meta-${field.key}`} type={legacyNumber ? "text" : field.type} min={field.min} max={field.max} step={field.step} value={value} placeholder={field.placeholder} onChange={event => onChange(field.key, event.target.value)} className={inputClass} />}
            {legacyNumber && <span className="mt-1 block text-zinc-500">Unconverted text value.</span>}
          </label>;
        })}</div>
      </fieldset>;
    })}
    {isEncounter && <p className="text-xs text-zinc-400">Record your chosen difficulty and XP here. These fields do not calculate encounter balance or rewards. Link creatures above to add them from your compendium.</p>}
    {category && !isEncounter && <section className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <label htmlFor="article-statblock" className="block text-xs font-semibold text-amber-300">Linked compendium statblock
        <select aria-label="Linked compendium statblock" id="article-statblock" value={metadata[key] || ""} onChange={event => onChange(key, event.target.value)} className={inputClass}>
          <option value="">No linked statblock</option>
          {metadata[key] && !linked && <option value={metadata[key]}>Unavailable saved reference</option>}
          {choices.map(block => <option key={block.id} value={block.id}>{block.name}</option>)}
        </select>
      </label>
      <p className="text-xs text-zinc-400">Choose a matching entry from the compendium for full mechanics. Your article notes remain separate.</p>
      {metadata[key] && !linked && <p className="text-xs text-amber-400">The saved statblock is missing or does not match this template and rules profile.</p>}
      {linked && <details><summary className="cursor-pointer text-xs text-amber-300">Preview linked statblock</summary><div className="mt-3"><StatblockCard block={linked} /></div></details>}
    </section>}
    {other.length > 0 && <details className="rounded-xl border border-zinc-800 p-4 text-xs text-zinc-400"><summary className="cursor-pointer">Other saved details ({other.length})</summary><p className="mt-2">Values from other profiles, templates and older fields are retained. Switch back to edit their active fields.</p><dl className="mt-3 space-y-2">{other.map(item => <div key={item.key}><dt className="font-medium text-zinc-300">{item.label}</dt><dd className="whitespace-pre-wrap break-words">{item.value}</dd></div>)}</dl></details>}
  </div>;
}
