import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';
import type { AuthenticatedPrincipal } from '../../auth/interfaces/authenticated-request.interface.js';

export type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export async function assertBranchAccess(
  prisma: PrismaExecutor,
  principal: AuthenticatedPrincipal,
  branchId: string
) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: principal.organizationId }
  });
  
  if (!branch) {
    throw new NotFoundException('Branch not found in organization');
  }
  
  if (!principal.permissions.includes('org.admin') && !principal.branchIds.includes(branchId)) {
    throw new ForbiddenException('Branch access denied');
  }
  
  return branch;
}
