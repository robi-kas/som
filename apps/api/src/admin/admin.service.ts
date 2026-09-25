import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { EventsService } from '../events/events.service.js';
import { UpdateBranchSettingsDto, PurgeAuditDto } from './admin.dto.js';
import * as bcrypt from 'bcrypt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /**
   * Activity log: who did what, when. Filterable by person, action and date.
   * Audit rows are append-only; nothing in the API updates or deletes them.
   */
  async listAudit(
    principal: AuthenticatedPrincipal,
    q: { actorId?: string; action?: string; entityId?: string; before?: string; limit?: number },
  ) {
    requirePermission(principal, 'report.view');
    const where: Prisma.AuditLogWhereInput = {
      actor: {
        organizationId: principal.organizationId,
        ...(principal.permissions.includes('org.admin')
          ? {}
          : { userBranches: { some: { branchId: { in: principal.branchIds } } } }),
      },
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.action ? { action: { contains: q.action.toUpperCase() } } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.before ? { timestamp: { lt: new Date(q.before) } } : {}),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      include: { actor: { include: { employee: true } } },
      orderBy: { timestamp: 'desc' },
      take: Math.min(Math.max(q.limit ?? 100, 1), 300),
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.timestamp.toISOString(),
      actorId: r.actorId,
      actorName: r.actor.employee ? `${r.actor.employee.firstName} ${r.actor.employee.lastName}`.trim() : r.actor.username,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.beforeState,
      after: r.afterState,
    }));
  }

  /**
   * Owner-only clean-up of old activity log entries. Deliberately no single-entry delete: a log
   * where anyone can erase their own line can't show who did what. The clean-up itself is logged.
   */
  async purgeAudit(dto: PurgeAuditDto, principal: AuthenticatedPrincipal) {
    if (!principal.permissions.includes('org.admin')) throw new ForbiddenException('Only the owner can clear the activity log');
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await bcrypt.compare(dto.password, me.passwordHash))) throw new UnauthorizedException('Password is wrong');
    const before = new Date(Date.now() - dto.olderThanDays * 24 * 3600_000);
    const { count } = await this.prisma.auditLog.deleteMany({
      where: { timestamp: { lt: before }, actor: { organizationId: principal.organizationId } },
    });
    await recordAudit(this.prisma, {
      actorId: principal.userId,
      action: 'ACTIVITY_LOG_CLEARED',
      entityType: 'Organization',
      entityId: principal.organizationId,
      afterState: { olderThanDays: dto.olderThanDays, removed: count },
    });
    return { removed: count };
  }

  async getBranchSettings(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'report.view');
    const branch = await assertBranchAccess(this.prisma, principal, branchId);
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.organizationId } });
    const c = await this.prisma.branchConfiguration.findUnique({ where: { branchId } });
    if (!c) throw new BadRequestException('Branch configuration missing — run the seed');
    return {
      branchId,
      cafeName: org.name,
      logoUrl: org.logoReference,
      branchName: branch.name,
      currency: c.currency,
      taxRate: c.taxRate.toString(),
      isTaxInclusive: c.isTaxInclusive,
      serviceChargeRate: c.serviceChargeRate.toString(),
      roundingMode: c.roundingMode,
      varianceTolerance: c.varianceTolerance.toString(),
      largeDiscountPercent: c.largeDiscountPercent.toString(),
      cashierRefundLimit: c.cashierRefundLimit.toString(),
      ticketWarnMinutes: c.ticketWarnMinutes,
      ticketLateMinutes: c.ticketLateMinutes,
      tinNumber: c.tinNumber,
      receiptFooter: c.receiptFooter,
      verifyBySecondPerson: c.verifyBySecondPerson,
      waiterPayments: c.waiterPayments,
      waiterPhotoRequired: c.waiterPhotoRequired,
    };
  }

  /** Tax / service changes apply to orders opened from now on (open orders keep their snapshot). */
  async updateBranchSettings(branchId: string, dto: UpdateBranchSettingsDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'settings.manage');
    await assertBranchAccess(this.prisma, principal, branchId);
    const before = await this.getBranchSettings(branchId, principal);
    if (dto.ticketWarnMinutes && dto.ticketLateMinutes && dto.ticketWarnMinutes >= dto.ticketLateMinutes) {
      throw new BadRequestException('"Late" must be more minutes than "warn"');
    }
    const { branchName, cafeName, ...config } = dto;
    await this.prisma.$transaction(async (tx) => {
      if (branchName) await tx.branch.update({ where: { id: branchId }, data: { name: branchName } });
      if (cafeName?.trim()) await tx.organization.update({ where: { id: principal.organizationId }, data: { name: cafeName.trim() } });
      await tx.branchConfiguration.update({ where: { branchId }, data: config });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'BRANCH_SETTINGS_UPDATED',
        entityType: 'Branch',
        entityId: branchId,
        beforeState: before as unknown as Record<string, string | number | boolean | null>,
        afterState: dto as unknown as Record<string, string | number | boolean | null>,
      });
    });
    return this.getBranchSettings(branchId, principal);
  }
}
