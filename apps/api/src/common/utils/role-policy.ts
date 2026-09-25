import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuthenticatedPrincipal } from '../../auth/interfaces/authenticated-request.interface.js';
import { ORGANIZATION_ADMIN_PERMISSION } from './permission-policy.js';

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

/**
 * The single rule for handing out roles: you may only grant permissions you already hold,
 * and only an org admin may grant org.admin. Used by every endpoint that assigns roles, so
 * a manager can never create (or promote) an account more powerful than themselves.
 */
export async function assertCanAssignRoles(
  prisma: PrismaExecutor,
  principal: AuthenticatedPrincipal,
  where: { ids?: string[]; names?: string[] },
) {
  const roles = await prisma.role.findMany({
    where: {
      organizationId: principal.organizationId,
      ...(where.ids ? { id: { in: where.ids } } : {}),
      ...(where.names ? { name: { in: where.names } } : {}),
    },
    include: { rolePermissions: { include: { permission: true } } },
  });

  const expected = (where.ids ?? where.names ?? []).length;
  if (roles.length !== expected) {
    throw new NotFoundException('ROLE_NOT_FOUND');
  }

  const isAdmin = principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION);
  for (const role of roles) {
    const codes = role.rolePermissions.map((rp) => rp.permission.code);
    if (!isAdmin && codes.includes(ORGANIZATION_ADMIN_PERMISSION)) {
      throw new ForbiddenException('Only an organization administrator may assign org.admin');
    }
    if (!isAdmin && codes.some((code) => !principal.permissions.includes(code))) {
      throw new ForbiddenException('Cannot assign roles containing permissions you lack');
    }
  }
  return roles;
}

/**
 * You may only manage (disable, reset password, sign out) someone who holds no permission you
 * lack. Without this, a manager could reset the owner's password and log in as them.
 */
export async function assertCanManageUser(prisma: PrismaExecutor, principal: AuthenticatedPrincipal, targetUserId: string) {
  if (principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION)) return;
  const roles = await prisma.userRole.findMany({
    where: { userId: targetUserId },
    include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
  });
  const theirs = roles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code));
  if (theirs.some((code) => !principal.permissions.includes(code))) {
    throw new ForbiddenException('You can’t manage someone with more access than you');
  }
}
