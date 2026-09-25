import { Injectable, ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import { CreateStaffDto } from './dto/create-staff.dto.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { assertCanAssignRoles, assertCanManageUser } from '../common/utils/role-policy.js';
import { ORGANIZATION_ADMIN_PERMISSION } from '../common/utils/permission-policy.js';
import { enforcePasswordPolicy } from '../auth/utils/password-policy.js';
import * as bcrypt from 'bcrypt';
import { recordAudit } from '../common/utils/audit.helper.js';

@Injectable()
export class StaffService {
  constructor(private readonly prisma: PrismaService) {}

  private isAdmin(principal: AuthenticatedPrincipal) {
    return principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION);
  }

  /** Loads a staff member the caller is allowed to manage (same org, overlapping branch). */
  private async getManageableUser(id: string, principal: AuthenticatedPrincipal) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { userBranches: true } });
    if (!user || user.organizationId !== principal.organizationId) {
      throw new NotFoundException('User not found');
    }
    if (!this.isAdmin(principal) && !user.userBranches.some((ub) => principal.branchIds.includes(ub.branchId))) {
      throw new NotFoundException('User not found');
    }
    await assertCanManageUser(this.prisma, principal, user.id);
    return user;
  }

  async createStaff(dto: CreateStaffDto, principal: AuthenticatedPrincipal) {
    enforcePasswordPolicy(dto.password);
    // Hash outside the transaction: bcrypt is slow and would hold the transaction open.
    const passwordHash = await bcrypt.hash(dto.password, 12);

    try {
      return await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await assertBranchAccess(tx, principal, dto.branchId);
        const [role] = await assertCanAssignRoles(tx, principal, { names: [dto.roleName] });

        const existing = await tx.user.findFirst({
          where: { organizationId: principal.organizationId, username: dto.username },
        });
        if (existing) throw new ConflictException('USERNAME_TAKEN');

        const user = await tx.user.create({
          data: {
            organizationId: principal.organizationId,
            username: dto.username,
            passwordHash,
            isActive: true,
            // The manager chose this password, so the employee must replace it on first login.
            forcePasswordChange: true,
          },
        });

        await tx.employee.create({
          data: { userId: user.id, firstName: dto.firstName, lastName: dto.lastName, role: role.name },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id } });
        await tx.userBranch.create({ data: { userId: user.id, branchId: dto.branchId } });
        const stationIds = await this.validStations(tx, dto.branchId, dto.stationIds ?? []);
        for (const stationId of stationIds) {
          await tx.userStation.create({ data: { userId: user.id, stationId } });
        }

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'STAFF_CREATED',
          entityType: 'User',
          entityId: user.id,
          afterState: { username: user.username, role: role.name, branchId: dto.branchId },
        });

        return {
          id: user.id,
          username: user.username,
          displayName: `${dto.firstName} ${dto.lastName}`.trim(),
          roleName: role.name,
          branchId: dto.branchId,
          isActive: true,
          createdAt: user.createdAt.toISOString(),
        };
      });
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('USERNAME_TAKEN');
      }
      throw e;
    }
  }

  async getStaff(principal: AuthenticatedPrincipal) {
    const users = await this.prisma.user.findMany({
      where: {
        organizationId: principal.organizationId,
        // Managers only see staff in their own branches.
        ...(this.isAdmin(principal) ? {} : { userBranches: { some: { branchId: { in: principal.branchIds } } } }),
      },
      include: {
        userRoles: { include: { role: true } },
        userBranches: true,
        employee: true,
        stations: { include: { station: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      username: u.username,
      displayName: u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.username,
      roleName: u.userRoles[0]?.role?.name || null,
      branchId: u.userBranches[0]?.branchId || null,
      isActive: u.isActive,
      hasPin: !!u.pinHash,
      stations: u.stations.map((us) => ({ id: us.station.id, name: us.station.name })),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  private async validStations(tx: Prisma.TransactionClient, branchId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const found = await tx.kitchenStation.findMany({ where: { id: { in: unique }, branchId, isActive: true } });
    if (found.length !== unique.length) throw new BadRequestException('Unknown station for this branch');
    return unique;
  }

  /** Changes which prep stations someone works at (their kitchen screen follows). */
  async setStations(id: string, stationIds: string[], principal: AuthenticatedPrincipal) {
    const user = await this.getManageableUser(id, principal);
    const branchId = user.userBranches[0]?.branchId;
    if (!branchId) throw new BadRequestException('This person has no branch');
    await this.prisma.$transaction(async (tx) => {
      const valid = await this.validStations(tx, branchId, stationIds);
      await tx.userStation.deleteMany({ where: { userId: id } });
      for (const stationId of valid) await tx.userStation.create({ data: { userId: id, stationId } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'STAFF_STATIONS_SET',
        entityType: 'User',
        entityId: id,
        afterState: { stationIds: valid },
      });
    });
    return { success: true };
  }

  async deactivateStaff(id: string, principal: AuthenticatedPrincipal) {
    if (id === principal.userId) {
      throw new BadRequestException('CANNOT_DEACTIVATE_SELF');
    }
    const user = await this.getManageableUser(id, principal);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false } });
      // Deactivation must end every live session immediately, not at token expiry.
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'STAFF_DEACTIVATED',
        entityType: 'User',
        entityId: id,
        afterState: { username: user.username },
      });
    });
    return { success: true };
  }

  async reactivateStaff(id: string, principal: AuthenticatedPrincipal) {
    const user = await this.getManageableUser(id, principal);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: true, failedLoginCount: 0, lockedUntil: null } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'STAFF_REACTIVATED',
        entityType: 'User',
        entityId: id,
        afterState: { username: user.username },
      });
    });
    return { success: true };
  }
}
