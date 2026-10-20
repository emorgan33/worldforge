import { VariableCollectionItem } from "@/types";

/**
 * Replaces [prefix:key] macros in content with interactive pills or rendered values
 */
export function interpolateVariables(
  content: string,
  collections: VariableCollectionItem[]
): string {
  if (!content) return "";

  // Regex matches [prefix:key]
  const pattern = /\[([a-zA-Z0-9_-]{2,10}):([a-zA-Z0-9_-]+)\]/g;

  return content.replace(pattern, (match, prefix, key) => {
    const col = collections.find((c) => c.prefix.toLowerCase() === prefix.toLowerCase());
    if (!col) return match;

    const variable = col.variables.find((v) => v.key.toLowerCase() === key.toLowerCase());
    if (!variable) return match;

    switch (variable.type) {
      case "TERM_SIMPLE":
        return `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20 cursor-help" title="${variable.description || variable.value}">${variable.title || variable.value}</span>`;

      case "TERM_ADVANCED":
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30 cursor-pointer shadow-sm hover:bg-indigo-500/25 transition-all" title="${variable.value}">${variable.title || variable.key}: ${variable.value}</span>`;

      case "RENDERED_FRAGMENT":
        return variable.value;

      case "LINK":
        return `<a href="${variable.value}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:text-sky-300 underline underline-offset-2">${variable.title || variable.value}</a>`;

      case "NUMBER":
        return `<span class="font-mono text-emerald-400 font-semibold">${variable.value}</span>`;

      default:
        return variable.value;
    }
  });
}
