// Small shared navigation-guard interface for dirty/busy world-scoped forms.
// Mounted forms register/unregister through their parent workspace; evaluation
// stays pure so prompt and blocking behavior is unit-testable.

export type GuardRegistration = { dirty: boolean; busy: boolean } | null;
export type GuardRegistry = ReadonlyMap<string, { dirty: boolean; busy: boolean }>;

const LABELS: Record<string, string> = {
  article: "article editor",
  settings: "world settings",
  compendium: "compendium entry",
  variable: "variable value",
  map: "map pin",
  session: "session",
  asset: "image library upload",
  foundry: "Foundry import",
};

export function guardLabel(id: string): string {
  return LABELS[id.split(":")[0]] ?? id.split(":")[0];
}

/** Immutable registration update; returns the SAME map when nothing changes
 * so re-reporting an identical value never triggers a render loop. */
export function applyRegistration(registry: GuardRegistry, id: string, registration: GuardRegistration): GuardRegistry {
  const existing = registry.get(id);
  if (registration === null) {
    if (!registry.has(id)) return registry;
    const next = new Map(registry);
    next.delete(id);
    return next;
  }
  if (existing && existing.dirty === registration.dirty && existing.busy === registration.busy) return registry;
  const next = new Map(registry);
  next.set(id, { dirty: registration.dirty, busy: registration.busy });
  return next;
}

export type TransitionDecision =
  | { blocked: "busy"; reason: string }
  | { blocked: "dirty"; message: string }
  | { blocked: false };

/** Decide whether a world transition (switch, history traversal, create-and-open)
 * may proceed. Busy always blocks silently. Dirty asks for explicit discard
 * confirmation; callers must only clear dirty state after a successful commit. */
export function evaluateTransition(input: {
  registry: GuardRegistry;
  busyLabels: readonly string[];
  editorDirty: boolean;
}): TransitionDecision {
  for (const [id, registration] of input.registry) {
    if (registration.busy) return { blocked: "busy", reason: guardLabel(id) };
  }
  if (input.busyLabels.length) return { blocked: "busy", reason: input.busyLabels[0] };
  const dirty: string[] = [];
  if (input.editorDirty) dirty.push(guardLabel("article"));
  for (const [id, registration] of input.registry) {
    if (registration.dirty) dirty.push(guardLabel(id));
  }
  if (!dirty.length) return { blocked: false };
  const unique = [...new Set(dirty)];
  const list = unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]}`;
  return {
    blocked: "dirty",
    message: `Discard unsaved changes in ${list}? A local recovery draft remains available where browser storage works.`,
  };
}
