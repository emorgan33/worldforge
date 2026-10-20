export interface FoundryMetadata {
  system: string;
  systemVersion: string;
  foundryVersion: string;
  remaster: boolean;
  namespace: string;
}

export interface FoundryCandidate {
  id: string;
  name: string;
  type: string;
  source: string;
  sourceIdentity: string;
  sourceHash: string;
  sourceDocument: unknown;
  systemVersion: string;
  foundryVersion: string;
  supported: boolean;
  warnings: string[];
  category: string;
  stats: Record<string, unknown>;
  level?: string;
  rarity?: string;
}
