import { Injectable, NotFoundException, ForbiddenException, ConflictException, Logger } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { enforcePasswordPolicy } from '../auth/utils/password-policy.js';
import { assertCanManageUser } from '../common/utils/role-policy.js';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  private isOrgAdmin(reqUser: AuthenticatedPrincipal): boolean {
    return reqUser.permissions.includes('org.admin');
  }

  private async getTargetUser(id: string, reqUser: AuthenticatedPrincipal) {
    const isAdmin = this.isOrgAdmin(reqUser);
    const target = await this.prisma.user.findUnique({
      where: { id },
      include: { userBranches: true }
    });

    if (!target || target.organizationId !== reqUser.organizationId) {
      throw new NotFoundException('User not found');
    }

    if (!isAdmin) {
      if (!reqUser.branchIds || reqUser.branchIds.length === 0) {
        throw new NotFoundException('User not found');
      }
      const hasOverlap = target.userBranches.some(ub => reqUser.branchIds.includes(ub.branchId));
      if (!hasOverlap) {
        throw new NotFoundException('User not found');
      }
    }
    await assertCanManageUser(this.prisma, reqUser, target.id);
    return target;
  }

  async createUser(dto: CreateUserDto, reqUser: AuthenticatedPrincipal) {
    enforcePasswordPolicy(dto.password);

    const isAdmin = this.isOrgAdmin(reqUser);

    const requestedBranchIds = [...new Set(dto.branchIds)];
    const branches = await this.prisma.branch.findMany({
      where: { organizationId: reqUser.organizationId, id: { in: requestedBranchIds } }
    });
    
    if (branches.length !== requestedBranchIds.length) {
      throw new ForbiddenException('Invalid branches within organization');
    }

    if (!isAdmin) {
      const inaccessibleBranch = requestedBranchIds.some(bid => !reqUser.branchIds.includes(bid));
      if (inaccessibleBranch) {
        throw new ForbiddenException('Cannot assign branches you do not administer');
      }
    }

    const requestedRoleIds = [...new Set(dto.roleIds)];
    const roles = await this.prisma.role.findMany({
      where: { organizationId: reqUser.organizationId, id: { in: requestedRoleIds } },
      include: { rolePermissions: { include: { permission: true } } }
    });

    if (roles.length !== requestedRoleIds.length) {
      throw new ForbiddenException('Invalid roles within organization');
    }
    
    const roleContainsOrgAdmin = roles.some((role) =>
      role.rolePermissions.some((rp) => rp.permission.code === 'org.admin')
    );

    if (roleContainsOrgAdmin && !isAdmin) {
      throw new ForbiddenException('Only an organization administrator may assign org.admin');
    }

    if (!isAdmin) {
      for (const role of roles) {
        const requiredPerms = role.rolePermissions.map(rp => rp.permission.code);
        const missingPerm = requiredPerms.some(p => !reqUser.permissions.includes(p));
        if (missingPerm) {
          throw new ForbiddenException('Cannot assign roles containing permissions you lack');
        }
      }
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            username: dto.username,
            passwordHash,
            organizationId: reqUser.organizationId,
            isActive: true,
            userBranches: { create: requestedBranchIds.map(id => ({ branchId: id })) },
            userRoles: { create: requestedRoleIds.map(id => ({ roleId: id })) }
          }
        });
        await tx.auditLog.create({
          data: {
            actorId: reqUser.userId,
            action: 'CREATE_USER',
            entityType: 'USER',
            entityId: user.id,
            afterState: { branchIds: requestedBranchIds, roleIds: requestedRoleIds }
          }
        });
        return user;
      });
      return { id: result.id, username: result.username, isActive: result.isActive };
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = (error.meta?.target as string[]) || [];
        if (target.includes('organizationId') || target.includes('username')) {
          throw new ConflictException('Username already exists in this organization');
        }
      }
      throw error;
    }
  }

  async disableUser(id: string, reqUser: AuthenticatedPrincipal) {
    if (id === reqUser.userId) throw new ForbiddenException('Cannot disable your own account');
    await this.getTargetUser(id, reqUser);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorId: reqUser.userId, action: 'DISABLE_USER', entityType: 'USER', entityId: id }
      });
    });
  }

  async enableUser(id: string, reqUser: AuthenticatedPrincipal) {
    await this.getTargetUser(id, reqUser);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: true } });
      await tx.auditLog.create({
        data: { actorId: reqUser.userId, action: 'ENABLE_USER', entityType: 'USER', entityId: id }
      });
    });
  }

  async resetPassword(id: string, newPassword: string, reqUser: AuthenticatedPrincipal) {
    enforcePasswordPolicy(newPassword);
    await this.getTargetUser(id, reqUser);
    const passwordHash = await bcrypt.hash(newPassword, 10);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ 
        where: { id }, 
        data: { passwordHash, passwordChangedAt: new Date(), forcePasswordChange: true, failedLoginCount: 0, lockedUntil: null } 
      });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorId: reqUser.userId, action: 'RESET_PASSWORD', entityType: 'USER', entityId: id }
      });
    });
  }

  async revokeSessions(id: string, reqUser: AuthenticatedPrincipal) {
    await this.getTargetUser(id, reqUser);

    await this.prisma.$transaction(async (tx) => {
      const res = await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      if (res.count > 0) {
        await tx.auditLog.create({
          data: { actorId: reqUser.userId, action: 'REVOKE_SESSIONS', entityType: 'USER', entityId: id }
        });
      }
    });
  }
}
