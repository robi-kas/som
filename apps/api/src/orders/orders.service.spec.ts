import { describe, it, expect, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

const D = (v: number | string) => new Prisma.Decimal(v);

/** An order row as Prisma returns it, with every field the service reads. */
function orderRow(over: Record<string, unknown> = {}) {
  return {
    id: 'o1',
    orderNumber: '260925-0001',
    organizationId: 'org1',
    branchId: 'b1',
    tableId: null,
    waiterId: 'u1',
    type: 'DINE_IN',
    status: 'DRAFT',
    paymentStatus: 'UNPAID',
    version: 1,
    fireBatchNumber: 0,
    currency: 'ETB',
    taxConfigSnapshot: { taxRate: '15', isTaxInclusive: false },
    serviceChargeConfigSnapshot: { rate: '10' },
    roundingModeSnapshot: 'HALF_UP',
    discountType: null,
    discountValue: null,
    subtotal: D(0),
    discountAmount: D(0),
    serviceChargeAmount: D(0),
    taxAmount: D(0),
    totalAmount: D(0),
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [],
    payments: [],
    refunds: [],
    ...over,
  };
}

describe('OrdersService', () => {
  let prisma: PrismaMock;
  let service: OrdersService;
  const nobody = { userId: 'u1', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: [] as string[] };
  const as = (...permissions: string[]) => ({ ...nobody, permissions });

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1', name: 'Main' });
    prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow());
    prisma.order.update.mockResolvedValue(orderRow({ version: 2 }));
    service = new OrdersService(prisma as never);
  });

  describe('permissions', () => {
    it.each([
      ['order.create', () => service.createDraftOrder({ branchId: 'b1' }, nobody)],
      ['order.edit', () => service.addItemsToOrder('o1', { expectedVersion: 1, items: [] }, nobody)],
      ['order.submit', () => service.fireOrderToKitchen('o1', { expectedVersion: 1 }, nobody)],
      ['order.edit (void item)', () => service.voidOrderItem('o1', 'i1', { orderVersion: 1, itemVersion: 1, reason: 'x' }, nobody)],
      ['order.view', () => service.getOrder('o1', nobody)],
      ['order.discount', () => service.applyDiscount('o1', { expectedVersion: 1, type: 'PERCENT', value: '5', reason: 'x' }, nobody)],
    ])('denies without %s', async (_name, call) => {
      await expect(call()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('adding items', () => {
    it('recalculates totals on the server, rounded to the santim', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Latte', branchId: 'b1', organizationId: 'org1', status: 'AVAILABLE', isActive: true, sellingPrice: D(10), preparationStationId: 's1', modifiers: [] },
      ]);
      prisma.orderItem.findMany.mockResolvedValue([{ unitPriceSnapshot: D(10), quantity: 2, modifiers: [] }]);

      await service.addItemsToOrder('o1', { expectedVersion: 1, items: [{ productId: 'p1', quantity: 2 }] }, as('order.edit'));

      expect(prisma.$queryRaw).toHaveBeenCalled(); // the order row was locked first
      const totalsCall = prisma.order.update.mock.calls.find(([arg]) => arg.data.subtotal !== undefined)![0];
      expect(totalsCall.data.subtotal.toFixed(2)).toBe('20.00');
      expect(totalsCall.data.serviceChargeAmount.toFixed(2)).toBe('2.00');
      expect(totalsCall.data.taxAmount.toFixed(2)).toBe('3.30');
      expect(totalsCall.data.totalAmount.toFixed(2)).toBe('25.30');
    });

    it('takes add-on prices from the database, never from the client', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.product.findMany.mockResolvedValue([
        {
          id: 'p1', name: 'Latte', branchId: 'b1', organizationId: 'org1', status: 'AVAILABLE', isActive: true, sellingPrice: D(65), preparationStationId: 's1',
          modifiers: [{ id: 'm1', name: 'Extra shot', priceDelta: D(20) }],
        },
      ]);
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.addItemsToOrder('o1', { expectedVersion: 1, items: [{ productId: 'p1', quantity: 1, modifierIds: ['m1'] }] }, as('order.edit'));

      const created = prisma.orderItem.create.mock.calls[0][0].data;
      expect(created.modifiers.create[0]).toMatchObject({ modifierId: 'm1', nameSnapshot: 'Extra shot' });
      expect(created.modifiers.create[0].priceDeltaSnapshot.toFixed(2)).toBe('20.00');
    });

    it('rejects an add-on that belongs to another product', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Latte', branchId: 'b1', organizationId: 'org1', status: 'AVAILABLE', isActive: true, sellingPrice: D(65), modifiers: [] },
      ]);
      await expect(
        service.addItemsToOrder('o1', { expectedVersion: 1, items: [{ productId: 'p1', quantity: 1, modifierIds: ['someone-elses'] }] }, as('order.edit')),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a product from another branch', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.product.findMany.mockResolvedValue([]); // the branch filter found nothing
      await expect(service.addItemsToOrder('o1', { expectedVersion: 1, items: [{ productId: 'p1', quantity: 1 }] }, as('order.edit'))).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects out-of-stock items', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', name: 'Buna', branchId: 'b1', organizationId: 'org1', status: 'OUT_OF_STOCK', isActive: true, sellingPrice: D(40), modifiers: [] },
      ]);
      await expect(service.addItemsToOrder('o1', { expectedVersion: 1, items: [{ productId: 'p1', quantity: 1 }] }, as('order.edit'))).rejects.toMatchObject({
        response: { code: 'PRODUCT_UNAVAILABLE' },
      });
    });

    it('reports a version conflict when someone else changed the order', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ version: 3 }));
      await expect(service.addItemsToOrder('o1', { expectedVersion: 1, items: [{ productId: 'p1', quantity: 1 }] }, as('order.edit'))).rejects.toMatchObject({
        response: { code: 'ORDER_VERSION_CONFLICT' },
      });
    });
  });

  describe('sending to stations', () => {
    it('does nothing when there are no unsent items', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ table: null, waiter: null }));
      prisma.orderItem.findMany.mockResolvedValue([]);
      await service.fireOrderToKitchen('o1', { expectedVersion: 1 }, as('order.submit'));
      expect(prisma.kitchenTicket.create).not.toHaveBeenCalled();
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('marks later batches as ADDITION tickets', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED', fireBatchNumber: 1, table: null, waiter: null }));
      prisma.orderItem.findMany.mockResolvedValue([{ id: 'i1', stationId: 's1', version: 1, quantity: 1, productNameSnapshot: 'Latte', notes: null, modifiers: [] }]);
      prisma.kitchenStation.findMany.mockResolvedValue([{ id: 's1', name: 'Coffee' }]);
      prisma.kitchenTicket.create.mockResolvedValue({ id: 't1', ticketType: 'ADDITION' });
      prisma.printer.findMany.mockResolvedValue([]);

      await service.fireOrderToKitchen('o1', { expectedVersion: 1 }, as('order.submit'));

      expect(prisma.kitchenTicket.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ ticketType: 'ADDITION', fireBatchNumber: 2, stationId: 's1' }) }),
      );
    });

    it('splits one order into a ticket per station (coffee vs kitchen)', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ table: null, waiter: null }));
      prisma.orderItem.findMany.mockResolvedValue([
        { id: 'i1', stationId: 'coffee', version: 1, quantity: 2, productNameSnapshot: 'Macchiato', modifiers: [] },
        { id: 'i2', stationId: 'kitchen', version: 1, quantity: 1, productNameSnapshot: 'Burger', modifiers: [] },
      ]);
      prisma.kitchenStation.findMany.mockResolvedValue([]);
      prisma.kitchenTicket.create.mockImplementation(async ({ data }) => ({ id: `t-${data.stationId}`, ...data }));
      prisma.printer.findMany.mockResolvedValue([]);

      await service.fireOrderToKitchen('o1', { expectedVersion: 1 }, as('order.submit'));

      const stations = prisma.kitchenTicket.create.mock.calls.map(([a]) => a.data.stationId).sort();
      expect(stations).toEqual(['coffee', 'kitchen']);
    });

    it('bottled drinks with no station are handed over by the waiter: served now, no ticket', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ table: null, waiter: null }));
      prisma.orderItem.findMany.mockResolvedValue([
        { id: 'coke', stationId: null, version: 1, quantity: 1, productNameSnapshot: 'Coca', modifiers: [] },
        { id: 'latte', stationId: 'coffee', version: 1, quantity: 1, productNameSnapshot: 'Latte', modifiers: [] },
      ]);
      prisma.kitchenStation.findMany.mockResolvedValue([]);
      prisma.kitchenTicket.create.mockImplementation(async ({ data }) => ({ id: 't1', ...data }));
      prisma.printer.findMany.mockResolvedValue([]);

      await service.fireOrderToKitchen('o1', { expectedVersion: 1 }, as('order.submit'));

      expect(prisma.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'coke' }), data: expect.objectContaining({ status: 'SERVED' }) }));
      expect(prisma.kitchenTicket.create).toHaveBeenCalledTimes(1); // only the latte gets a ticket
      expect(prisma.kitchenTicket.create.mock.calls[0][0].data.stationId).toBe('coffee');
    });
  });

  describe('removing an item', () => {
    const item = (status: string) => ({ id: 'i1', orderId: 'o1', status, version: 1, quantity: 1, productId: 'p1', productNameSnapshot: 'Latte', unitPriceSnapshot: D(65), stationId: 's1' });

    it('lets a waiter remove an unsent item without a manager', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.orderItem.findUnique.mockResolvedValue(item('PENDING'));
      prisma.orderItem.update.mockResolvedValue({ ...item('CANCELLED'), version: 2 });
      prisma.payment.count.mockResolvedValue(0);
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.voidOrderItem('o1', 'i1', { orderVersion: 1, itemVersion: 1, reason: 'mistake' }, as('order.edit'));
      expect(prisma.kitchenTicket.create).not.toHaveBeenCalled();
    });

    it('asks for a manager once the kitchen has the item', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED' }));
      prisma.orderItem.findUnique.mockResolvedValue(item('SENT_TO_KITCHEN'));
      prisma.payment.count.mockResolvedValue(0);
      await expect(service.voidOrderItem('o1', 'i1', { orderVersion: 1, itemVersion: 1, reason: 'x' }, as('order.edit'))).rejects.toMatchObject({
        response: { code: 'APPROVAL_REQUIRED', permission: 'order.void_item' },
      });
    });

    it('sends a cancellation ticket when a manager removes a fired item', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED', fireBatchNumber: 1 }));
      prisma.orderItem.findUnique.mockResolvedValue(item('PREPARING'));
      prisma.orderItem.update.mockResolvedValue({ ...item('CANCELLED'), version: 2 });
      prisma.payment.count.mockResolvedValue(0);
      prisma.kitchenTicket.count.mockResolvedValue(0);
      prisma.kitchenTicket.create.mockResolvedValue({ id: 'cancel-1' });
      prisma.printer.findMany.mockResolvedValue([]);
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.voidOrderItem('o1', 'i1', { orderVersion: 1, itemVersion: 1, reason: 'changed mind' }, as('order.edit', 'order.void_item'));
      expect(prisma.kitchenTicket.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ticketType: 'CANCELLATION', fireBatchNumber: -1 }) }));
    });

    it('refuses to remove items from a bill that already took money', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED' }));
      prisma.orderItem.findUnique.mockResolvedValue(item('PENDING'));
      prisma.payment.count.mockResolvedValue(1);
      await expect(service.voidOrderItem('o1', 'i1', { orderVersion: 1, itemVersion: 1, reason: 'x' }, as('order.edit'))).rejects.toMatchObject({
        response: { code: 'ORDER_HAS_PAYMENTS' },
      });
    });
  });

  describe('discounts', () => {
    it('needs a manager above the branch limit', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ subtotal: D(100) }));
      prisma.payment.count.mockResolvedValue(0);
      prisma.branchConfiguration.findUnique.mockResolvedValue({ largeDiscountPercent: D(10) });
      await expect(service.applyDiscount('o1', { expectedVersion: 1, type: 'PERCENT', value: '25', reason: 'friend' }, as('order.discount'))).rejects.toMatchObject({
        response: { code: 'APPROVAL_REQUIRED', permission: 'order.discount_large' },
      });
    });

    it('allows a small discount and records who gave it and why', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ subtotal: D(100) }));
      prisma.payment.count.mockResolvedValue(0);
      prisma.branchConfiguration.findUnique.mockResolvedValue({ largeDiscountPercent: D(10) });
      prisma.orderItem.findMany.mockResolvedValue([]);

      await service.applyDiscount('o1', { expectedVersion: 1, type: 'PERCENT', value: '5', reason: 'regular' }, as('order.discount'));
      expect(prisma.order.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ discountType: 'PERCENT', discountReason: 'regular', discountAppliedById: 'u1' }) }),
      );
    });

    it('requires a reason', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ subtotal: D(100) }));
      prisma.payment.count.mockResolvedValue(0);
      await expect(service.applyDiscount('o1', { expectedVersion: 1, type: 'PERCENT', value: '5' }, as('order.discount'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('voiding a whole order', () => {
    const waiter = as('order.edit');
    const manager = as('order.edit', 'order.void');

    it.each(['COMPLETED', 'VOIDED', 'CANCELLED'])('refuses a %s order', async (status) => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status }));
      await expect(service.voidOrder('o1', { expectedVersion: 1, reason: 't' }, manager)).rejects.toThrow('ORDER_NOT_VOIDABLE');
    });

    it('refuses when money was taken (refund first)', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ payments: [{ status: 'CONFIRMED' }] }));
      await expect(service.voidOrder('o1', { expectedVersion: 1, reason: 't' }, manager)).rejects.toMatchObject({ response: { code: 'ORDER_HAS_PAYMENTS' } });
    });

    it('asks for a manager when the kitchen already has items', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED', items: [{ status: 'PREPARING' }] }));
      await expect(service.voidOrder('o1', { expectedVersion: 1, reason: 't' }, waiter)).rejects.toMatchObject({ response: { code: 'APPROVAL_REQUIRED' } });
    });

    it('reports a version conflict', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow());
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.voidOrder('o1', { expectedVersion: 1, reason: 't' }, waiter)).rejects.toThrow('ORDER_VERSION_CONFLICT');
    });

    it('cancels items, records the void and frees the table', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ tableId: 't1' }));
      prisma.order.updateMany.mockResolvedValue({ count: 1 });
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: 'VOIDED', tableId: 't1', version: 2 }));
      prisma.table.findUnique.mockResolvedValue({ id: 't1', status: 'OCCUPIED' });
      prisma.order.findFirst.mockResolvedValue(null);

      const res = await service.voidOrder('o1', { expectedVersion: 1, reason: 'walked out' }, waiter);

      expect(res.status).toBe('VOIDED');
      expect(prisma.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
      expect(prisma.voidRecord.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason: 'walked out' }) }));
      expect(prisma.table.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AVAILABLE' }) }));
      expect(prisma.auditLog.create).toHaveBeenCalled();
    });

    it('replays an idempotent request without touching the order', async () => {
      prisma.idempotencyKey.findUnique.mockResolvedValue({ responseBody: { id: 'o1', status: 'VOIDED' } });
      const res = await service.voidOrder('o1', { expectedVersion: 1, reason: 't' }, waiter, 'idem-1');
      expect(res.status).toBe('VOIDED');
      expect(prisma.order.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('closing', () => {
    const manager = as('order.complete');
    const setClosable = (over: Record<string, unknown>) => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED' }));
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: 'SUBMITTED', paymentStatus: 'PAID', items: [{ status: 'SERVED' }], ...over }));
    };

    it('refuses an unpaid order', async () => {
      setClosable({ paymentStatus: 'UNPAID' });
      await expect(service.completeOrder('o1', manager)).rejects.toThrow('ORDER_UNPAID');
    });
    it('refuses while something was charged but never sent to the kitchen', async () => {
      setClosable({ items: [{ status: 'SERVED' }, { status: 'PENDING' }] });
      await expect(service.completeOrder('o1', manager)).rejects.toThrow('ORDER_ITEMS_NOT_SENT');
    });
    it('refuses with a pending refund', async () => {
      setClosable({ refunds: [{ status: 'PENDING' }] });
      await expect(service.completeOrder('o1', manager)).rejects.toThrow('ORDER_HAS_PENDING_REFUND');
    });
    it('refuses while a digital payment is unverified', async () => {
      setClosable({ payments: [{ status: 'PENDING_VERIFICATION' }] });
      await expect(service.completeOrder('o1', manager)).rejects.toThrow('ORDER_HAS_PENDING_PAYMENT');
    });

    it('paid in full closes the bill even if nobody tapped "served" (printer-only kitchens)', async () => {
      setClosable({ items: [{ status: 'SENT_TO_KITCHEN' }, { status: 'READY' }] });
      prisma.orderItem.findMany.mockResolvedValue([
        { id: 'i1', status: 'SENT_TO_KITCHEN' },
        { id: 'i2', status: 'READY' },
      ]);
      prisma.order.update.mockResolvedValue(orderRow({ status: 'COMPLETED', version: 2 }));

      const closed = await service.closeIfDone(prisma as never, 'o1', 'cashier', { paid: true });

      expect(closed).toBe(true);
      expect(prisma.orderItem.update).toHaveBeenCalledTimes(2);
      expect(prisma.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SERVED' }) }));
      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
    });

    it('after a serve (not a payment) it still waits until everything is served', async () => {
      setClosable({ items: [{ status: 'SERVED' }, { status: 'READY' }] });
      expect(await service.closeIfDone(prisma as never, 'o1', 'waiter')).toBe(false);
      expect(prisma.order.update).not.toHaveBeenCalled();
    });

    it('closes the order and frees the table', async () => {
      setClosable({ tableId: 't1' });
      prisma.orderItem.findMany.mockResolvedValue([]);
      prisma.order.update.mockResolvedValue(orderRow({ status: 'COMPLETED', tableId: 't1', version: 2 }));
      prisma.table.findUnique.mockResolvedValue({ id: 't1', status: 'WAITING_FOR_PAYMENT' });
      prisma.order.findFirst.mockResolvedValue(null);

      await service.completeOrder('o1', manager);

      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED', closedAt: expect.any(Date) }) }));
      expect(prisma.table.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'AVAILABLE' }) }));
    });
  });

  describe('serving', () => {
    it('marks ready items served and closes a paid order automatically', async () => {
      prisma.order.findUnique.mockResolvedValueOnce(orderRow({ status: 'SUBMITTED' })).mockResolvedValue(orderRow({ status: 'SUBMITTED' }));
      prisma.orderItem.findMany.mockResolvedValue([{ id: 'i1', status: 'READY' }]);
      const served = { id: 'i1', orderId: 'o1', productId: 'p1', status: 'SERVED', version: 2, quantity: 1, notes: null, kitchenTicketId: 't1', stationId: 's1', productNameSnapshot: 'Latte', unitPriceSnapshot: D(65), modifiers: [] };
      prisma.order.findUniqueOrThrow.mockResolvedValue(orderRow({ status: 'SUBMITTED', paymentStatus: 'PAID', items: [served], table: null, waiter: null }));

      await service.serveItems('o1', {}, as('order.edit'));

      expect(prisma.orderItem.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SERVED' }) }));
      expect(prisma.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }));
    });

    it('says so when nothing is ready', async () => {
      prisma.order.findUnique.mockResolvedValue(orderRow({ status: 'SUBMITTED' }));
      prisma.orderItem.findMany.mockResolvedValue([]);
      await expect(service.serveItems('o1', {}, as('order.edit'))).rejects.toMatchObject({ response: { code: 'NOTHING_TO_SERVE' } });
    });
  });

  it('hides orders from other organizations', async () => {
    prisma.order.findUnique.mockResolvedValue(orderRow({ organizationId: 'other-org' }));
    await expect(service.getOrder('o1', as('order.view'))).rejects.toThrow(NotFoundException);
  });
});
