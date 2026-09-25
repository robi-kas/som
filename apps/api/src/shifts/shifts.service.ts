import { Injectable, ConflictException, NotFoundException, InternalServerErrorException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { OpenShiftDto, CashMovementDto, CloseShiftDto, ApproveVarianceDto } from './dto/shift.dto.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { toShiftResponse, toCashMovementResponse, ShiftResponseDto, CashMovementResponseDto } from '../common/mappers/response.mapper.js';
import { Prisma } from '@prisma/client';
import { lockShiftRow } from '../common/utils/db-locks.js';
import { parseMoney } from '../common/money/pricing.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { authorizeSensitiveAction } from '../common/utils/approval-policy.js';
import { expectedCash, sumMovements } from './cash-math.js';

const D = Prisma.Decimal;
const money = (v: Prisma.Decimal) => v.toFixed(2);

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async openShift(dto: OpenShiftDto, principal: AuthenticatedPrincipal, idempotencyKey?: string): Promise<ShiftResponseDto> {
    requirePermission(principal, 'shift.open');
    await assertBranchAccess(this.prisma, principal, dto.branchId);

    const endpoint = 'POST /shifts/open';

    return await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existingIdemp = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_endpoint_idempotencyKey: {
              organizationId: principal.organizationId,
              endpoint,
              idempotencyKey,
            }
          }
        });
        if (existingIdemp) {
          return existingIdemp.responseBody as unknown as ShiftResponseDto;
        }
      }

      const existingShift = await tx.cashierShift.findFirst({
        where: {
          cashierId: principal.userId,
          branchId: dto.branchId,
          status: 'OPEN'
        }
      });
      if (existingShift) {
        throw new ConflictException('Cashier already has an open shift for this branch');
      }

      const waiting = await tx.cashierShift.findFirst({ where: { cashierId: principal.userId, status: 'CLOSING' } });
      if (waiting) {
        throw new ConflictException({
          code: 'PREVIOUS_SHIFT_UNAPPROVED',
          message: 'Your last drawer didn’t balance and is waiting for a manager to sign it off.',
        });
      }

      const shift = await tx.cashierShift.create({
        data: {
          organizationId: principal.organizationId,
          branchId: dto.branchId,
          cashierId: principal.userId,
          status: 'OPEN',
          openingFloat: parseMoney(dto.openingFloat),
          expectedCash: parseMoney(dto.openingFloat),
        }
      });

      const response = toShiftResponse(shift);

      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseCode: 201,
            responseBody: response as unknown as Prisma.InputJsonValue
          }
        });
      }

      return response;
    });
  }

  async addCashMovement(shiftId: string, dto: CashMovementDto, principal: AuthenticatedPrincipal, idempotencyKey?: string): Promise<CashMovementResponseDto> {
    requirePermission(principal, 'shift.cash_movement');

    const endpoint = `POST /shifts/${shiftId}/cash-movement`;

    return await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existingIdemp = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_endpoint_idempotencyKey: {
              organizationId: principal.organizationId,
              endpoint,
              idempotencyKey,
            }
          }
        });
        if (existingIdemp) {
          return existingIdemp.responseBody as unknown as CashMovementResponseDto;
        }
      }

      await lockShiftRow(tx, shiftId);
      const shift = await tx.cashierShift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.organizationId !== principal.organizationId) throw new NotFoundException('Shift not found');
      await assertBranchAccess(tx, principal, shift.branchId);

      if (shift.status !== 'OPEN') throw new ConflictException('Shift is not open');
      if (shift.cashierId !== principal.userId) throw new ForbiddenException('You do not own this shift');

      // Every Telebirr / bank payment taken on this shift needs its transaction number first.
      const refMethods = await tx.paymentMethod.findMany({ where: { branchId: shift.branchId, requiresReference: true }, select: { code: true } });
      const missingRefs = await tx.payment.count({
        where: {
          receivedById: shift.cashierId,
          createdAt: { gte: shift.openedAt },
          method: { in: refMethods.map((m) => m.code) },
          referenceNumber: null,
          status: { not: 'REJECTED' },
        },
      });
      if (missingRefs > 0) {
        throw new ConflictException({
          code: 'REFERENCES_MISSING',
          count: missingRefs,
          message: `${missingRefs} payment${missingRefs === 1 ? '' : 's'} still need${missingRefs === 1 ? 's' : ''} a transaction number. Fill ${missingRefs === 1 ? 'it' : 'them'} in first.`,
        });
      }

      const movement = await tx.cashMovement.create({
        data: {
          shiftId,
          type: dto.type,
          amount: parseMoney(dto.amount),
          reason: dto.reason,
          userId: principal.userId,
        }
      });

      let expectedCashDelta = parseMoney(dto.amount);
      if (dto.type === 'CASH_WITHDRAWAL') {
        if (shift.expectedCash.lessThan(expectedCashDelta)) {
          throw new ConflictException({ code: 'INSUFFICIENT_DRAWER_CASH', message: 'The drawer does not hold that much cash' });
        }
        expectedCashDelta = expectedCashDelta.negated();
      }

      await tx.cashierShift.update({
        where: { id: shiftId },
        data: {
          expectedCash: { increment: expectedCashDelta },
          version: { increment: 1 }
        }
      });

      const response = toCashMovementResponse(movement);

      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseCode: 201,
            responseBody: response as unknown as Prisma.InputJsonValue
          }
        });
      }

      return response;
    });
  }

  async getCurrentShift(principal: AuthenticatedPrincipal): Promise<ShiftResponseDto> {
    requirePermission(principal, 'shift.view_own');
    const shift = await this.prisma.cashierShift.findFirst({
      where: {
        cashierId: principal.userId,
        organizationId: principal.organizationId,
        branchId: { in: principal.branchIds },
        status: 'OPEN'
      }
    });
    if (!shift) throw new NotFoundException('No active shift found');
    return toShiftResponse(shift);
  }

  /**
   * Blind close: the cashier counts the drawer by denomination; the system computes what
   * should be there. A difference above the branch tolerance needs a manager's sign-off.
   */
  async closeShift(shiftId: string, dto: CloseShiftDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'shift.close');
    const closed = await this.prisma.$transaction(async (tx) => {
      await lockShiftRow(tx, shiftId);
      const shift = await tx.cashierShift.findUnique({ where: { id: shiftId } });
      if (!shift || shift.organizationId !== principal.organizationId) throw new NotFoundException('Shift not found');
      await assertBranchAccess(tx, principal, shift.branchId);

      if (shift.status !== 'OPEN') throw new ConflictException('Shift is not OPEN');
      if (shift.cashierId !== principal.userId) throw new ForbiddenException('You do not own this shift');

      const branchConfig = await tx.branchConfiguration.findUnique({ where: { branchId: shift.branchId } });
      const tolerance = branchConfig?.varianceTolerance ?? new D(0);

      const movements = await tx.cashMovement.findMany({ where: { shiftId } });
      const expected = expectedCash(shift.openingFloat, movements);
      // The reconciliation row keeps four buckets; change for transfers goes into "out" so
      // that float + sales − refunds + in − out = expected.
      const cashSales = sumMovements(movements, 'CASH_SALE');
      const cashRefunds = sumMovements(movements, 'CASH_REFUND');
      const cashDeposits = sumMovements(movements, 'CASH_DEPOSIT').add(sumMovements(movements, 'FLOAT_IN'));
      const cashWithdrawals = sumMovements(movements, 'CASH_WITHDRAWAL').add(sumMovements(movements, 'FLOAT_OUT')).add(sumMovements(movements, 'CHANGE_OUT'));

      let actualCash = new D(0);
      const counts = dto.cashCounts.map((c) => {
        const denomination = parseMoney(c.value);
        if (!Number.isInteger(c.count) || c.count < 0) throw new BadRequestException('Counts must be whole numbers');
        const amount = denomination.mul(c.count);
        actualCash = actualCash.add(amount);
        return { denomination, count: c.count, amount };
      });

      const variance = actualCash.sub(expected);
      const needsApproval = variance.abs().gt(tolerance);

      const updatedShift = await tx.cashierShift.update({
        where: { id: shiftId },
        data: {
          status: needsApproval ? 'CLOSING' : 'CLOSED',
          expectedCash: expected,
          actualCash,
          variance,
          closedAt: new Date(),
          version: { increment: 1 },
        },
      });

      const recon = await tx.shiftReconciliation.create({
        data: {
          shiftId,
          expectedCash: expected,
          actualCash,
          variance,
          openingFloat: shift.openingFloat,
          cashSales,
          cashRefunds,
          cashDeposits,
          cashWithdrawals,
          status: needsApproval ? 'PENDING' : 'APPROVED',
        },
      });

      for (const c of counts) {
        await tx.cashCount.create({ data: { shiftId, denomination: c.denomination, count: c.count, amount: c.amount } });
      }

      await recordAudit(tx, {
        actorId: principal.userId,
        action: needsApproval ? 'SHIFT_CLOSED_WITH_VARIANCE' : 'SHIFT_CLOSED',
        entityType: 'CashierShift',
        entityId: shiftId,
        afterState: { expected: money(expected), actual: money(actualCash), variance: money(variance) },
      });

      return {
        shift: toShiftResponse(updatedShift),
        reconciliation: {
          id: recon.id,
          expectedCash: money(recon.expectedCash),
          actualCash: money(recon.actualCash),
          variance: money(recon.variance),
          status: recon.status,
          openingFloat: money(recon.openingFloat),
          cashSales: money(recon.cashSales),
          cashRefunds: money(recon.cashRefunds),
          cashDeposits: money(recon.cashDeposits),
          cashWithdrawals: money(recon.cashWithdrawals),
        },
      };
    });
    return closed;
  }

  /** Manager signs off a drawer that didn't balance — in person, or with their PIN on the cashier's screen. */
  async approveVariance(shiftId: string, dto: ApproveVarianceDto, principal: AuthenticatedPrincipal, approvalToken?: string) {
    return await this.prisma.$transaction(async (tx) => {
      const shift = await tx.cashierShift.findUnique({ where: { id: shiftId }, include: { reconciliation: true } });
      if (!shift || shift.organizationId !== principal.organizationId) throw new NotFoundException('Shift not found');
      await assertBranchAccess(tx, principal, shift.branchId);

      if (shift.status !== 'CLOSING') throw new ConflictException('Shift is not in CLOSING state');
      if (!shift.reconciliation || shift.reconciliation.status !== 'PENDING') throw new ConflictException('No pending reconciliation found');

      const auth = await authorizeSensitiveAction(tx, principal, 'shift.approve_variance', approvalToken, `shift:${shiftId}:variance`);
      if (auth.approverId === shift.cashierId) {
        throw new ForbiddenException({ code: 'SELF_APPROVAL_FORBIDDEN', message: 'A cashier cannot approve their own drawer' });
      }

      await tx.shiftReconciliation.update({
        where: { id: shift.reconciliation.id },
        data: { status: 'APPROVED', approvedById: auth.approverId, notes: dto.reason },
      });
      const updatedShift = await tx.cashierShift.update({
        where: { id: shiftId },
        data: { status: 'CLOSED', version: { increment: 1 } },
      });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'SHIFT_VARIANCE_APPROVED',
        entityType: 'CashierShift',
        entityId: shiftId,
        reason: dto.reason,
        afterState: { approvedById: auth.approverId, variance: money(shift.reconciliation.variance) },
      });
      return toShiftResponse(updatedShift);
    });
  }

  /**
   * X/Z report for one drawer shift: cash reconciliation plus what was taken by every method,
   * discounts, voids and refunds during the shift. Printable at the end of the day.
   */
  async getShiftReport(shiftId: string, principal: AuthenticatedPrincipal) {
    const shift = await this.prisma.cashierShift.findUnique({
      where: { id: shiftId },
      include: { reconciliation: true, counts: true, movements: true },
    });
    if (!shift || shift.organizationId !== principal.organizationId) throw new NotFoundException('Shift not found');
    await assertBranchAccess(this.prisma, principal, shift.branchId);
    if (shift.cashierId !== principal.userId) requirePermission(principal, 'shift.view_report');

    const until = shift.closedAt ?? new Date();
    const payments = await this.prisma.payment.findMany({
      where: {
        receivedById: shift.cashierId,
        order: { branchId: shift.branchId },
        createdAt: { gte: shift.openedAt, lte: until },
        status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED', 'PENDING_VERIFICATION'] },
      },
    });
    const byMethod = new Map<string, { count: number; total: Prisma.Decimal; pending: Prisma.Decimal }>();
    for (const p of payments) {
      const row = byMethod.get(p.method) ?? { count: 0, total: new D(0), pending: new D(0) };
      row.count += 1;
      if (p.status === 'PENDING_VERIFICATION') row.pending = row.pending.add(p.appliedAmount);
      else row.total = row.total.add(p.appliedAmount);
      byMethod.set(p.method, row);
    }
    const refunds = await this.prisma.refund.findMany({
      where: { branchId: shift.branchId, status: 'CONFIRMED', confirmedAt: { gte: shift.openedAt, lte: until } },
    });
    const cashier = await this.prisma.user.findUnique({ where: { id: shift.cashierId }, include: { employee: true } });
    const methodRows = await this.prisma.paymentMethod.findMany({ where: { branchId: shift.branchId }, select: { code: true, name: true } });
    const names = new Map(methodRows.map((m) => [m.code, m.name]));

    const movementSum = (type: string) => sumMovements(shift.movements, type);
    const expectedNow = expectedCash(shift.openingFloat, shift.movements);

    return {
      kind: shift.status === 'OPEN' ? 'X' : 'Z',
      shift: toShiftResponse(shift),
      cashierName: cashier?.employee ? `${cashier.employee.firstName} ${cashier.employee.lastName}`.trim() : cashier?.username,
      openedAt: shift.openedAt.toISOString(),
      closedAt: shift.closedAt?.toISOString() ?? null,
      payments: [...byMethod.entries()].map(([method, r]) => ({
        method,
        name: names.get(method) ?? method,
        count: r.count,
        total: money(r.total),
        pendingVerification: money(r.pending),
      })),
      totalTaken: money([...byMethod.values()].reduce((a, r) => a.add(r.total), new D(0))),
      refunds: { count: refunds.length, total: money(refunds.reduce((a, r) => a.add(r.amount), new D(0))) },
      cash: {
        openingFloat: money(shift.openingFloat),
        sales: money(movementSum('CASH_SALE')),
        refunds: money(movementSum('CASH_REFUND')),
        deposits: money(movementSum('CASH_DEPOSIT')),
        withdrawals: money(movementSum('CASH_WITHDRAWAL')),
        changeForTransfers: money(movementSum('CHANGE_OUT')),
        expected: money(shift.reconciliation?.expectedCash ?? expectedNow),
        counted: shift.reconciliation ? money(shift.reconciliation.actualCash) : null,
        variance: shift.reconciliation ? money(shift.reconciliation.variance) : null,
      },
      reconciliation: shift.reconciliation
        ? {
            id: shift.reconciliation.id,
            status: shift.reconciliation.status,
            approvedById: shift.reconciliation.approvedById,
            notes: shift.reconciliation.notes,
            createdAt: shift.reconciliation.createdAt,
          }
        : null,
      cashCounts: shift.counts.map((cc) => ({ denomination: money(cc.denomination), count: cc.count, amount: money(cc.amount) })),
    };
  }

  /** Shifts waiting for a manager because the drawer didn't balance. */
  async listPendingVariances(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'shift.approve_variance');
    await assertBranchAccess(this.prisma, principal, branchId);
    const shifts = await this.prisma.cashierShift.findMany({
      where: { organizationId: principal.organizationId, branchId, status: 'CLOSING' },
      include: { reconciliation: true },
      orderBy: { closedAt: 'asc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: shifts.map((s) => s.cashierId) } },
      include: { employee: true },
    });
    return shifts.map((s) => {
      const u = users.find((x) => x.id === s.cashierId);
      return {
        id: s.id,
        cashierName: u?.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u?.username,
        closedAt: s.closedAt?.toISOString() ?? null,
        expected: s.reconciliation ? money(s.reconciliation.expectedCash) : null,
        counted: s.reconciliation ? money(s.reconciliation.actualCash) : null,
        variance: s.reconciliation ? money(s.reconciliation.variance) : null,
      };
    });
  }
}
