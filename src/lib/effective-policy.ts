/**
 * Policy strictness utilities for audience access control.
 *
 * Order (strict → permissive): GM_ONLY > PLAYER_SNAPSHOT > PUBLIC
 */

const POLICY_RANK: Record<string, number> = {
  GM_ONLY: 3,
  PLAYER_SNAPSHOT: 2,
  PUBLIC: 1,
};

/**
 * Returns the strictest policy mode from an array of modes.
 */
export function strictestPolicy(policies: string[]): string {
  let strictest = "PUBLIC";
  let highestRank = 0;
  for (const mode of policies) {
    const rank = policyRank(mode);
    if (rank > highestRank) {
      highestRank = rank;
      strictest = mode;
    }
  }
  return strictest;
}

/**
 * Returns a numeric rank for a policy mode.
 * GM_ONLY=3, PLAYER_SNAPSHOT=2, PUBLIC=1
 */
export function policyRank(mode: string): number {
  return POLICY_RANK[mode] ?? 0;
}

/**
 * Returns true if the target mode is less strict than the current mode,
 * indicating that a downgrade confirmation should be required.
 */
export function requiresConfirmation(currentMode: string, targetMode: string): boolean {
  return policyRank(targetMode) < policyRank(currentMode);
}