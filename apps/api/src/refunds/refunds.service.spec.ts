import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ForbiddenException, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { RefundsService } from './refunds.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('RefundsService', () => {
  let prisma: PrismaMock;
  let service: RefundsService;
  const orders = { syncPaymentStatus: vi.fn().mockResolvedValue('PARTIALLY_REFUNDED'), tryCompleteOrder: vi.fn(), emitOrder: vi.fn() };
  const as = (userId: string, ...permissions: string[]) => ({ userId, sessionId: 's', organizationId: 'org1', branchIds: ['b1'], permissions });
  const cashier = as('cashier', 'refund.create', 'refund.confirm', 'refund.view');
  const manager = as('manager', 'refund.approve', 'refund.view');

  const refundRow = (over: Record<string, unknown> = {}) => ({
    id: 'r1',
    organizationId: 'org1',
    branchId: 'b1',
    orderId: 'o1',
    paymentId: 'pay1',
    amount: D(100),
    method: 'CARD',
    status: 'PENDING',
    reason: 'cold coffee',
    initiatedById: 'cashier',
    approvedById: null,
    createdAt: new Date(),
    confirmedAt: null,
    items: [],
    order: { paymentStatus: 'PAID' },
    ...over,
  });

  const start = (over: Record<string, unknown> = {}, who: ReturnType<typeof as> = cashier) =>
    service.initiateRefund('o1', { paymentId: 'pay1', amount: '100', method: 'CARD', reason: 'cold coffee', ...over } as never, who);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'org1', branchId: 'b1', status: 'COMPLETED', tableId: null });
    prisma.payment.findUnique.mockResolvedValue({ id: 'pay1', orderId: 'o1', status: 'CONFIRMED', method: 'CARD', refundableAmount: D(1000) });
    prisma.payment.findUniqueOrThrow.mockResolvedValue({ id: 'pay1', status: 'PARTIALLY_REFUNDED' });
    prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: D(0) } });
    prisma.refund.create.mockImplementation(async ({ data }) => refundRow({ ...data, items: [] }));
    prisma.refund.findUnique.mockResolvedValue(refundRow());
    prisma.refund.update.mockImplementation(async ({ data }) => refundRow(data));
    prisma.branchConfiguration.findUnique.mockResolvedValue({ cashierRefundLimit: D(500) });
    service = new RefundsService(prisma as never, orders as never);
  });

  describe('permissions', () => {
    it.each([
      ['initiate', () => start({}, as('x')), 'refund.create'],
      ['approve', () => service.approveRefund('r1', as('x')), 'refund.approve'],
      ['confirm', () => service.confirmRefund('r1', as('x')), 'refund.confirm'],
      ['view', () => service.getRefund('r1', as('x')), 'refund.view'],
      ['list', () => service.listRefundsByOrder('o1', as('x')), 'refund.view'],
    ])('%s is denied without %s', async (_n, call) => {
      await expect(call()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('starting a refund', () => {
    it('only refunds confirmed payments', async () => {
      prisma.payment.findUnique.mockResolvedValue({ id: 'pay1', orderId: 'o1', status: 'PENDING_VERIFICATION', method: 'CARD', refundableAmount: D(0) });
      await expect(start()).rejects.toThrow('PAYMENT_NOT_CONFIRMED');
    });

    it('refunds the same way the customer paid', async () => {
      await expect(start({ method: 'CASH' })).rejects.toThrow('REFUND_METHOD_MISMATCH');
    });

    it.each(['0', '-5', '12.345', 'abc'])('rejects the amount %s', async (amount) => {
      await expect(start({ amount })).rejects.toThrow(BadRequestException);
    });

    it('never refunds more than is left on the payment (including pending refunds)', async () => {
      prisma.refund.aggregate.mockResolvedValue({ _sum: { amount: D(950) } });
      await expect(start()).rejects.toThrow('REFUND_EXCEEDS_REFUNDABLE');
    });

    it('cannot refund more of an item than was ordered', async () => {
      prisma.orderItem.findUnique.mockResolvedValue({ id: 'i1', orderId: 'o1', quantity: 1, productNameSnapshot: 'Latte' });
      prisma.refundItem.aggregate.mockResolvedValue({ _sum: { quantity: D(1) } }); // already refunded once
      await expect(start({ items: [{ orderItemId: 'i1', quantity: '1', refundedAmount: '100' }] })).rejects.toMatchObject({ response: { code: 'REFUND_QUANTITY_INVALID' } });
    });

    it('item amounts must add up to the refund', async () => {
      prisma.orderItem.findUnique.mockResolvedValue({ id: 'i1', orderId: 'o1', quantity: 2, productNameSnapshot: 'Latte' });
      prisma.refundItem.aggregate.mockResolvedValue({ _sum: { quantity: null } });
      await expect(start({ items: [{ orderItemId: 'i1', quantity: '1', refundedAmount: '60' }] })).rejects.toThrow('REFUND_AMOUNT_INVALID');
    });

    it('above the cashier limit it waits for a manager', async () => {
      await start({ amount: '600' });
      expect(prisma.approvalRequest.create).toHaveBeenCalled();
    });

    it("a manager's PIN on the cashier's screen approves it on the spot", async () => {
      prisma.approvalGrant.updateMany.mockResolvedValue({ count: 1 });
      prisma.approvalGrant.findUniqueOrThrow.mockResolvedValue({ approverId: 'manager' });
      await service.initiateRefund('o1', { paymentId: 'pay1', amount: '600', method: 'CARD', reason: 'wrong order' } as never, cashier, undefined, 'pin-token');
      expect(prisma.refund.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'APPROVED', approvedById: 'manager' } }));
      expect(prisma.approvalRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('approving', () => {
    it('nobody approves their own refund', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRow({ initiatedById: 'manager' }));
      await expect(service.approveRefund('r1', manager)).rejects.toThrow('SELF_APPROVAL_FORBIDDEN');
    });

    it('only pending refunds can be approved', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRow({ status: 'CONFIRMED' }));
      await expect(service.approveRefund('r1', manager)).rejects.toThrow('REFUND_NOT_PENDING');
    });

    it('approves and closes the approval request', async () => {
      prisma.approvalRequest.findFirst.mockResolvedValue({ id: 'ar1' });
      await service.approveRefund('r1', manager);
      expect(prisma.refund.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'APPROVED', approvedById: 'manager' } }));
      expect(prisma.approvalRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'APPROVED' } }));
    });

    it('hides refunds from other organizations', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRow({ organizationId: 'other' }));
      await expect(service.approveRefund('r1', manager)).rejects.toThrow(NotFoundException);
    });

    it('at the till, a cashier needs a manager PIN to approve', async () => {
      await expect(service.approveRefund('r1', cashier)).rejects.toMatchObject({ response: { code: 'APPROVAL_REQUIRED' } });
    });
  });

  describe('paying it out', () => {
    it('a big refund must be approved first', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRow({ amount: D(600) }));
      await expect(service.confirmRefund('r1', cashier)).rejects.toThrow('REFUND_NOT_READY_TO_CONFIRM');
    });

    it('refuses when the payment has less left than the refund (race lost)', async () => {
      prisma.$executeRaw.mockResolvedValue(0);
      await expect(service.confirmRefund('r1', cashier)).rejects.toThrow('REFUND_EXCEEDS_REFUNDABLE');
    });

    it('a cash refund needs an open drawer with enough cash, and takes it out', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRow({ method: 'CASH' }));
      prisma.cashierShift.findFirst.mockResolvedValue(null);
      await expect(service.confirmRefund('r1', cashier)).rejects.toThrow('SHIFT_REQUIRED');

      prisma.cashierShift.findFirst.mockResolvedValue({ id: 'sh1', expectedCash: D(1000) });
      prisma.cashierShift.findUniqueOrThrow.mockResolvedValue({ id: 'sh1', expectedCash: D(1000) });
      prisma.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'org1', branchId: 'b1', tableId: null });
      await service.confirmRefund('r1', cashier);
      expect(prisma.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CASH_REFUND' }) }));
      expect(prisma.cashierShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expectedCash: { decrement: D(100) } }) }));
    });

    it('updates the payment balance with a guarded SQL update and recomputes the order status', async () => {
      await service.confirmRefund('r1', cashier);
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(orders.syncPaymentStatus).toHaveBeenCalledWith(expect.anything(), 'o1');
    });

    it('refuses a refund that is already paid out', async () => {
      prisma.refund.findUnique.mockResolvedValue(refundRow({ status: 'CONFIRMED' }));
      await expect(service.confirmRefund('r1', cashier)).rejects.toThrow(ConflictException);
    });
  });
});
