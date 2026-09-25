import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

const D = (v: number | string) => new Prisma.Decimal(v);

const METHODS: Record<string, Record<string, unknown>> = {
  CASH: { code: 'CASH', name: 'Cash', kind: 'CASH', requiresReference: false, requiresProof: false, requiresVerification: false, askPayerBank: false, isActive: true },
  CARD: { code: 'CARD', name: 'Card', kind: 'CARD', requiresReference: false, requiresProof: false, requiresVerification: false, askPayerBank: false, isActive: true },
  TELEBIRR: { code: 'TELEBIRR', name: 'Telebirr', kind: 'MOBILE_MONEY', requiresReference: true, requiresProof: false, requiresVerification: true, askPayerBank: false, isActive: true },
  CBE_MOBILE: { code: 'CBE_MOBILE', name: 'CBE Mobile Banking', kind: 'BANK_APP', requiresReference: true, requiresProof: true, requiresVerification: true, askPayerBank: false, isActive: true },
  OTHER_BANK: { code: 'OTHER_BANK', name: 'Other bank / app', kind: 'OTHER', requiresReference: true, requiresProof: true, requiresVerification: true, askPayerBank: true, isActive: true },
  AMOLE: { code: 'AMOLE', name: 'Amole', kind: 'BANK_APP', requiresReference: true, requiresProof: true, requiresVerification: true, askPayerBank: false, isActive: false },
};

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1',
  orderNumber: '260925-0001',
  organizationId: 'org1',
  branchId: 'b1',
  tableId: null,
  status: 'SUBMITTED',
  currency: 'ETB',
  totalAmount: D(100),
  ...over,
});

const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: 'pay1',
  orderId: 'o1',
  organizationId: 'org1',
  method: 'CASH',
  methodName: 'Cash',
  currency: 'ETB',
  tenderedAmount: D(100),
  appliedAmount: D(100),
  changeAmount: D(0),
  status: 'CONFIRMED',
  referenceNumber: null,
  receivedById: 'cashier',
  evidenceId: null,
  confirmedAt: new Date(),
  createdAt: new Date(),
  ...over,
});

