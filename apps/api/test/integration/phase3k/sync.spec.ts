import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { SyncService } from '../../../src/sync/sync.service.js';

describe('Phase 3K Sync Integration', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let userId: string;
  let principal: any;
  let syncService: SyncService;
  let tableId: string;
  let productId: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    syncService = fixture.app.get(SyncService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
    orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    branchId = `b1-${crypto.randomBytes(4).toString('hex')}`;
    userId = `u1-${crypto.randomBytes(4).toString('hex')}`;

    await fixture.prisma.organization.create({ data: { id: orgId, name: orgId, slug: orgId } });
    await fixture.prisma.branch.create({ data: { id: branchId, organizationId: orgId, name: 'B1' } });
    await fixture.prisma.branchConfiguration.create({ data: { branchId, currency: 'USD', taxRate: 10 } });
    await fixture.prisma.user.create({ data: { id: userId, organizationId: orgId, username: userId, passwordHash: 'pwd' } });

    const table = await fixture.prisma.table.create({ data: { organizationId: orgId, branchId, name: 'T1', capacity: 2, status: 'AVAILABLE' } });
    tableId = table.id;

    const cat = await fixture.prisma.category.create({ data: { organizationId: orgId, branchId, name: 'Cat', displayOrder: 1 } });
    const prod = await fixture.prisma.product.create({ data: { organizationId: orgId, branchId, categoryId: cat.id, name: 'Prod', sellingPrice: 10 } });
    productId = prod.id;

    principal = {
      userId,
      organizationId: orgId,
      branchIds: [branchId],
      permissions: ['sync.submit', 'sync.view', 'sync.resolve_conflict'],
    };
  });

  it('SYNC-INT-001: successful single-event sync creates order and marks SYNCED', async () => {
    const events = [{
      localEventId: 'e1', entityType: 'Order', entityId: 'temp1', eventType: 'ORDER_SUBMITTED',
      payload: { branchId, tableId, items: [{ productId, quantity: 2 }] },
      clientTimestamp: new Date().toISOString()
    }];
    const res = await syncService.submitSyncBatch('dev_t1', events, principal);
    expect(res[0].syncStatus).toBe('SYNCED');
    expect(res[0].serverEntityId).toBeTruthy();

    const order = await fixture.prisma.order.findUnique({ where: { id: res[0].serverEntityId } });
    expect(order).toBeTruthy();
    expect(order!.status).toBe('SUBMITTED');
    expect(order!.deviceId).toBe('dev_t1');
    expect(Number(order!.totalAmount)).toBe(22); // 20 + 2 tax

    const table = await fixture.prisma.table.findUnique({ where: { id: tableId } });
    expect(table!.status).toBe('OCCUPIED');
  });

  it('SYNC-INT-002: duplicate sync event is a no-op (idempotency)', async () => {
    const events = [{
      localEventId: 'e2', entityType: 'Order', entityId: 'temp2', eventType: 'ORDER_SUBMITTED',
      payload: { branchId, tableId, items: [{ productId, quantity: 1 }] },
      clientTimestamp: new Date().toISOString()
    }];
    const res1 = await syncService.submitSyncBatch('dev_t2', events, principal);
    const res2 = await syncService.submitSyncBatch('dev_t2', events, principal);
    
    expect(res2[0].syncStatus).toBe('SYNCED');
    expect(res2[0].serverEntityId).toBe(res1[0].serverEntityId);

    const orders = await fixture.prisma.order.findMany({ where: { deviceId: 'dev_t2' } });
    expect(orders.length).toBe(1); // No duplicates created
  });

  it('SYNC-INT-003: two devices submit conflicting orders for same table -> both preserved, one SYNCED one CONFLICT', async () => {
    const offlineStart = new Date(Date.now() - 60000).toISOString();
    
    // First device submits online
    const event1 = [{
      localEventId: 'e3', entityType: 'Order', entityId: 'temp3', eventType: 'ORDER_SUBMITTED',
      payload: { branchId, tableId, items: [{ productId, quantity: 1 }] },
      clientTimestamp: offlineStart
    }];
    await syncService.submitSyncBatch('dev_t3', event1, principal);

    // Second device comes online and syncs an event that started earlier or same time
    const event2 = [{
      localEventId: 'e4', entityType: 'Order', entityId: 'temp4', eventType: 'ORDER_SUBMITTED',
      payload: { branchId, tableId, items: [{ productId, quantity: 1 }] },
      clientTimestamp: offlineStart
    }];
    const res = await syncService.submitSyncBatch('dev2', event2, principal);
    
    expect(res[0].syncStatus).toBe('CONFLICT');
    expect(res[0].errorMessage).toMatch(/Conflicting order/);
    
    const tableOrders = await fixture.prisma.order.findMany({ where: { tableId } });
    const nullTableOrders = await fixture.prisma.order.findMany({ where: { tableId: null, deviceId: 'dev2' } });
    expect(tableOrders.length + nullTableOrders.length).toBeGreaterThanOrEqual(2);
  });

  it('SYNC-INT-004: rejected event (unavailable product) sets REJECTED and does not create order', async () => {
    const events = [{
      localEventId: 'e5', entityType: 'Order', entityId: 'temp5', eventType: 'ORDER_SUBMITTED',
      payload: { branchId, tableId, items: [{ productId: 'invalid', quantity: 1 }] },
      clientTimestamp: new Date().toISOString()
    }];
    const res = await syncService.submitSyncBatch('dev_t4', events, principal);
    expect(res[0].syncStatus).toBe('REJECTED');
    expect(res[0].errorMessage).toBe('PRODUCT_UNAVAILABLE');

    const ev = await fixture.prisma.syncEvent.findUnique({ where: { deviceId_localEventId: { deviceId: 'dev_t4', localEventId: 'e5' } } });
    expect(ev!.syncStatus).toBe('REJECTED');
  });

  it('SYNC-INT-005: resolveConflict ACCEPT_LOCAL writes audit and marks resolved', async () => {
    const ev = await fixture.prisma.syncEvent.create({
      data: {
        organizationId: orgId, branchId, deviceId: 'dev3', localEventId: 'e6', entityType: 'Order', entityId: 'temp6', eventType: 'ORDER_SUBMITTED',
        payload: {}, clientTimestamp: new Date(), syncStatus: 'CONFLICT'
      }
    });

    const res = await syncService.resolveConflict(ev.id, 'ACCEPT_LOCAL', principal);
    expect(res.syncStatus).toBe('SYNCED');

    const audit = await fixture.prisma.auditLog.findFirst({ where: { entityId: ev.id, action: 'SYNC_CONFLICT_RESOLVED' } });
    expect(audit).toBeTruthy();
    expect((audit!.beforeState as any).resolution).toBe('ACCEPT_LOCAL');
  });

  it('SYNC-INT-006: sync/status returns correct counts', async () => {
    await fixture.prisma.syncEvent.createMany({
      data: [
        { organizationId: orgId, branchId, deviceId: 'dev4', localEventId: 'e7', entityType: 'Order', entityId: 'temp7', eventType: 'ORDER_SUBMITTED', payload: {}, clientTimestamp: new Date(), syncStatus: 'SYNCED', serverReceivedAt: new Date(Date.now() - 1000) },
        { organizationId: orgId, branchId, deviceId: 'dev4', localEventId: 'e8', entityType: 'Order', entityId: 'temp8', eventType: 'ORDER_SUBMITTED', payload: {}, clientTimestamp: new Date(), syncStatus: 'REJECTED' }
      ]
    });

    const res = await syncService.getSyncStatus('dev4', principal);
    expect(res.statusCounts['SYNCED']).toBe(1);
    expect(res.statusCounts['REJECTED']).toBe(1);
    expect(res.lastSuccessfulSyncAt).toBeTruthy();
  });
});
