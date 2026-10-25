import { prisma } from "./db";
import type { Prisma } from "@prisma/client";

export interface AuditEventInput {
  worldId: string;
  resourceKind?: string;
  resourceId?: string;
  actorId?: string | null;
  action: string;
  beforeJson?: string | null;
  afterJson?: string | null;
  parentEventId?: string | null;
}

/**
 * Append a new audit event. This is the ONLY way to create audit records.
 * There are no update/delete APIs for audit events.
 */
export async function recordAuditEvent(input: AuditEventInput, client: Prisma.TransactionClient | typeof prisma = prisma): Promise<string> {
  const event = await client.accessAuditEvent.create({
    data: {
      worldId: input.worldId,
      resourceKind: input.resourceKind ?? null,
      resourceId: input.resourceId ?? null,
      actorId: input.actorId ?? null,
      action: input.action,
      beforeJson: input.beforeJson ?? null,
      afterJson: input.afterJson ?? null,
      parentEventId: input.parentEventId ?? null,
    },
    select: { id: true },
  });
  return event.id;
}

/**
 * Fetch audit events for a world, newest first.
 */
export async function getAuditEvents(
  worldId: string,
  options?: { cursor?: string; limit?: number }
) {
  const limit = options?.limit ?? 50;
  const where = options?.cursor
    ? { worldId, createdAt: { lt: await getEventCreatedAt(options.cursor) } }
    : { worldId };

  return prisma.accessAuditEvent.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      action: true,
      resourceKind: true,
      resourceId: true,
      actorId: true,
      beforeJson: true,
      afterJson: true,
      parentEventId: true,
      createdAt: true,
    },
  });
}

async function getEventCreatedAt(id: string): Promise<Date> {
  const event = await prisma.accessAuditEvent.findUnique({
    where: { id },
    select: { createdAt: true },
  });
  if (!event) return new Date();
  return event.createdAt;
}
