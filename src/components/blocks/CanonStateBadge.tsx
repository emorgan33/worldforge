import { GitPullRequest } from "lucide-react";

interface CanonStateBadgeProps {
  state: string;
  size?: "sm" | "md";
}

const canonConfig: Record<string, { label: string; bg: string; text: string; border: string }> = {
  GM_DRAFT: {
    label: "GM Draft",
    bg: "bg-app-tint/10",
    text: "text-app-muted",
    border: "border-app-border-emphasis-strong/20",
  },
  RUMOR: {
    label: "Rumor",
    bg: "bg-primary-500/10",
    text: "text-primary-400",
    border: "border-primary-500/20",
  },
  ESTABLISHED: {
    label: "Established",
    bg: "bg-success-500/10",
    text: "text-success-400",
    border: "border-success-500/20",
  },
  SUPERSEDED: {
    label: "Superseded",
    bg: "bg-danger-500/10",
    text: "text-danger-400 line-through",
    border: "border-danger-500/20",
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