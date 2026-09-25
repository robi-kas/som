import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { OrdersService } from '../../../src/orders/orders.service.js';

describe('Phase 4C Cashier POS - Orders List', () => {
  let fixture: IntegrationTestFixture;
  let ordersService: OrdersService;
  
  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    ordersService = fixture.app.get(OrdersService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  it('GET /orders returns only the caller branch', async () => {
    const orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    const branch1 = `b1-${crypto.randomBytes(4).toString('hex')}`;
    const branch2 = `b2-${crypto.randomBytes(4).toString('hex')}`;
    
    await fixture.prisma.organization.create({ data: { id: orgId, name: 'Org', slug: orgId } });
    await fixture.prisma.branch.create({ data: { id: branch1, organizationId: orgId, name: 'B1' } });
    await fixture.prisma.branch.create({ data: { id: branch2, organizationId: orgId, name: 'B2' } });

    await fixture.prisma.order.create({ data: { id: crypto.randomUUID(), orderNumber: 'O1', organizationId: orgId, branchId: branch1, currency: 'ETB', paymentStatus: 'UNPAID' } });
    await fixture.prisma.order.create({ data: { id: crypto.randomUUID(), orderNumber: 'O2', organizationId: orgId, branchId: branch2, currency: 'ETB', paymentStatus: 'UNPAID' } });

    const principal = { userId: 'u', sessionId: 's', organizationId: orgId, branchIds: [branch1], permissions: [] };
    const res = await ordersService.findAll({ branchId: branch1, limit: 10 }, principal as any);
    
    expect(res).toHaveLength(1);
    expect(res[0].orderNumber).toBe('O1');
  });

  it('GET /orders?paymentStatus=UNPAID filters correctly', async () => {
    const orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    const branchId = `b-${crypto.randomBytes(4).toString('hex')}`;
    await fixture.prisma.organization.create({ data: { id: orgId, name: 'Org', slug: orgId } });
    await fixture.prisma.branch.create({ data: { id: branchId, organizationId: orgId, name: 'B' } });
    
    await fixture.prisma.order.create({ data: { id: crypto.randomUUID(), orderNumber: 'O1', organizationId: orgId, branchId, currency: 'ETB', paymentStatus: 'UNPAID' } });
    await fixture.prisma.order.create({ data: { id: crypto.randomUUID(), orderNumber: 'O2', organizationId: orgId, branchId, currency: 'ETB', paymentStatus: 'PAID' } });

    const principal = { userId: 'u', sessionId: 's', organizationId: orgId, branchIds: [branchId], permissions: [] };
    const res = await ordersService.findAll({ branchId, paymentStatus: 'UNPAID', limit: 10 }, principal as any);
    
    expect(res).toHaveLength(1);
    expect(res[0].orderNumber).toBe('O1');
    expect(res[0].paymentStatus).toBe('UNPAID');
  });

  it('GET /orders rejects cross-branch branchId with 403', async () => {
    const principal = { userId: 'u', sessionId: 's', organizationId: crypto.randomUUID(), branchIds: ['b1'], permissions: [] };
    await expect(ordersService.findAll({ branchId: 'b2', limit: 10 }, principal as any)).rejects.toThrow('No access to this branch');
  });
});
