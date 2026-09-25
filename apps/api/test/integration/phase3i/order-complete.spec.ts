import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import * as crypto from 'crypto';
import { OrdersService } from '../../../src/orders/orders.service.js';
import { RefundsService } from '../../../src/refunds/refunds.service.js';
import { Prisma } from '@prisma/client';
import { ConflictException } from '@nestjs/common';

describe('Phase 3I Order Completion Integration', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let userId: string;
  let principal: any;
  let ordersService: OrdersService;
  let refundsService: RefundsService;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    ordersService = fixture.app.get(OrdersService);
    refundsService = fixture.app.get(RefundsService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
    const org = await fixture.prisma.organization.create({
      data: { name: 'org-' + crypto.randomBytes(4).toString('hex'), slug: 'o-' + crypto.randomBytes(4).toString('hex') }
    });
    orgId = org.id;

    const branch = await fixture.prisma.branch.create({
      data: { organization: { connect: { id: orgId } }, name: 'B1' }
    });
    branchId = branch.id;

    const user = await fixture.prisma.user.create({
      data: { organization: { connect: { id: orgId } }, username: 'u-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    userId = user.id;

    principal = {
      userId,
      organizationId: orgId,
      branchIds: [branchId],
      permissions: ['order.create', 'order.submit', 'order.edit', 'order.complete', 'refund.create', 'refund.confirm'],
    };
  });

  async function createReadyOrder(paymentStatus = 'PAID', tableStatus = 'OCCUPIED') {
    const table = await fixture.prisma.table.create({
      data: { organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, name: 'T1', status: tableStatus, capacity: 4 }
    });
    
    const cat = await fixture.prisma.category.create({ data: { organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, name: 'Cat', displayOrder: 1 } });
    const product = await fixture.prisma.product.create({
      data: { organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, name: 'Coffee', sellingPrice: 5, category: { connect: { id: cat.id } } }
    });

    const order = await fixture.prisma.order.create({
      data: {
        organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, table: { connect: { id: table.id } }, waiter: { connect: { id: userId } },
        status: 'SERVED', paymentStatus, orderNumber: 'ORD-' + crypto.randomBytes(4).toString('hex'),
        subtotal: 5, discountAmount: 0, serviceChargeAmount: 0, taxAmount: 0, totalAmount: 5,
        taxConfigSnapshot: {}, serviceChargeConfigSnapshot: {}, version: 1, currency: 'USD',
        items: {
          create: [{
            organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, productId: product.id,
            productNameSnapshot: 'Coffee',
            quantity: 1,
            unitPriceSnapshot: 5,
            status: 'SERVED',
          }]
        }
      }
    });
    return { order, table };
  }

  it('COMP-INT-001: full happy path -> completed, table AVAILABLE', async () => {
    const { order, table } = await createReadyOrder();

    const res = await ordersService.completeOrder(order.id, principal);
    expect(res.status).toBe('COMPLETED');

    const updatedTable = await fixture.prisma.table.findUnique({ where: { id: table.id } });
    expect(updatedTable!.status).toBe('AVAILABLE');
  });

  it('COMP-INT-002: rejects unpaid', async () => {
    const { order } = await createReadyOrder('UNPAID');
    await expect(ordersService.completeOrder(order.id, principal)).rejects.toThrow(ConflictException);
  });

  it('COMP-INT-003: rejects with pending refund', async () => {
    const { order } = await createReadyOrder('PAID');
    const payment = await fixture.prisma.payment.create({
      data: {
        organizationId: orgId,
        order: { connect: { id: order.id } },
        tenderedAmount: 5, appliedAmount: 5, currency: 'USD', method: 'CASH', status: 'COMPLETED', receivedBy: { connect: { id: userId } }
      }
    });
    await fixture.prisma.refund.create({
      data: {
        organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } },
        order: { connect: { id: order.id } },
        payment: { connect: { id: payment.id } },
        amount: 5, method: 'CASH', status: 'PENDING', reason: 'r', initiatedBy: { connect: { id: userId } }
      }
    });

    await expect(ordersService.completeOrder(order.id, principal)).rejects.toThrow(ConflictException);
  });

  it('COMP-INT-004: concurrent completion (one wins)', async () => {
    const { order } = await createReadyOrder();

    const p1 = ordersService.completeOrder(order.id, principal);
    const p2 = ordersService.completeOrder(order.id, principal);

    const results = await Promise.allSettled([p1, p2]);
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('COMP-INT-005: cross-org rejection', async () => {
    const { order } = await createReadyOrder();
    
    const principal2 = { ...principal, organizationId: 'dummy-org' };
    await expect(ordersService.completeOrder(order.id, principal2)).rejects.toThrow('Cannot access order');
  });
});
