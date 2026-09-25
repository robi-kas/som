import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { SyncService } from './sync.service.js';
import { BlockOfflineGuard } from './guards/block-offline.guard.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

describe('Offline sync (unit)', () => {
  let prisma: PrismaMock;
  let service: SyncService;
  const orders = {
    createDraftOrder: vi.fn().mockResolvedValue({ id: 'order-new', version: 1 }),
    addItemsToOrder: vi.fn().mockResolvedValue({ id: 'order-new', version: 2 }),
    fireOrderToKitchen: vi.fn().mockResolvedValue({ id: 'order-new' }),
    voidOrder: vi.fn().mockResolvedValue({ status: 'VOIDED' }),
  };
  const waiter = { userId: 'w1', sessionId: 's', organizationId: 'o1', branchIds: ['b1'], permissions: ['sync.submit', 'order.create', 'order.edit', 'order.submit'] };
  const event = (over: Record<string, unknown> = {}) => ({
    localEventId: 'ev1',
    entityType: 'Order',
    entityId: 'tmp1',
    eventType: 'ORDER_SUBMITTED',
    clientTimestamp: '2026-09-25T09:00:00Z',
    payload: { branchId: 'b1', tableId: 't1', items: [{ productId: 'p1', quantity: 2 }] },
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'o1' });
    prisma.syncEvent.findUnique.mockResolvedValue(null);
    prisma.syncEvent.upsert.mockImplementation(async ({ create, update }) => ({ ...create, ...update }));
    prisma.table.findUnique.mockResolvedValue({ id: 't1', branchId: 'b1' });
    prisma.order.findFirst.mockResolvedValue(null);
    service = new SyncService(prisma as never, orders as never);
  });

  it('SYNC-UNIT-001: a replayed event returns the stored result and creates nothing', async () => {
    prisma.syncEvent.findUnique.mockResolvedValue({ organizationId: 'o1', localEventId: 'ev1', syncStatus: 'SYNCED', serverEntityId: '123', errorMessage: null });
    const [res] = await service.submitSyncBatch('dev1', [event()] as never, waiter);
    expect(res).toEqual({ localEventId: 'ev1', syncStatus: 'SYNCED', serverEntityId: '123', errorMessage: null });
    expect(orders.createDraftOrder).not.toHaveBeenCalled();
  });

  it('SYNC-UNIT-002: a branch the waiter can’t access is rejected', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);
    const [res] = await service.submitSyncBatch('dev1', [event()] as never, waiter);
    expect(res.syncStatus).toBe('REJECTED');
    expect(res.errorMessage).toBe('BRANCH_ACCESS_DENIED');
  });

  it('SYNC-UNIT-006: a normal offline order goes through the regular flow and to the kitchen', async () => {
    const [res] = await service.submitSyncBatch('dev1', [event()] as never, waiter);
    expect(res.syncStatus).toBe('SYNCED');
    expect(orders.createDraftOrder).toHaveBeenCalledWith(expect.objectContaining({ branchId: 'b1', tableId: 't1' }), waiter);
    expect(orders.addItemsToOrder).toHaveBeenCalled();
    expect(orders.fireOrderToKitchen).toHaveBeenCalledWith('order-new', { expectedVersion: 2 }, waiter);
  });

  it('SYNC-UNIT-007: if someone seated the table meanwhile, it is kept aside as a CONFLICT and not cooked', async () => {
    prisma.order.findFirst.mockResolvedValue({ id: 'other-order' });
    const [res] = await service.submitSyncBatch('dev1', [event()] as never, waiter);
    expect(res.syncStatus).toBe('CONFLICT');
    expect(orders.createDraftOrder).toHaveBeenCalledWith(expect.objectContaining({ tableId: undefined }), waiter);
    expect(orders.fireOrderToKitchen).not.toHaveBeenCalled();
  });

  it('SYNC-UNIT-008: a refused order (e.g. item sold out) is voided and reported', async () => {
    orders.addItemsToOrder.mockRejectedValueOnce(new ConflictException({ code: 'PRODUCT_UNAVAILABLE', message: 'Buna is out of stock' }));
    prisma.order.findUnique.mockResolvedValue({ id: 'order-new', status: 'DRAFT', version: 1 });
    const [res] = await service.submitSyncBatch('dev1', [event()] as never, waiter);
    expect(res.syncStatus).toBe('REJECTED');
    expect(res.errorMessage).toBe('PRODUCT_UNAVAILABLE');
    expect(orders.voidOrder).toHaveBeenCalled();
  });

  it('SYNC-UNIT-003/004: the offline guard blocks money operations', () => {
    const guard = new BlockOfflineGuard();
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-offline-mode': 'true' } }) }) } as never;
    expect(() => guard.canActivate(ctx)).toThrow(ConflictException);
    expect(() => guard.canActivate(ctx)).toThrow('OFFLINE_NOT_ALLOWED_FOR_OPERATION');
  });

  it('SYNC-UNIT-005: permission denials on all three endpoints', async () => {
    const none = { ...waiter, permissions: [] };
    await expect(service.submitSyncBatch('d1', [], none)).rejects.toThrow(ForbiddenException);
    await expect(service.getSyncStatus('d1', none)).rejects.toThrow(ForbiddenException);
    await expect(service.resolveConflict('ev1', 'ACCEPT_LOCAL', none)).rejects.toThrow(ForbiddenException);
  });
});
