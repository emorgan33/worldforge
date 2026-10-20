import { getArticleTemplate } from "@/lib/templates";
import { articleFacts, articleBlockCategory, articleStatblock, articleStatblockKey } from "@/lib/article-template-content";
import { systemProfile, type RpgBlockItem } from "@/lib/rpg";
import type { ArticleTemplateType } from "@/types";
import { StatblockCard } from "@/components/blocks/StatblockCard";

export function ArticleQuickFacts({ template, system, metadata, blocks }: { template: ArticleTemplateType; system: string; metadata: Record<string, unknown>; blocks: RpgBlockItem[] }) {
  const definition = getArticleTemplate(template, system);
  const { groups, other } = articleFacts(definition, metadata);
  const linked = articleStatblock(template, system, metadata, blocks);
  const missing = articleBlockCategory(template) && metadata[articleStatblockKey(system)] && !linked;
  return <section aria-label="Article quick facts" className="space-y-4">
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/80 p-4">
      <h3 className="text-sm font-bold text-amber-300">{definition.label} details</h3>
      <p className="mt-1 text-xs text-zinc-400">{systemProfile(system).short}{system === "PF_2E" ? " · Remaster" : ""}</p>
      {groups.map(group => <section key={group.name} className="mt-4"><h4 className="mb-2 text-xs font-semibold text-amber-200">{group.name}</h4><dl className="space-y-3 text-xs">{group.fields.map(item => <div key={item.key}><dt className="text-zinc-400">{item.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{item.value}</dd></div>)}</dl></section>)}
      {!groups.length && <p className="mt-3 text-xs text-zinc-500">No structured details added yet.</p>}
      {other.length > 0 && <details className="mt-4 text-xs text-zinc-400"><summary className="cursor-pointer">Other saved details ({other.length})</summary><dl className="mt-3 space-y-3">{other.map(item => <div key={item.key}><dt>{item.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words text-zinc-200">{item.value}</dd></div>)}</dl></details>}
    </div>
    {linked && <StatblockCard block={linked} />}
    {!!missing && <p className="rounded-lg border border-amber-700/50 p-3 text-xs text-amber-300">Linked statblock unavailable for this template and rules profile.</p>}
  </section>;
}
