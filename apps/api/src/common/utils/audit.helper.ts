import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

type AuditValue = string | number | boolean | null | AuditValue[] | { [key: string]: AuditValue };
export type AuditState = Record<string, AuditValue>;

export async function recordAudit(
  tx: PrismaExecutor,
  data: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    beforeState?: AuditState;
    afterState?: AuditState;
    reason?: string;
  }
) {
  const after: AuditState = data.afterState ? { ...data.afterState } : {};
  if (data.reason) {
    after.reason = data.reason;
  }
  
  await tx.auditLog.create({
    data: {
      actorId: data.actorId,
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      beforeState: data.beforeState ? data.beforeState : Prisma.JsonNull,
      afterState: Object.keys(after).length > 0 ? after : Prisma.JsonNull,
    }
  });
}
