import { PathfinderActionSymbol } from "./PathfinderActionSymbol";
import { Crown, Eye, RotateCcw, Sword, Zap } from "lucide-react";
import { actionCostLabel, isDnd, statText } from "@/lib/rpg";

/** Local vector emblems stay crisp in cards, editor embeds and reader pages. */
export function RulesEmblem({ system }: { system: string }) {
  if (system === "PF_2E") return <svg data-rules-icon="pathfinder-wayfinder" className="rules-emblem" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="20" cy="20" r="12" stroke="currentColor" strokeWidth=".8" />
    <path d="M20 1 24 15 39 20 24 24 20 39 16 24 1 20 16 16Z" fill="currentColor" />
    <path d="m20 10 3 10-3 10-3-10Z" fill="var(--game-emblem-cutout, #173e59)" />
    <path d="M8 8l7 3-4 4ZM32 8l-3 7-4-4ZM32 32l-7-3 4-4ZM8 32l3-7 4 4Z" fill="currentColor" />
  </svg>;
  if (isDnd(system)) return <svg data-rules-icon="dnd-dragon" className="rules-emblem" viewBox="0 0 40 40" fill="none" aria-hidden="true" focusable="false">
    <path d="M26 5 23 1l-1 6-5-3 2 7-5 5-6-5 1 9-6-2 7 8 3-2c-2 8 4 13 11 12 6-1 10-5 9-10-1-5-7-7-10-4-3 2-2 6 1 7-1-3 1-4 3-3 3 2 0 6-4 6-6 0-9-6-6-11l6-6 5 1 7-4-6-1-1-4 5-2-8-1Z" fill="currentColor" />
    <path d="m15 17-2-9 7 5M30 17l5 6-7-2" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    <circle cx="26" cy="10" r="1" fill="var(--game-emblem-cutout, #faf1dc)" />
  </svg>;
  return null;
}

function PathfinderActionIcon({ cost }: { cost: string }) {
  if (cost === "passive") return <Eye data-action-icon="pf-passive" className="rules-action-icon" aria-hidden="true" />;
  return <PathfinderActionSymbol cost={cost} />;
}

export function ActionCostBadge({ system, cost }: { system: string; cost: unknown }) {
  const value = statText(cost);
  if (!value) return null;
  const DndIcon = ({ action: Sword, bonus: Zap, reaction: RotateCcw, legendary: Crown, passive: Eye } as const)[value as "action"];
  return <span className="rules-action-badge rounded bg-amber-900/50 px-2 py-0.5 text-xs text-amber-300">
    {system === "PF_2E" ? <PathfinderActionIcon cost={value} /> : isDnd(system) && DndIcon ? <DndIcon data-action-icon={`dnd-${value}`} className="rules-action-icon" aria-hidden="true" /> : null}
    <span>{actionCostLabel(system, cost)}</span>
  </span>;
}
