import { describe, it, expect, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ReceiptsService, NON_FISCAL_NOTICE } from './receipts.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

const D = (v: number | string) => new Prisma.Decimal(v);

describe('ReceiptsService (Unit)', () => {
  let prisma: PrismaMock;
  let service: ReceiptsService;
  const cashier = { userId: 'u1', sessionId: 's', organizationId: 'org1', branchIds: ['b1'], permissions: ['receipt.view', 'receipt.reprint', 'order.view'] };

  const orderRow = {
    id: 'o1', orderNumber: '260925-0007', branchId: 'b1', organizationId: 'org1', currency: 'ETB',
    subtotal: D(110), discountAmount: D(0), serviceChargeAmount: D(11), taxAmount: D('18.15'), totalAmount: D('139.15'), discountReason: null,
    items: [{ productNameSnapshot: 'Latte', quantity: 2, unitPriceSnapshot: D(45), modifiers: [{ nameSnapshot: 'Extra shot', priceDeltaSnapshot: D(10) }] }],
    waiter: { username: 'hana', employee: { firstName: 'Hana', lastName: 'T' } },
    table: { name: 'T4' },
    payments: [{ id: 'p1', method: 'CASH', methodName: 'Cash', tenderedAmount: D(150), appliedAmount: D('139.15'), changeAmount: D('10.85'), referenceNumber: null }],
    organization: { name: 'New Chapter' },
    branch: { name: 'Bole', config: { tinNumber: '0012345678', receiptFooter: 'Thanks!' }, paymentMethods: [{ name: 'Telebirr', accountInfo: 'merchant 123456' }] },
  };

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow);
    prisma.receipt.create.mockImplementation(async ({ data }) => ({ id: 'r1', ...data }));
    prisma.printer.findMany.mockResolvedValue([{ id: 'rp1' }]);
    service = new ReceiptsService(prisma as never);
  });

  it('RECEIPT-UNIT-001: a receipt snapshots the bill, is numbered, marked non-fiscal and printed', async () => {
    const receipt = await service.generateReceipt(prisma as never, 'o1', 'p1', cashier);
    const content = receipt.content as Record<string, unknown>;

    expect(String(receipt.receiptNumber)).toMatch(/^R\d{6}-0001$/);
    expect(content.notice).toBe(NON_FISCAL_NOTICE);
    expect(content.total).toBe('139.15');
    expect(content.tin).toBe('0012345678');
    expect((content.items as { unitPrice: string; lineTotal: string }[])[0]).toMatchObject({ unitPrice: '55.00', lineTotal: '110.00' });
    expect((content.payment as { method: string }).method).toBe('Cash');
    expect(prisma.printerJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ printerId: 'rp1', ticketType: 'RECEIPT' }) }));
  });

  it('RECEIPT-UNIT-002: a reprint is marked COPY, counted and logged with a reason', async () => {
    prisma.receipt.findUnique.mockResolvedValue({ id: 'r1', organizationId: 'org1', branchId: 'b1', content: { total: '139.15' } });
    prisma.receipt.update.mockResolvedValue({ id: 'r1', organizationId: 'org1', branchId: 'b1', reprintCount: 1 });

    await service.reprintReceipt('r1', 'customer lost it', cashier);

    expect(prisma.receipt.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reprintCount: { increment: 1 }, lastReprintedBy: 'u1' }) }));
    expect(prisma.printerJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ isReprint: true, payload: expect.objectContaining({ copy: true }) }) }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'RECEIPT_REPRINTED' }) }));
  });

  it('RECEIPT-UNIT-003: the printed bill lists where to pay', async () => {
    prisma.order.findUnique.mockResolvedValue({ id: 'o1', organizationId: 'org1', branchId: 'b1' });
    const { content } = await service.printBill('o1', cashier);
    expect(content.payTo).toEqual([{ name: 'Telebirr', account: 'merchant 123456' }]);
    expect(prisma.printerJob.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ticketType: 'BILL' }) }));
  });

  it('RECEIPT-UNIT-004: methods deny access if permissions are missing', async () => {
    const none = { ...cashier, permissions: [] };
    await expect(service.getReceipt('r1', none)).rejects.toThrow(ForbiddenException);
    await expect(service.reprintReceipt('r1', 'x', none)).rejects.toThrow(ForbiddenException);
  });

  it('hides receipts from other organizations', async () => {
    prisma.receipt.findUnique.mockResolvedValue({ id: 'r1', organizationId: 'other', branchId: 'b1' });
    await expect(service.getReceipt('r1', cashier)).rejects.toThrow(NotFoundException);
  });
});
