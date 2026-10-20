import { BookOpen, Dices, Shield } from "lucide-react";

interface RulesProfileBadgeProps {
  system: string;
  size?: "sm" | "md";
}

export function RulesProfileBadge({ system, size = "sm" }: RulesProfileBadgeProps) {
  const sizeClass = size === "sm" ? "text-[10px]" : "text-xs";

  if (system === "DND_5E") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-red-800/50 bg-red-900/20 px-2 py-0.5 font-medium text-red-300 ${sizeClass}`}
      >
        <Dices className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        <span>D&D 5e (2014)</span>
      </span>
    );
  }

  if (system === "PF_2E") {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border border-amber-800/50 bg-amber-900/20 px-2 py-0.5 font-medium text-amber-300 ${sizeClass}`}
      >
        <Shield className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
        <span>PF 2e Remaster</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border border-zinc-700/50 bg-zinc-800/40 px-2 py-0.5 font-medium text-zinc-300 ${sizeClass}`}
    >
      <BookOpen className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      <span>{system}</span>
    </span>
  );
}