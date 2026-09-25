import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../../src/app.module.js';
import { getIntegrationFixture, IntegrationTestFixture } from '../integration/fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';

describe('Phase 3E Refunds (e2e)', () => {
  let app: INestApplication;
  let fixture: IntegrationTestFixture;
  
  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    app = fixture.app;
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  async function createE2EState(opts: {
    paymentMethod?: string;
    paymentAmount?: string;
    shiftExpectedCash?: string;
    permissions?: string[];
    isManager?: boolean;
    orgSuffix?: string;
  } = {}) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    
    const orgSlug = opts.orgSuffix ?? crypto.randomBytes(4).toString('hex');
    const org = await fixture.prisma.organization.create({ data: { name: `org-${orgSlug}`, slug: `o-${orgSlug}` } });
    const branch = await fixture.prisma.branch.create({ data: { organizationId: org.id, name: 'B1' } });
    
    const role = await fixture.prisma.role.create({ data: { organizationId: org.id, name: opts.isManager ? 'MANAGER' : 'CASHIER' } });
    const permsToCreate = opts.permissions ?? ['refund.create', 'refund.confirm', 'refund.approve', 'refund.view', 'org.admin'];
    
    for (const p of permsToCreate) {
      let dbPerm = await fixture.prisma.permission.findUnique({ where: { code: p } });
      if (!dbPerm) {
        dbPerm = await fixture.prisma.permission.create({ data: { code: p, description: p } });
      }
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

    const session = await fixture.prisma.session.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    const order = await fixture.prisma.order.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        type: 'DINE_IN',
        totalAmount: opts.paymentAmount ?? '1000.00',
        version: 1,
        orderNumber: `ORD-${crypto.randomBytes(4).toString('hex')}`,
        currency: 'ETB'
      }
    });

    const payment = await fixture.prisma.payment.create({
      data: {
        organizationId: org.id,
        orderId: order.id,
        method: opts.paymentMethod ?? 'CARD',
        currency: 'ETB',
        tenderedAmount: opts.paymentAmount ?? '1000.00',
        appliedAmount: opts.paymentAmount ?? '1000.00',
        refundableAmount: opts.paymentAmount ?? '1000.00',
        status: 'CONFIRMED',
        receivedById: user.id,
        version: 1
      }
    });

    if (opts.shiftExpectedCash) {
      await fixture.prisma.cashierShift.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          cashierId: user.id,
          status: 'OPEN',
          openedAt: new Date(),
          openingFloat: '100.00',
          expectedCash: opts.shiftExpectedCash,
          version: 1
        }
      });
    }

    return { org, branch, user, token: rawToken, order, payment };
  }

  it('E2E-REFUND-001 POST /orders/:id/refunds with valid body -> 201 PENDING', async () => {
    const { token, order, payment } = await createE2EState();
    
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentId: payment.id,
        amount: '100.00',
        method: 'CARD',
        reason: 'E2E-1'
      });
      
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.amount).toBe('100');
  });

  it('E2E-REFUND-002 Missing Idempotency-Key is allowed; duplicate header replays', async () => {
    const { token, order, payment } = await createE2EState();
    
    const reqBody = { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'E2E-2' };
    const ik = `idemp-${Date.now()}`;
    
    const res1 = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', ik)
      .send(reqBody);
      
    expect(res1.status).toBe(201);
    
    const res2 = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', ik)
      .send(reqBody);
      
    expect(res2.status).toBe(201);
    expect(res2.body.id).toBe(res1.body.id);
  });

  it('E2E-REFUND-003 POST with amount > refundable -> 409 REFUND_EXCEEDS_REFUNDABLE', async () => {
    const { token, order, payment } = await createE2EState({ paymentAmount: '500.00' });
    
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentId: payment.id,
        amount: '600.00',
        method: 'CARD',
        reason: 'Too big'
      });
      
    expect(res.status).toBe(409);
    expect(res.body.message).toBe('REFUND_EXCEEDS_REFUNDABLE');
  });

  it('E2E-REFUND-004 POST /refunds/:id/approve by different manager -> 200 APPROVED', async () => {
    const { org, branch, token, order, payment } = await createE2EState();
    
    const initRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'Require approval' });
      
    const refundId = initRes.body.id;

    const mgrRawToken = crypto.randomBytes(32).toString('hex');
    const mgrTokenHash = crypto.createHash('sha256').update(mgrRawToken).digest('hex');
    
    const roleMgr = await fixture.prisma.role.create({ data: { organizationId: org.id, name: 'MANAGER' } });
    let dbPerm = await fixture.prisma.permission.findUnique({ where: { code: 'refund.approve' } });
    if (!dbPerm) dbPerm = await fixture.prisma.permission.create({ data: { code: 'refund.approve', description: 'refund.approve' } });
    await fixture.prisma.rolePermission.create({ data: { roleId: roleMgr.id, permissionId: dbPerm.id } });
    
    const manager = await fixture.prisma.user.create({
      data: {
        organizationId: org.id,
        username: `m-${crypto.randomBytes(4).toString('hex')}`,
        passwordHash: 'secret',
        userRoles: { create: { roleId: roleMgr.id } },
        userBranches: { create: { branchId: branch.id } }
      }
    });
    
    await fixture.prisma.session.create({ data: { tokenHash: mgrTokenHash, userId: manager.id, expiresAt: new Date(Date.now() + 3600000) }});

    const appRes = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${refundId}/approve`)
      .set('Authorization', `Bearer ${mgrRawToken}`)
      .send();
      
    expect(appRes.status).toBe(200);
    expect(appRes.body.status).toBe('APPROVED');
  });

  it('E2E-REFUND-005 POST /refunds/:id/approve by initiator -> 403 SELF_APPROVAL_FORBIDDEN', async () => {
    const { token, order, payment } = await createE2EState();
    
    const initRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'Require approval' });
      
    const appRes = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${initRes.body.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .send();
      
    expect(appRes.status).toBe(403);
    expect(appRes.body.message).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('E2E-REFUND-006 POST /refunds/:id/confirm after approve -> 200 CONFIRMED, payment rolled up', async () => {
    const { token, org, branch, order, payment } = await createE2EState();
    
    const initRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'Require approval' });
      
    const mgrRawToken = crypto.randomBytes(32).toString('hex');
    const mgrTokenHash = crypto.createHash('sha256').update(mgrRawToken).digest('hex');
    const roleMgr = await fixture.prisma.role.create({ data: { organizationId: org.id, name: 'MANAGER2' } });
    let dbPerm = await fixture.prisma.permission.findUnique({ where: { code: 'refund.approve' } });
    if (!dbPerm) dbPerm = await fixture.prisma.permission.create({ data: { code: 'refund.approve', description: 'refund.approve' } });
    await fixture.prisma.rolePermission.create({ data: { roleId: roleMgr.id, permissionId: dbPerm.id } });
    
    const manager = await fixture.prisma.user.create({ data: { organizationId: org.id, username: `m2-${crypto.randomBytes(4).toString('hex')}`, passwordHash: 'secret', userRoles: { create: { roleId: roleMgr.id } }, userBranches: { create: { branchId: branch.id } } }});
    await fixture.prisma.session.create({ data: { tokenHash: mgrTokenHash, userId: manager.id, expiresAt: new Date(Date.now() + 3600000) }});

    await request(app.getHttpServer()).post(`/api/v1/refunds/${initRes.body.id}/approve`).set('Authorization', `Bearer ${mgrRawToken}`).send();

    const confRes = await request(app.getHttpServer())
      .post(`/api/v1/refunds/${initRes.body.id}/confirm`)
      .set('Authorization', `Bearer ${token}`)
      .send();
      
    expect(confRes.status).toBe(200);
    expect(confRes.body.status).toBe('CONFIRMED');

    const pAfter = await fixture.prisma.payment.findUnique({ where: { id: payment.id } });
    expect(pAfter!.refundableAmount.toString()).toBe('400');
  });

  it('E2E-REFUND-007 GET /refunds/:id -> 200', async () => {
    const { token, order, payment } = await createE2EState();
    const initRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T7' });
      
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/refunds/${initRes.body.id}`)
      .set('Authorization', `Bearer ${token}`);
      
    expect(getRes.status).toBe(200);
    expect(getRes.body.id).toBe(initRes.body.id);
  });

  it('E2E-REFUND-008 GET /refunds/:id with wrong organization -> 404', async () => {
    const { token, order, payment } = await createE2EState({ orgSuffix: crypto.randomBytes(4).toString('hex') });
    const { token: tokenB } = await createE2EState({ orgSuffix: crypto.randomBytes(4).toString('hex') });
    
    const initRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T8' });
      
    const getRes = await request(app.getHttpServer())
      .get(`/api/v1/refunds/${initRes.body.id}`)
      .set('Authorization', `Bearer ${tokenB}`);
      
    expect(getRes.status).toBe(404);
  });

  it('E2E-REFUND-009 Unauthenticated request -> 401', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/refunds/some-fake-uuid`);
    expect(res.status).toBe(401);
  });

  it('E2E-REFUND-010 Missing permission -> 403', async () => {
    const { token, order, payment } = await createE2EState({ permissions: [] });
    
    const res = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T10' });
      
    expect(res.status).toBe(403);
  });

  it('E2E-REFUND-011 GET /orders/:orderId/refunds -> 200 with array of refunds', async () => {
    const { token, order, payment } = await createE2EState();
    const initRes = await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T11' });
      
    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`);
      
        expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    expect(listRes.body.length).toBeGreaterThan(0);
    expect(listRes.body[0].id).toBe(initRes.body.id);
  });

  it('E2E-REFUND-012 GET /orders/:orderId/refunds with wrong org -> 404', async () => {
    const { token, order, payment } = await createE2EState({ orgSuffix: crypto.randomBytes(4).toString('hex') });
    const { token: tokenB } = await createE2EState({ orgSuffix: crypto.randomBytes(4).toString('hex') });
    
    await request(app.getHttpServer())
      .post(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T12' });
      
    const listRes = await request(app.getHttpServer())
      .get(`/api/v1/orders/${order.id}/refunds`)
      .set('Authorization', `Bearer ${tokenB}`);
      
    expect(listRes.status).toBe(404);
  });
});
