import { getIntegrationFixture } from '../fixture.js';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { OrdersService } from '../../../src/orders/orders.service.js';
import { PrismaService } from '../../../src/prisma/prisma.service.js';
import { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';

describe('Phase 3C Orders Remediation Integration', () => {
  let prisma: PrismaClient;
  let prismaService: PrismaService;
  let ordersService: OrdersService;

  beforeAll(async () => {
    const fixture = await getIntegrationFixture();
    prismaService = fixture.prisma;
    prisma = fixture.prisma as unknown as PrismaClient;
    ordersService = fixture.app.get(OrdersService);
  });

  

  it('ORD-DB-018: order create stores the correct waiterId when the caller is not an employee record', async () => {
    const org = await prisma.organization.create({ data: { name: 'Remediation Org', slug: 'remed-org-018' } });
    const user = await prisma.user.create({ data: { username: 'waiter_018', passwordHash: 'hash', organizationId: org.id } });
    const branch = await prisma.branch.create({ data: { name: 'Branch 018', organizationId: org.id } });
    
    await prisma.branchConfiguration.create({
      data: { branchId: branch.id, taxRate: 15, isTaxInclusive: false, serviceChargeRate: 10, roundingMode: 'HALF_UP', currency: 'USD' }
    });

    const principal: AuthenticatedPrincipal = { userId: user.id, organizationId: org.id, branchIds: [branch.id], permissions: ['order.create'] };

    const orderDto = await ordersService.createDraftOrder({ branchId: branch.id, type: 'DINE_IN' }, principal);
    
    const dbOrder = await prisma.order.findUnique({ where: { id: orderDto.id } });
    expect(dbOrder!.waiterId).toBe(user.id);
  });

  it('ORD-DB-019: order number is generated, unique per branch, monotonic per day', async () => {
    const org = await prisma.organization.create({ data: { name: 'Remediation Org', slug: 'remed-org-019' } });
    const user = await prisma.user.create({ data: { username: 'waiter_019', passwordHash: 'hash', organizationId: org.id } });
    const branch = await prisma.branch.create({ data: { name: 'Branch 019', organizationId: org.id } });
    
    await prisma.branchConfiguration.create({
      data: { branchId: branch.id, taxRate: 15, isTaxInclusive: false, serviceChargeRate: 10, roundingMode: 'HALF_UP', currency: 'USD' }
    });

    const principal: AuthenticatedPrincipal = { userId: user.id, organizationId: org.id, branchIds: [branch.id], permissions: ['order.create'] };

    const order1 = await ordersService.createDraftOrder({ branchId: branch.id, type: 'DINE_IN' }, principal);
    const order2 = await ordersService.createDraftOrder({ branchId: branch.id, type: 'DINE_IN' }, principal);

    expect(order1.orderNumber).toMatch(/ORD-\d{8}-\d{4}/);
    expect(order2.orderNumber).toMatch(/ORD-\d{8}-\d{4}/);
    expect(order1.orderNumber).not.toEqual(order2.orderNumber);
    expect(order1.branchId).toEqual(order2.branchId);
  });

  it('ORD-DB-020: order config snapshots match branch config at create time', async () => {
    const org = await prisma.organization.create({ data: { name: 'Remediation Org', slug: 'remed-org-020' } });
    const user = await prisma.user.create({ data: { username: 'waiter_020', passwordHash: 'hash', organizationId: org.id } });
    const branch = await prisma.branch.create({ data: { name: 'Branch 020', organizationId: org.id } });
    
    await prisma.branchConfiguration.create({
      data: { branchId: branch.id, taxRate: 12.5, isTaxInclusive: true, serviceChargeRate: 8, roundingMode: 'HALF_UP', currency: 'USD' }
    });

    const principal: AuthenticatedPrincipal = { userId: user.id, organizationId: org.id, branchIds: [branch.id], permissions: ['order.create'] };

    const orderDto = await ordersService.createDraftOrder({ branchId: branch.id, type: 'DINE_IN' }, principal);
    
    const dbOrder = await prisma.order.findUnique({ where: { id: orderDto.id } });
    
    const taxSnap = dbOrder!.taxConfigSnapshot as Record<string, any>;
    expect(taxSnap.taxRate).toBe('12.5');
    expect(taxSnap.isTaxInclusive).toBe(true);

    const serviceSnap = dbOrder!.serviceChargeConfigSnapshot as Record<string, any>;
    expect(serviceSnap.rate).toBe('8');
  });

  it('ORD-DB-021: handles concurrent order creation safely', async () => {
    const org = await prisma.organization.create({ data: { name: 'Remediation Org', slug: 'remed-org-021' } });
    const user = await prisma.user.create({ data: { username: 'waiter_021', passwordHash: 'hash', organizationId: org.id } });
    const branch = await prisma.branch.create({ data: { name: 'Branch 021', organizationId: org.id } });
    
    await prisma.branchConfiguration.create({
      data: { branchId: branch.id, taxRate: 15, isTaxInclusive: false, serviceChargeRate: 10, roundingMode: 'HALF_UP', currency: 'USD' }
    });

    const principal: AuthenticatedPrincipal = { userId: user.id, organizationId: org.id, branchIds: [branch.id], permissions: ['order.create'] };

    const promises = Array.from({ length: 10 }).map(() => 
       ordersService.createDraftOrder({ branchId: branch.id, type: 'DINE_IN' }, principal)
    );

    const results = await Promise.all(promises);
    
    const orderNumbers = new Set(results.map(r => r.orderNumber));
    expect(orderNumbers.size).toBe(10);
  });
});
