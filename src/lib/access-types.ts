import type { Prisma } from "@prisma/client";

/** Distinguish the kind of actor making a request. */
export type ActorKind = "OWNER_GM" | "PLAYER" | "ANONYMOUS" | "PREVIEW";

/** Resolved actor identity for authorization decisions. */
export interface Actor {
  kind: ActorKind;
  userId: string | null; // null for ANONYMOUS
  /** The real user when kind=PREVIEW; same as userId for PLAYER/OWNER_GM */
  realUserId?: string;
  /** The only world a preview session may read. */
  previewWorldId?: string;
}

/** A typed reference to a world-scoped resource. */
export interface ResourceRef {
  worldId: string;
  kind: string; // e.g. "articles", "statblocks", "maps"
  id: string;
}

/** Policy mode for audience access. */
export type AudienceMode = "GM_ONLY" | "PLAYER_SNAPSHOT" | "PUBLIC";

/** Canon/workflow state for articles. */
export type CanonState = "GM_DRAFT" | "RUMOR" | "ESTABLISHED" | "SUPERSEDED";

/** Player role in a world. */
export type MemberRole = "PLAYER";

/** Member status in a world. */
export type MemberStatus = "ACTIVE" | "REVOKED";

/** Session status for campaign sessions. */
export type SessionStatus = "PLANNED" | "PLAYED" | "CANCELLED";

/** Prisma transaction client type for service functions. */
export type Tx = Omit<
  Prisma.TransactionClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;