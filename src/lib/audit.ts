import { prisma } from "@/lib/prisma";
import type { CurrentUser } from "@/lib/auth";

type AuditInput = {
  actor: CurrentUser;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  details?: Record<string, unknown>;
  request?: Request;
};

/** Persist a business event without storing passwords, tokens, secrets or full card/bank data. */
export async function writeAuditLog(input: AuditInput) {
  const action = input.action.trim().slice(0, 60);
  const entityType = input.entityType.trim().slice(0, 60);
  const summary = input.summary.trim().slice(0, 240);
  const forwarded = input.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || input.request?.headers.get("x-real-ip") || null;
  const details = input.details ? JSON.stringify(input.details).slice(0, 4000) : null;
  try {
    return await prisma.auditLog.create({
      data: {
        actorUserId: input.actor.id, actorName: input.actor.name, actorRole: input.actor.role,
        action, entityType, entityId: input.entityId || null, summary, details,
        ipAddress: ip?.slice(0, 64) || null,
      },
    });
  } catch (error) {
    // Never report a completed business mutation as failed just because its audit write failed.
    // Keep the failure visible in the server log for operational monitoring.
    console.error("Audit log write failed", error);
    return null;
  }
}
