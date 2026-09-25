import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import request from 'supertest';

describe('Phase 3I Order Complete (e2e)', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let userId: string;
  let authToken: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
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
      data: { organizationId: org.id, username: 'u1-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    orgId = org.id;
    branchId = branch.id;
    userId = user.id;

    const sessionToken = crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await fixture.prisma.session.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3600000) }
    });
    authToken = sessionToken;

    const role = await fixture.prisma.role.create({
      data: {
        organizationId: org.id,
        name: 'Manager',
        rolePermissions: {
          create: ['order.complete'].map(p => ({
            permission: {
              connectOrCreate: {
                where: { code: p },
                create: { code: p, description: p }
              }
            }
          }))
        }
      }
    });
    await fixture.prisma.userBranch.create({
      data: { userId, branchId }
    });
    await fixture.prisma.userRole.create({
      data: { userId, roleId: role.id }
    });
  });

  async function seedOrder(status = 'SERVED') {
    const table = await fixture.prisma.table.create({
      data: { organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, name: 'T1', status: 'OCCUPIED', capacity: 4 }
    });
    const cat = await fixture.prisma.category.create({ data: { organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, name: 'Cat', displayOrder: 1 } });
    const product = await fixture.prisma.product.create({
      data: { organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, name: 'Coffee', sellingPrice: 5, category: { connect: { id: cat.id } } }
    });
    const order = await fixture.prisma.order.create({
      data: {
        organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, table: { connect: { id: table.id } }, waiter: { connect: { id: userId } },
        status, paymentStatus: 'PAID', orderNumber: 'ORD-' + crypto.randomBytes(4).toString('hex'),
        subtotal: 5, discountAmount: 0, serviceChargeAmount: 0, taxAmount: 0, totalAmount: 5,
        taxConfigSnapshot: {}, serviceChargeConfigSnapshot: {}, version: 1, currency: 'USD',
        items: {
          create: [{
            organization: { connect: { id: orgId } }, branch: { connect: { id: branchId } }, productId: product.id, productNameSnapshot: 'Coffee', quantity: 1, unitPriceSnapshot: 5, status: 'SERVED'
          }]
        }
      }
    });
    return order;
  }

  it('COMP-E2E-001: POST complete returns 200', async () => {
    const order = await seedOrder();
    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send();
    
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('COMPLETED');
  });

  it('COMP-E2E-002: already completed -> 409', async () => {
    const order = await seedOrder('COMPLETED');
    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send();
    
    expect(res.status).toBe(409);
  });

  it('COMP-E2E-003: missing permission -> 403', async () => {
    const order = await seedOrder();
    
    const user2 = await fixture.prisma.user.create({
      data: { organization: { connect: { id: orgId } }, username: 'u2-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    const sessionToken2 = crypto.randomBytes(16).toString('hex');
    const tokenHash2 = crypto.createHash('sha256').update(sessionToken2).digest('hex');
    await fixture.prisma.session.create({
      data: { userId: user2.id, tokenHash: tokenHash2, expiresAt: new Date(Date.now() + 3600000) }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/complete`)
      .set('Authorization', `Bearer ${sessionToken2}`)
      .send();

    expect(res.status).toBe(403);
  });
});
