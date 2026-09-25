import { describe, it, expect, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { ShiftsService } from './shifts.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

const D = (v: number | string) => new Prisma.Decimal(v);

const shift = (over: Record<string, unknown> = {}) => ({
  id: 's1',
  organizationId: 'org1',
  branchId: 'b1',
  cashierId: 'cashier',
  status: 'OPEN',
  openingFloat: D(500),
  expectedCash: D(1500),
  actualCash: null,
  variance: null,
  openedAt: new Date(Date.now() - 8 * 3600_000),
  closedAt: null,
  version: 1,
  ...over,
});

describe('ShiftsService (Unit)', () => {
  let prisma: PrismaMock;
  let service: ShiftsService;
  const cashier = { userId: 'cashier', sessionId: 's', organizationId: 'org1', branchIds: ['b1'], permissions: ['shift.open', 'shift.close', 'shift.cash_movement', 'shift.view_own'] };
  const manager = { ...cashier, userId: 'manager', permissions: ['shift.approve_variance', 'shift.view_report'] };

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    prisma.branchConfiguration.findUnique.mockResolvedValue({ varianceTolerance: D(5) });
    // 500 float + 1000 cash sales = 1500 expected
    prisma.cashMovement.findMany.mockResolvedValue([{ type: 'CASH_SALE', amount: D(1000) }]);
    prisma.cashierShift.update.mockImplementation(async ({ data }) => shift(data));
    prisma.shiftReconciliation.create.mockImplementation(async ({ data }) => ({ id: 'r1', ...data }));
    prisma.paymentMethod.findMany.mockResolvedValue([{ code: 'TELEBIRR' }]);
    prisma.payment.count.mockResolvedValue(0);
    service = new ShiftsService(prisma as never);
  });

  describe('closing a drawer', () => {
    it('closes straight away when the count matches (within tolerance)', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift());
      const res = await service.closeShift('s1', { cashCounts: [{ value: '200', count: 7 }, { value: '100', count: 1 }] }, cashier);

      expect(res.reconciliation.expectedCash).toBe('1500.00');
      expect(res.reconciliation.actualCash).toBe('1500.00');
      expect(res.reconciliation.variance).toBe('0.00');
      expect(res.reconciliation.status).toBe('APPROVED');
      expect(prisma.cashierShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }));
      expect(prisma.cashCount.create).toHaveBeenCalledTimes(2);
    });

    it('counts santim coins exactly (no float drift)', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift());
      prisma.cashMovement.findMany.mockResolvedValue([{ type: 'CASH_SALE', amount: D('0.30') }]);
      const res = await service.closeShift('s1', { cashCounts: [{ value: '200', count: 2 }, { value: '100', count: 1 }, { value: '0.10', count: 3 }] }, cashier);
      expect(res.reconciliation.actualCash).toBe('500.30');
      expect(res.reconciliation.variance).toBe('0.00');
    });

    it('holds the drawer for a manager when it is short', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift());
      const res = await service.closeShift('s1', { cashCounts: [{ value: '200', count: 7 }] }, cashier);
      expect(res.reconciliation.variance).toBe('-100.00');
      expect(res.reconciliation.status).toBe('PENDING');
      expect(prisma.cashierShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSING' }) }));
    });

    it('refuses a drawer that is not open', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift({ status: 'CLOSED' }));
      await expect(service.closeShift('s1', { cashCounts: [] }, cashier)).rejects.toThrow(ConflictException);
    });

    it('will not close while a Telebirr / bank payment is missing its transaction number', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift());
      prisma.payment.count.mockResolvedValue(2);
      await expect(service.closeShift('s1', { cashCounts: [] }, cashier)).rejects.toMatchObject({ response: { code: 'REFERENCES_MISSING', count: 2 } });
    });

    it("refuses someone else's drawer", async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift({ cashierId: 'other' }));
      await expect(service.closeShift('s1', { cashCounts: [] }, cashier)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('signing off a difference', () => {
    const closing = () => shift({ status: 'CLOSING', reconciliation: { id: 'r1', status: 'PENDING', variance: D(-100) } });

    it('lets a manager sign off', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(closing());
      await service.approveVariance('s1', { reason: 'counted twice' }, manager);
      expect(prisma.shiftReconciliation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', approvedById: 'manager' }) }));
      expect(prisma.cashierShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CLOSED' }) }));
    });

    it('asks a cashier for a manager PIN', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(closing());
      await expect(service.approveVariance('s1', { reason: 'x' }, cashier)).rejects.toMatchObject({ response: { code: 'APPROVAL_REQUIRED' } });
    });

    it('refuses when the drawer is not waiting for sign-off', async () => {
      prisma.cashierShift.findUnique.mockResolvedValue(shift({ status: 'OPEN', reconciliation: null }));
      await expect(service.approveVariance('s1', { reason: 'x' }, manager)).rejects.toThrow(ConflictException);
    });
  });

  describe('opening a drawer', () => {
    it('refuses while the last drawer is waiting for sign-off', async () => {
      prisma.cashierShift.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(shift({ status: 'CLOSING' }));
      await expect(service.openShift({ branchId: 'b1', openingFloat: '500' }, cashier)).rejects.toMatchObject({ response: { code: 'PREVIOUS_SHIFT_UNAPPROVED' } });
    });

    it('stores the float as an exact amount', async () => {
      prisma.cashierShift.findFirst.mockResolvedValue(null);
      prisma.cashierShift.create.mockImplementation(async ({ data }) => shift(data));
      await service.openShift({ branchId: 'b1', openingFloat: '500.50' }, cashier);
      expect(prisma.cashierShift.create.mock.calls[0][0].data.openingFloat.toFixed(2)).toBe('500.50');
    });
  });

  it('X report: totals by payment method for the shift', async () => {
    prisma.cashierShift.findUnique.mockResolvedValue({ ...shift(), reconciliation: null, counts: [], movements: [{ type: 'CASH_SALE', amount: D(1000) }] });
    prisma.payment.findMany.mockResolvedValue([
      { method: 'CASH', status: 'CONFIRMED', appliedAmount: D(1000) },
      { method: 'TELEBIRR', status: 'CONFIRMED', appliedAmount: D(250) },
      { method: 'TELEBIRR', status: 'PENDING_VERIFICATION', appliedAmount: D(80) },
    ]);
    prisma.refund.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({ username: 'sara', employee: { firstName: 'Sara', lastName: 'Alemu' } });
    prisma.paymentMethod.findMany.mockResolvedValue([{ code: 'TELEBIRR', name: 'Telebirr' }]);

    const r = await service.getShiftReport('s1', cashier);

    expect(r.kind).toBe('X');
    expect(r.totalTaken).toBe('1250.00');
    expect(r.cash.expected).toBe('1500.00');
    expect(r.payments.find((p) => p.method === 'TELEBIRR')).toMatchObject({ name: 'Telebirr', total: '250.00', pendingVerification: '80.00' });
  });
});
