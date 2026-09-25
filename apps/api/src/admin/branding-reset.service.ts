import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission, ORGANIZATION_ADMIN_PERMISSION } from '../common/utils/permission-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { EventsService } from '../events/events.service.js';
import { BRANDING_UPLOAD_DIR } from '../uploads/uploads.controller.js';
import { ResetDataDto } from './admin.dto.js';

const LOGO_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };

/**
 * Whether the "reset data" button works on this install.
 * On by default in development; OFF in production unless ALLOW_DATA_RESET=true is set on
 * purpose — once real money is in the system, wiping it should never be one click away.
 */
export function dataResetAllowed() {
  if (process.env.ALLOW_DATA_RESET === 'true') return true;
  if (process.env.ALLOW_DATA_RESET === 'false') return false;
  return process.env.NODE_ENV !== 'production';
}

@Injectable()
export class BrandingResetService {
  private readonly logger = new Logger(BrandingResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Branding
  // ---------------------------------------------------------------------------

  /** Public: the sign-in page shows the cafe's name and logo before anyone logs in. */
  async publicBranding(slug: string) {
    const org = await this.prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new NotFoundException();
    return { name: org.name, logoUrl: org.logoReference };
  }

  async uploadLogo(file: Express.Multer.File, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'settings.manage');
    const ext = LOGO_EXT[file.mimetype];
    if (!ext) throw new BadRequestException('Use a PNG (best for printing), JPG or WebP image');
    fs.mkdirSync(BRANDING_UPLOAD_DIR, { recursive: true });
    const filename = `logo-${randomUUID()}.${ext}`;
    fs.writeFileSync(path.join(BRANDING_UPLOAD_DIR, filename), file.buffer);

    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.organizationId } });
    const logoReference = `/api/v1/uploads/branding/${filename}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: org.id }, data: { logoReference } });
      await recordAudit(tx, { actorId: principal.userId, action: 'LOGO_UPDATED', entityType: 'Organization', entityId: org.id });
    });
    this.removeLogoFile(org.logoReference);
    return { logoUrl: logoReference, printable: ext === 'png' };
  }

  async removeLogo(principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'settings.manage');
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.organizationId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: org.id }, data: { logoReference: null } });
      await recordAudit(tx, { actorId: principal.userId, action: 'LOGO_REMOVED', entityType: 'Organization', entityId: org.id });
    });
    this.removeLogoFile(org.logoReference);
    return { success: true };
  }

  private removeLogoFile(ref: string | null) {
    const name = ref?.split('/').pop()?.split('?')[0];
    if (!name || !/^logo-[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(name)) return;
    fs.rm(path.join(BRANDING_UPLOAD_DIR, name), { force: true }, () => undefined);
  }

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  async resetStatus(principal: AuthenticatedPrincipal) {
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: principal.organizationId } });
    return {
      allowed: dataResetAllowed(),
      isOwner: principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION),
      confirmPhrase: `DELETE ${org.name}`,
    };
  }

  /**
   * Wipes data so the cafe can start fresh (typically: clearing test orders before going live).
   *
   * SALES      orders, payments, refunds, receipts, drawer shifts, kitchen tickets, print jobs,
   *            offline-sync records and order numbering. Menu, tables, staff and settings stay.
   * EVERYTHING also the menu, tables, stations, printers, payment methods and every staff
   *            account except the owner doing the reset.
   *
   * Guards: owner only, turned off in production unless deliberately enabled, password
   * re-entry, and the exact phrase "DELETE <cafe name>". Recorded in the activity log.
   */
  async reset(dto: ResetDataDto, principal: AuthenticatedPrincipal) {
    if (!principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION)) {
      throw new ForbiddenException('Only the owner can reset data');
    }
    if (!dataResetAllowed()) {
      throw new ForbiddenException({
        code: 'RESET_DISABLED',
        message: 'Reset is switched off on this live install. Set ALLOW_DATA_RESET=true on the server to allow it.',
      });
    }
    const orgId = principal.organizationId;
    const org = await this.prisma.organization.findUniqueOrThrow({ where: { id: orgId } });
    if (dto.confirmPhrase.trim() !== `DELETE ${org.name}`) {
      throw new BadRequestException({ code: 'CONFIRM_PHRASE_MISMATCH', message: `Type exactly: DELETE ${org.name}` });
    }
    const me = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await bcrypt.compare(dto.password, me.passwordHash))) throw new UnauthorizedException('Password is wrong');

    const branches = await this.prisma.branch.findMany({ where: { organizationId: orgId }, select: { id: true } });
    const branchIds = branches.map((b) => b.id);
    const orgUsers = await this.prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true } });
    const orgUserIds = orgUsers.map((u) => u.id);
    const byOrg = { organizationId: orgId };

    const counts: Record<string, number> = {};
    const run = async (label: string, op: Promise<{ count: number }>) => {
      counts[label] = (await op).count;
    };

    await this.prisma.$transaction(
      async (tx) => {
        // Sales & money — children before parents.
        await run('printJobs', tx.printerJob.deleteMany({ where: { printer: { branchId: { in: branchIds } } } }));
        await run('itemHistory', tx.orderItemStatusHistory.deleteMany({ where: { orderItem: byOrg } }));
        await run('refundItems', tx.refundItem.deleteMany({ where: { refund: byOrg } }));
        await run('refunds', tx.refund.deleteMany({ where: byOrg }));
        await run('receipts', tx.receipt.deleteMany({ where: byOrg }));
        await run('payments', tx.payment.deleteMany({ where: byOrg }));
        await run('paymentEvidence', tx.paymentEvidence.deleteMany({ where: { payments: { none: {} } } }));
        await run('itemAddOns', tx.orderItemModifier.deleteMany({ where: byOrg }));
        await run('orderItems', tx.orderItem.deleteMany({ where: byOrg }));
        await run('kitchenTickets', tx.kitchenTicket.deleteMany({ where: byOrg }));
        await run('voids', tx.voidRecord.deleteMany({ where: byOrg }));
        await run('orders', tx.order.deleteMany({ where: byOrg }));
        await run('approvalRequests', tx.approvalRequest.deleteMany({ where: { requestedById: { in: orgUserIds } } }));
        await run('approvals', tx.approvalGrant.deleteMany({ where: byOrg }));
        await run('idempotencyKeys', tx.idempotencyKey.deleteMany({ where: byOrg }));
        await run('cashCounts', tx.cashCount.deleteMany({ where: { shift: byOrg } }));
        await run('cashMovements', tx.cashMovement.deleteMany({ where: { shift: byOrg } }));
        await run('reconciliations', tx.shiftReconciliation.deleteMany({ where: { shift: byOrg } }));
        await run('drawerShifts', tx.cashierShift.deleteMany({ where: byOrg }));
        await run('syncEvents', tx.syncEvent.deleteMany({ where: byOrg }));
        await run('counters', tx.branchCounter.deleteMany({ where: { branchId: { in: branchIds } } }));
        await tx.table.updateMany({ where: { ...byOrg, status: { not: 'OUT_OF_SERVICE' } }, data: { status: 'AVAILABLE' } });

        if (dto.scope === 'EVERYTHING') {
          await run('addOns', tx.productModifier.deleteMany({ where: byOrg }));
          await run('products', tx.product.deleteMany({ where: byOrg }));
          await run('categories', tx.category.deleteMany({ where: byOrg }));
          await run('printers', tx.printer.deleteMany({ where: { branchId: { in: branchIds } } }));
          await run('printAgents', tx.printAgent.deleteMany({ where: { branchId: { in: branchIds } } }));
          await run('staffStations', tx.userStation.deleteMany({ where: { station: byOrg } }));
          await run('stations', tx.kitchenStation.deleteMany({ where: byOrg }));
          await run('tables', tx.table.deleteMany({ where: byOrg }));
          await run('paymentMethods', tx.paymentMethod.deleteMany({ where: { branchId: { in: branchIds } } }));

          // Every staff account except the owner doing the reset.
          const others = orgUserIds.filter((id) => id !== principal.userId);
          const users = { userId: { in: others } };
          await tx.session.deleteMany({ where: users });
          await tx.userRole.deleteMany({ where: users });
          await tx.userBranch.deleteMany({ where: users });
          await tx.userStation.deleteMany({ where: users });
          await tx.employee.deleteMany({ where: users });
          await tx.approvalGrant.deleteMany({ where: { approverId: { in: others } } });
          await tx.auditLog.deleteMany({ where: { actorId: { in: others } } });
          await run('staff', tx.user.deleteMany({ where: { id: { in: others } } }));
        }

        await recordAudit(tx, {
          actorId: principal.userId,
          action: dto.scope === 'EVERYTHING' ? 'DATA_RESET_EVERYTHING' : 'DATA_RESET_SALES',
          entityType: 'Organization',
          entityId: orgId,
          afterState: counts,
        });
      },
      { timeout: 120_000, maxWait: 10_000 },
    );

    this.logger.warn(`Data reset (${dto.scope}) by ${principal.userId}: ${JSON.stringify(counts)}`);
    for (const branchId of branchIds) {
      for (const type of ['order.updated', 'table.updated', 'menu.updated', 'ticket.updated'] as const) {
        this.events?.emit({ type, organizationId: orgId, branchId });
      }
    }
    return { scope: dto.scope, removed: counts };
  }
}
