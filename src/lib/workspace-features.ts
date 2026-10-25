import { isRecord, readWorkspaceJson } from "@/lib/workspace-client";

const isArray = (value: unknown): value is unknown[] => Array.isArray(value);

export async function saveWorkspaceVariable(id: string, value: string, fetcher: typeof fetch = fetch): Promise<void> {
  const response = await fetcher("/api/variables", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, value }),
  });
  await readWorkspaceJson(response, isRecord, "Unable to save this variable. Please try again.");
}

export async function saveWorkspaceMapMutation(
  worldId: string,
  mutation: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<{ result: Record<string, unknown>; maps?: unknown[] }> {
  const method = typeof mutation.action === "string" && mutation.action.startsWith("delete")
    ? "DELETE"
    : typeof mutation.action === "string" && mutation.action.startsWith("create") ? "POST" : "PATCH";
  const response = await fetcher("/api/maps", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ worldId, ...mutation }),
  });
  const result = await readWorkspaceJson(response, isRecord, "Unable to update the map.");
  const refreshed = await fetcher(`/api/maps?worldId=${encodeURIComponent(worldId)}`);
  if (!refreshed.ok) return { result };
  return { result, maps: await readWorkspaceJson(refreshed, isArray, "Unable to refresh maps.") };
}
