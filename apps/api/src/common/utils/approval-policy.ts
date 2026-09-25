import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import type { AuthenticatedPrincipal } from '../../auth/interfaces/authenticated-request.interface.js';
import { ORGANIZATION_ADMIN_PERMISSION } from './permission-policy.js';

export function hasPermission(principal: AuthenticatedPrincipal, permission: string) {
  return principal.permissions.includes(permission) || principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION);
}

export function hashApprovalToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Authorizes a sensitive action.
 *
 * - If the caller holds `permission`, they approve it themselves.
 * - Otherwise they must present an approval token that a manager created with their PIN
 *   (POST /approvals) for this exact permission, for this caller, within the last few minutes.
 *   The token is single-use: it is burned here inside the same transaction as the action.
 *
 * Returns the approver's user id so the audit log can record both people.
 */
export async function authorizeSensitiveAction(
  tx: Prisma.TransactionClient,
  principal: AuthenticatedPrincipal,
  permission: string,
  approvalToken: string | undefined,
  usedFor: string,
): Promise<{ approverId: string; viaPin: boolean }> {
  if (hasPermission(principal, permission)) {
    return { approverId: principal.userId, viaPin: false };
  }
  if (!approvalToken) {
    throw new ForbiddenException({ code: 'APPROVAL_REQUIRED', permission, message: 'Manager approval required' });
  }

  const now = new Date();
  const burned = await tx.approvalGrant.updateMany({
    where: {
      tokenHash: hashApprovalToken(approvalToken),
      organizationId: principal.organizationId,
      requestedById: principal.userId,
      permission,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now, usedFor },
  });
  if (burned.count !== 1) {
    throw new ForbiddenException({ code: 'APPROVAL_INVALID', permission, message: 'Approval expired or already used' });
  }

  const grant = await tx.approvalGrant.findUniqueOrThrow({ where: { tokenHash: hashApprovalToken(approvalToken) } });
  return { approverId: grant.approverId, viaPin: true };
}
