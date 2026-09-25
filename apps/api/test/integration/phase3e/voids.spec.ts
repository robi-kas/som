import { getIntegrationFixture } from '../fixture.js';
import { OrdersService } from '../../../src/orders/orders.service.js';
import { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';

describe('Phase 3E Voids Integration', () => {
  let fixture: any;
  let service: OrdersService;
  let orgId: string;
  let branchId: string;
  let principal: AuthenticatedPrincipal;
  let userId: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    service = fixture.app.get(OrdersService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
    const org = await fixture.prisma.organization.create({
      data: { name: `org-${crypto.randomBytes(4).toString('hex')}`, slug: `o-${crypto.randomBytes(4).toString('hex')}` }
    });
    const branch = await fixture.prisma.branch.create({
      data: { organizationId: org.id, name: 'B1' }
    });
    const user = await fixture.prisma.user.create({
      data: { organizationId: org.id, username: `u-${crypto.randomBytes(4).toString('hex')}`, passwordHash: 'secret' }
    });
    
    orgId = org.id;
    branchId = branch.id;
    userId = user.id;

    principal = {
      userId: user.id,
      organizationId: org.id,
      branchIds: [branch.id],
      permissions: ['order.void']
    };
  });

  async function createOrderWithTableAndItems(tableStatus: string = 'OCCUPIED') {
    const table = await fixture.prisma.table.create({
      data: { organizationId: orgId, branchId: branchId, name: 'T1', capacity: 4, status: tableStatus, version: 1 }
    });
    const order = await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId: branchId, tableId: table.id, version: 1, type: 'DINE_IN', status: 'DRAFT', currency: 'ETB', orderNumber: `ORD-${crypto.randomBytes(4).toString('hex')}` }
    });
    const cat = await fixture.prisma.category.create({ data: { organizationId: orgId, branchId: branchId, name: 'C1' } });
    const prod = await fixture.prisma.product.create({
      data: { organizationId: orgId, branchId: branchId, name: 'P1', sellingPrice: '10.00', categoryId: cat.id }
    });
    await fixture.prisma.orderItem.create({
      data: { organizationId: orgId, branchId: branchId, orderId: order.id, productId: prod.id, productNameSnapshot: 'P1', quantity: 1, unitPriceSnapshot: '10.00', status: 'PENDING', version: 1 }
    });
    return { table, order };
  }

  it('VOID-DB-001 Successful void: order -> VOIDED, items -> CANCELLED, VoidRecord created, table -> AVAILABLE', async () => {
    const { order, table } = await createOrderWithTableAndItems();
    await service.voidOrder(order.id, { expectedVersion: 1, reason: 'mistake' }, principal);
    
    const dbOrder = await fixture.prisma.order.findUnique({ where: { id: order.id }, include: { items: true, VoidRecord: true } });
    expect(dbOrder!.status).toBe('VOIDED');
    expect(dbOrder!.items[0].status).toBe('CANCELLED');
    expect(dbOrder!.VoidRecord).toHaveLength(1);
    expect(dbOrder!.VoidRecord[0].reason).toBe('mistake');

    const dbTable = await fixture.prisma.table.findUnique({ where: { id: table.id } });
    expect(dbTable!.status).toBe('AVAILABLE');
  });

  it('VOID-DB-002 Void an order with a confirmed payment -> ORDER_HAS_PAYMENTS', async () => {
    const { order } = await createOrderWithTableAndItems();
    await fixture.prisma.payment.create({
      data: { organizationId: orgId, orderId: order.id, method: 'CASH', currency: 'ETB', tenderedAmount: '10.00', appliedAmount: '10.00', refundableAmount: '10.00', status: 'CONFIRMED', receivedById: userId, version: 1 }
    });
    await expect(service.voidOrder(order.id, { expectedVersion: 1, reason: 'mistake' }, principal))
      .rejects.toThrow('ORDER_HAS_PAYMENTS');
  });

  it('VOID-DB-003 Void a COMPLETED order -> ORDER_NOT_VOIDABLE', async () => {
    const { order } = await createOrderWithTableAndItems();
    await fixture.prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED', version: 2 } });
    await expect(service.voidOrder(order.id, { expectedVersion: 2, reason: 'test' }, principal))
      .rejects.toThrow('ORDER_NOT_VOIDABLE');
  });

  it('VOID-DB-004 Version conflict -> ORDER_VERSION_CONFLICT', async () => {
    const { order } = await createOrderWithTableAndItems();
    await expect(service.voidOrder(order.id, { expectedVersion: 99, reason: 'test' }, principal))
      .rejects.toThrow('ORDER_VERSION_CONFLICT');
  });

  it('VOID-DB-005 Table is released only if no other active order exists', async () => {
    const { table, order: o1 } = await createOrderWithTableAndItems();
    const o2 = await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId: branchId, tableId: table.id, version: 1, type: 'DINE_IN', status: 'HELD', currency: 'ETB', orderNumber: `ORD-${crypto.randomBytes(4).toString('hex')}` }
    });
    await service.voidOrder(o1.id, { expectedVersion: 1, reason: 'test' }, principal);
    
    const dbTable = await fixture.prisma.table.findUnique({ where: { id: table.id } });
    expect(dbTable!.status).toBe('OCCUPIED'); // still occupied by o2
  });

  it('VOID-DB-006 Audit log entry has before/after state', async () => {
    const { order } = await createOrderWithTableAndItems();
    await service.voidOrder(order.id, { expectedVersion: 1, reason: 'audit test' }, principal);
    
    const logs = await fixture.prisma.auditLog.findMany({ where: { action: 'ORDER_VOIDED', entityId: order.id } });
    expect(logs).toHaveLength(1);
    expect((logs[0].afterState as Record<string, unknown>).reason).toBe('audit test');
    expect((logs[0].afterState as Record<string, unknown>).status).toBe('VOIDED');
    expect((logs[0].beforeState as Record<string, unknown>).status).toBe('DRAFT');
  });
});
