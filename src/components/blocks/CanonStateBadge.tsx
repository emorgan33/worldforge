import { GitPullRequest } from "lucide-react";

interface CanonStateBadgeProps {
  state: string;
  size?: "sm" | "md";
}

const canonConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
  GM_DRAFT: {
    label: "GM Draft",
    bg: "bg-zinc-500/10",
    text: "text-zinc-400",
    border: "border-zinc-500/20",
  },
  RUMOR: {
    label: "Rumor",
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
  ESTABLISHED: {
    label: "Established",
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  SUPERSEDED: {
    label: "Superseded",
    bg: "bg-red-500/10",
    text: "text-red-400 line-through",
    border: "border-red-500/20",
  },
};

export function CanonStateBadge({ state, size = "sm" }: CanonStateBadgeProps) {
  const config = canonConfig[state] ?? canonConfig.GM_DRAFT;
  const sizeClass = size === "sm" ? "text-[10px]" : "text-xs";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${config.bg} ${config.text} ${config.border} ${sizeClass}`}
    >
      <GitPullRequest className={size === "sm" ? "w-3 h-3" : "w-3.5 h-3.5"} />
      <span>{config.label}</span>
    </span>
  );
}