import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';

describe('Phase 3E Voids (e2e)', () => {
  let app: INestApplication;
  let fixture: IntegrationTestFixture;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    app = fixture.app;
  }, 60000);

  afterAll(async () => {
    await fixture.app.close();
  });

  async function createE2EState(opts: { permissions?: string[] } = {}) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    
    const orgSlug = crypto.randomBytes(4).toString('hex');
    const org = await fixture.prisma.organization.create({ data: { name: `org-${orgSlug}`, slug: `o-${orgSlug}` } });
    const branch = await fixture.prisma.branch.create({ data: { organizationId: org.id, name: 'B1' } });
    
    const role = await fixture.prisma.role.create({ data: { organizationId: org.id, name: 'CASHIER' } });
    const permsToCreate = opts.permissions ?? ['order.void', 'order.view'];
    
    for (const p of permsToCreate) {
      let dbPerm = await fixture.prisma.permission.findUnique({ where: { code: p } });
      if (!dbPerm) dbPerm = await fixture.prisma.permission.create({ data: { code: p, description: p } });
      await fixture.prisma.rolePermission.create({ data: { roleId: role.id, permissionId: dbPerm.id } });
    }

    const user = await fixture.prisma.user.create({
      data: {
        organizationId: org.id,
        username: `u-${crypto.randomBytes(4).toString('hex')}`,
        passwordHash: 'secret',
        userRoles: { create: { roleId: role.id } },
        userBranches: { create: { branchId: branch.id } }
      }
    });

    await fixture.prisma.session.create({
      data: { tokenHash, userId: user.id, expiresAt: new Date(Date.now() + 3600000) }
    });

    const order = await fixture.prisma.order.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        type: 'DINE_IN',
        totalAmount: '10.00',
        version: 1,
        orderNumber: `ORD-${crypto.randomBytes(4).toString('hex')}`,
        currency: 'ETB'
      }
    });

    return { org, user, token: rawToken, order };
  }

  it('E2E-VOID-001 POST /orders/:id/void -> 200 VOIDED', async () => {
    const { token, order } = await createE2EState();
    
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1, reason: 'mistake' });
      
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('VOIDED');
  });

  it('E2E-VOID-002 Void a paid order -> 409 ORDER_HAS_PAYMENTS', async () => {
    const { token, order, org, user } = await createE2EState();
    
    await fixture.prisma.payment.create({
      data: { organizationId: org.id, orderId: order.id, method: 'CASH', currency: 'ETB', tenderedAmount: '10.00', appliedAmount: '10.00', refundableAmount: '10.00', status: 'CONFIRMED', receivedById: user.id, version: 1 }
    });

    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1, reason: 'paid' });
      
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('ORDER_HAS_PAYMENTS');
  });

  it('E2E-VOID-003 Void without reason -> 400', async () => {
    const { token, order } = await createE2EState();
    
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1 }); // Missing reason
      
    expect(res.status).toBe(400);
  });

  it('E2E-VOID-004 Void without order.void permission -> 403', async () => {
    const { token, order } = await createE2EState({ permissions: [] });
    
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .send({ expectedVersion: 1, reason: 'test' });
      
    expect(res.status).toBe(403);
  });

  it('E2E-VOID-005 Idempotency replay returns same VoidRecord', async () => {
    const { token, order } = await createE2EState();
    const ik = `idem-${Date.now()}`;
    
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', ik)
      .send({ expectedVersion: 1, reason: 'mistake' });
      
    expect(res1.status).toBe(200);
    
    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/void`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', ik)
      .send({ expectedVersion: 1, reason: 'mistake' });
      
    expect(res2.status).toBe(200);
    expect(res2.body.id).toBe(res1.body.id);
  });
});
