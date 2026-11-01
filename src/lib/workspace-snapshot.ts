import { readWorkspaceJson } from "@/lib/workspace-client";
import { fetchWorkspaceArticleList } from "@/lib/workspace-articles";

export type WorldSnapshot = [
  unknown[],
  unknown[],
  unknown[],
  unknown[],
  unknown[],
  unknown[],
  unknown[],
];

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

/** Fetch a world's seven workspace projections without committing partial data. */
export async function fetchWorldSnapshot(worldId: string, signal: AbortSignal): Promise<WorldSnapshot> {
  const responses = await Promise.all([
    fetchWorkspaceArticleList(worldId, { signal }),
    fetch(`/api/variables?worldId=${worldId}`, { signal }).then(response => readWorkspaceJson(response, isArray, "Could not load variables.")),
    fetch(`/api/maps?worldId=${worldId}`, { signal }).then(response => readWorkspaceJson(response, isArray, "Could not load maps.")),
    fetch(`/api/timelines?worldId=${worldId}`, { signal }).then(response => readWorkspaceJson(response, isArray, "Could not load timelines.")),
    fetch(`/api/secrets?worldId=${worldId}`, { signal }).then(response => readWorkspaceJson(response, isArray, "Could not load secrets.")),
    fetch(`/api/statblocks?worldId=${worldId}`, { signal }).then(response => readWorkspaceJson(response, isArray, "Could not load the compendium.")),
    fetch(`/api/worlds/${worldId}/sessions`, { signal }).then(response => readWorkspaceJson(response, isArray, "Could not load sessions.")),
  ]);
  return responses as WorldSnapshot;
}