describe('PaymentsService (Unit)', () => {
  let prisma: PrismaMock;
  let service: PaymentsService;
  const receipts = { generateReceipt: vi.fn() };
  const orders = { syncPaymentStatus: vi.fn(), closeIfDone: vi.fn(), emitOrder: vi.fn() };
  const cashier = { userId: 'cashier', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: ['payment.collect', 'payment.view'] };
  const manager = { ...cashier, userId: 'manager', permissions: ['payment.confirm', 'payment.view'] };

  const pay = (method: string, over: Record<string, unknown> = {}) =>
    service.createPayment('o1', { method, currency: 'ETB', tenderedAmount: '100', appliedAmount: '100', ...over } as never, cashier);

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    prisma.cashierShift.findFirst.mockResolvedValue({ id: 'shift1', status: 'OPEN' });
    prisma.order.findUnique.mockResolvedValue(order());
    prisma.order.findUniqueOrThrow.mockResolvedValue(order());
    prisma.payment.findMany.mockResolvedValue([]);
    prisma.paymentMethod.count.mockResolvedValue(Object.keys(METHODS).length);
    prisma.paymentMethod.findUnique.mockImplementation(async ({ where }) => METHODS[where.branchId_code.code] ?? null);
    prisma.payment.create.mockImplementation(async ({ data }) => paymentRow(data));
    service = new PaymentsService(prisma as never, receipts as never, orders as never, new PaymentMethodsService(prisma as never));
  });

  describe('taking a payment', () => {
    it('denies without payment.collect', async () => {
      await expect(service.createPayment('o1', { method: 'CASH', currency: 'ETB', tenderedAmount: '10', appliedAmount: '10' }, { ...cashier, permissions: [] })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('replays an idempotent request', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({ responseBody: { id: 'pay-old' } });
      const res = await service.createPayment('o1', { method: 'CASH', currency: 'ETB', tenderedAmount: '100', appliedAmount: '100' }, cashier, 'idem-1');
      expect(res.id).toBe('pay-old');
      expect(prisma.payment.create).not.toHaveBeenCalled();
    });

    it('needs an open cash drawer', async () => {
      prisma.cashierShift.findFirst.mockResolvedValue(null);
      await expect(pay('CASH')).rejects.toMatchObject({ response: { code: 'SHIFT_REQUIRED' } });
    });

    it('rejects a currency mismatch', async () => {
      await expect(pay('CASH', { currency: 'USD' })).rejects.toThrow('Currency mismatch');
    });

    it('rejects tendered less than applied', async () => {
      await expect(pay('CASH', { tenderedAmount: '50', appliedAmount: '100' })).rejects.toThrow(BadRequestException);
    });

    it('rejects money amounts that are not exact 2-decimal values', async () => {
      await expect(pay('CASH', { tenderedAmount: '100.005', appliedAmount: '100' })).rejects.toThrow(BadRequestException);
    });

    it('never takes more than is still due, counting payments waiting for verification', async () => {
      prisma.payment.findMany.mockResolvedValue([{ appliedAmount: D(60), status: 'PENDING_VERIFICATION' }]);
      await expect(pay('CASH', { tenderedAmount: '50', appliedAmount: '50' })).rejects.toMatchObject({ response: { code: 'PAYMENT_BALANCE_EXCEEDED' } });
    });

    it('confirms cash at once, computes change, updates the drawer and prints a receipt', async () => {
      await pay('CASH', { tenderedAmount: '200', appliedAmount: '100' });

      const data = prisma.payment.create.mock.calls[0][0].data;
      expect(data.status).toBe('CONFIRMED');
      expect(data.changeAmount.toFixed(2)).toBe('100.00');
      expect(prisma.$queryRaw).toHaveBeenCalled(); // order row locked
      expect(prisma.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CASH_SALE' }) }));
      expect(prisma.cashierShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expectedCash: { increment: expect.anything() } }) }));
      expect(receipts.generateReceipt).toHaveBeenCalled();
      expect(orders.closeIfDone).toHaveBeenCalled();
    });

    it('only cash can have change', async () => {
      await expect(pay('CARD', { tenderedAmount: '120', appliedAmount: '100' })).rejects.toMatchObject({ response: { code: 'PAYMENT_AMOUNT_INVALID' } });
    });

    it('records Telebirr as pending, with no receipt yet', async () => {
      await pay('TELEBIRR', { referenceNumber: 'CGH12345XY' });
      const data = prisma.payment.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING_VERIFICATION');
      expect(data.methodName).toBe('Telebirr');
      expect(receipts.generateReceipt).not.toHaveBeenCalled();
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('lets the cashier skip the transaction number and add it later', async () => {
      await pay('TELEBIRR');
      expect(prisma.payment.create.mock.calls[0][0].data.referenceNumber).toBeNull();
    });

    it('adding a missing transaction number later is logged', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...paymentRow({ method: 'TELEBIRR', referenceNumber: null, status: 'PENDING_VERIFICATION' }), order: order() });
      prisma.payment.update.mockImplementation(async ({ data }) => paymentRow({ method: 'TELEBIRR', ...data }));
      await service.setReference('pay1', 'CGH12345XY', cashier);
      expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ referenceNumber: 'CGH12345XY' }) }));
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PAYMENT_REFERENCE_ADDED' }) }));
    });

    it('changing a transaction number already entered needs payment.confirm', async () => {
      prisma.payment.findUnique.mockResolvedValue({ ...paymentRow({ method: 'TELEBIRR', referenceNumber: 'OLD1234' }), order: order() });
      await expect(service.setReference('pay1', 'NEW5678', cashier)).rejects.toThrow(ForbiddenException);
    });

    it('asks which bank for "Other bank / app" and stores it', async () => {
      await expect(pay('OTHER_BANK', { referenceNumber: 'FT2500001' })).rejects.toMatchObject({ response: { code: 'PAYER_BANK_REQUIRED' } });
      await pay('OTHER_BANK', { referenceNumber: 'FT2500001', payerBank: 'Wegagen' });
      const data = prisma.payment.create.mock.calls[0][0].data;
      expect(data.payerBank).toBe('Wegagen');
      expect(data.methodName).toBe('Other bank / app: Wegagen');
    });

    it('refuses a method the owner switched off', async () => {
      await expect(pay('AMOLE', { referenceNumber: 'AM123456' })).rejects.toMatchObject({ response: { code: 'METHOD_NOT_ACCEPTED' } });
    });

    it('refuses a transaction number that was already used', async () => {
      prisma.payment.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }));
      await expect(pay('TELEBIRR', { referenceNumber: 'CGH12345XY' })).rejects.toMatchObject({ response: { code: 'REFERENCE_ALREADY_USED' } });
    });
  });

  describe('change for a transfer that was more than the bill', () => {
    it('the cashier gives the difference in cash from the drawer', async () => {
      prisma.cashierShift.findUniqueOrThrow.mockResolvedValue({ id: 'shift1', expectedCash: D(500) });
      await pay('TELEBIRR', { referenceNumber: 'CGH12345XY', tenderedAmount: '120', appliedAmount: '100' });
      expect(prisma.payment.create.mock.calls[0][0].data.changeAmount.toFixed(2)).toBe('20.00');
      expect(prisma.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CHANGE_OUT' }) }));
      expect(prisma.cashierShift.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ expectedCash: { decrement: expect.anything() } }) }));
    });

    it('refuses when the drawer does not have the change', async () => {
      prisma.cashierShift.findUniqueOrThrow.mockResolvedValue({ id: 'shift1', expectedCash: D(5) });
      await expect(pay('TELEBIRR', { tenderedAmount: '120', appliedAmount: '100' })).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_DRAWER_CASH' } });
    });

    it('never hands out more change than the bill (no cash-out service)', async () => {
      await expect(pay('TELEBIRR', { tenderedAmount: '1000', appliedAmount: '100' })).rejects.toMatchObject({ response: { code: 'CHANGE_TOO_BIG' } });
    });
  });

  describe('a waiter records a transfer from their phone', () => {
    const waiter = { userId: 'hana', sessionId: 's2', organizationId: 'org1', branchIds: ['b1'], permissions: ['payment.report'] };
    const report = (over: Record<string, unknown> = {}, file?: unknown) =>
      service.reportPayment('o1', { method: 'TELEBIRR', appliedAmount: '100', referenceNumber: 'CGH12345XY', ...over } as never, file as never, waiter);

    beforeEach(() => {
      prisma.branchConfiguration.findUnique.mockResolvedValue({ waiterPayments: true, waiterPhotoRequired: false });
    });

    it('is always waiting for the cashier to check, even for a method that needs no check', async () => {
      await report();
      const data = prisma.payment.create.mock.calls[0][0].data;
      expect(data.status).toBe('PENDING_VERIFICATION');
      expect(data.reportedByWaiter).toBe(true);
      expect(data.receivedById).toBe('hana');
      expect(receipts.generateReceipt).not.toHaveBeenCalled();
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('does not need an open cash drawer', async () => {
      prisma.cashierShift.findFirst.mockResolvedValue(null);
      await expect(report()).resolves.toBeDefined();
    });

    it('needs the photo when the cafe requires it', async () => {
      prisma.branchConfiguration.findUnique.mockResolvedValue({ waiterPayments: true, waiterPhotoRequired: true });
      await expect(report()).rejects.toMatchObject({ response: { code: 'PHOTO_REQUIRED' } });
    });

    it('rejects a file that is not really a photo', async () => {
      await expect(report({}, { buffer: Buffer.from('%PDF-1.4 not an image'), mimetype: 'image/png' })).rejects.toMatchObject({ response: { code: 'PHOTO_INVALID' } });
    });

    it('is refused when the cafe turned waiter payments off', async () => {
      prisma.branchConfiguration.findUnique.mockResolvedValue({ waiterPayments: false, waiterPhotoRequired: false });
      await expect(report()).rejects.toMatchObject({ response: { code: 'WAITER_PAYMENTS_OFF' } });
    });

    it('cash and card stay at the till', async () => {
      await expect(report({ method: 'CASH' })).rejects.toMatchObject({ response: { code: 'METHOD_AT_TILL' } });
    });

    it('can pay just part of the bill (the rest in cash at the till)', async () => {
      await report({ appliedAmount: '40' });
      expect(prisma.payment.create.mock.calls[0][0].data.appliedAmount.toFixed(2)).toBe('40.00');
    });

    it('records what the customer sent; no cash moves yet', async () => {
      await report({ sentAmount: '120' });
      const data = prisma.payment.create.mock.calls[0][0].data;
      expect(data.changeAmount.toFixed(2)).toBe('20.00');
      expect(data.tenderedAmount.toFixed(2)).toBe('120.00');
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });

    it('never records more change than the bill', async () => {
      await expect(report({ sentAmount: '1000' })).rejects.toMatchObject({ response: { code: 'CHANGE_TOO_BIG' } });
    });
  });

  describe('confirming a waiter’s over-paid transfer', () => {
    const waiterPayment = paymentRow({ method: 'TELEBIRR', status: 'PENDING_VERIFICATION', receivedById: 'hana', reportedByWaiter: true, tenderedAmount: D(120), appliedAmount: D(100), changeAmount: D(20) });
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(waiterPayment);
      prisma.payment.findUniqueOrThrow.mockResolvedValue(waiterPayment);
      prisma.payment.update.mockImplementation(async ({ data }) => ({ ...waiterPayment, ...data }));
    });

    it('the cashier hands out the change from the drawer when confirming', async () => {
      prisma.cashierShift.findUniqueOrThrow.mockResolvedValue({ id: 'shift1', expectedCash: D(500) });
      await service.confirmPayment('pay1', manager);
      expect(prisma.cashMovement.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'CHANGE_OUT' }) }));
    });

    it('needs the cashier’s drawer open to give that change', async () => {
      prisma.cashierShift.findFirst.mockResolvedValue(null);
      await expect(service.confirmPayment('pay1', manager)).rejects.toMatchObject({ response: { code: 'SHIFT_REQUIRED' } });
    });

    it('rejecting it moves no cash at all', async () => {
      await service.rejectPayment('pay1', 'not on statement', manager);
      expect(prisma.cashMovement.create).not.toHaveBeenCalled();
    });
  });

  describe('payment history', () => {
    const day = { from: new Date('2026-09-25T00:00:00Z'), to: new Date('2026-09-26T00:00:00Z') };

    it('lists the window newest first, with who took it and whether there is a screenshot', async () => {
      prisma.payment.findMany.mockResolvedValue([
        { ...paymentRow({ method: 'TELEBIRR', methodName: 'Telebirr', evidenceId: 'ev1', payerBank: null, rejectedReason: null, refundableAmount: D(100) }), order: { ...order(), table: { name: 'T4' } }, receivedBy: { username: 'sara', employee: null }, verifiedBy: null },
      ]);
      const rows = await service.listHistory({ branchId: 'b1', ...day }, { ...cashier, permissions: ['payment.view'] });
      expect(prisma.payment.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { createdAt: 'desc' } }));
      expect(rows[0]).toMatchObject({ tableName: 'T4', receivedByName: 'sara', hasEvidence: true, methodName: 'Telebirr' });
    });

    it('refuses more than a month at once', async () => {
      await expect(
        service.listHistory({ branchId: 'b1', from: new Date('2026-01-01'), to: new Date('2026-09-01') }, { ...cashier, permissions: ['payment.view'] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('verifying a digital payment', () => {
    beforeEach(() => {
      prisma.payment.findUnique.mockResolvedValue(paymentRow({ method: 'TELEBIRR', status: 'PENDING_VERIFICATION', referenceNumber: 'CGH12345XY' }));
      prisma.payment.findUniqueOrThrow.mockResolvedValue(paymentRow({ method: 'TELEBIRR', status: 'PENDING_VERIFICATION', referenceNumber: 'CGH12345XY' }));
      prisma.payment.update.mockImplementation(async ({ data }) => paymentRow({ method: 'TELEBIRR', ...data }));
    });

    it('denies without payment.confirm', async () => {
      await expect(service.confirmPayment('pay1', cashier)).rejects.toThrow(ForbiddenException);
    });

    it('by default the cashier can confirm a payment they took themselves', async () => {
      prisma.branchConfiguration.findUnique.mockResolvedValue({ verifyBySecondPerson: false });
      await service.confirmPayment('pay1', { ...manager, userId: 'cashier' });
      expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', verifiedById: 'cashier' }) }));
    });

    it('with "second person must verify" on, the cashier cannot verify their own payment', async () => {
      prisma.branchConfiguration.findUnique.mockResolvedValue({ verifyBySecondPerson: true });
      await expect(service.confirmPayment('pay1', { ...manager, userId: 'cashier' })).rejects.toMatchObject({ response: { code: 'SELF_VERIFICATION' } });
    });

    it('needs the screenshot for methods that require proof', async () => {
      prisma.payment.findUniqueOrThrow.mockResolvedValue(paymentRow({ method: 'CBE_MOBILE', status: 'PENDING_VERIFICATION', evidenceId: null }));
      await expect(service.confirmPayment('pay1', manager)).rejects.toMatchObject({ response: { code: 'PROOF_REQUIRED' } });
    });

    it('confirms, records the verifier and prints the receipt', async () => {
      await service.confirmPayment('pay1', manager);
      expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CONFIRMED', verifiedById: 'manager' }) }));
      expect(receipts.generateReceipt).toHaveBeenCalled();
      expect(orders.syncPaymentStatus).toHaveBeenCalled();
    });

    it('rejecting puts the amount back on the bill', async () => {
      await service.rejectPayment('pay1', 'not on statement', manager);
      expect(prisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED', rejectedReason: 'not on statement' }) }));
      expect(orders.syncPaymentStatus).toHaveBeenCalled();
    });
  });
});
