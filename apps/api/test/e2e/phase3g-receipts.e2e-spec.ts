import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import request from 'supertest';

describe('Phase 3G Receipts (e2e)', () => {
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
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 3600000),
      }
    });
    authToken = sessionToken;

    const role = await fixture.prisma.role.create({
      data: {
        organizationId: org.id,
        name: 'Manager',
        rolePermissions: {
          create: ['receipt.view', 'receipt.reprint'].map(p => ({
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

  it('RECEIPT-E2E-001: GET /api/v1/receipts/:id returns receipt', async () => {
    const order = await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId, waiterId: userId, orderNumber: 'ORD-1', currency: 'USD', totalAmount: 50, subtotal: 50, taxAmount: 0 }
    });
    const payment = await fixture.prisma.payment.create({
      data: { organizationId: orgId, orderId: order.id, method: 'CASH', currency: 'USD', tenderedAmount: 50, appliedAmount: 50, status: 'CONFIRMED', receivedById: userId, refundableAmount: 50, changeAmount: 0 }
    });
    const receipt = await fixture.prisma.receipt.create({
      data: {
        organizationId: orgId, branchId, orderId: order.id, paymentId: payment.id, receiptNumber: 'RCP-' + crypto.randomBytes(4).toString('hex'),
        content: { total: 50 }
      }
    });

    const res = await request(fixture.app.getHttpServer())
      .get(`/api/v1/receipts/${receipt.id}`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(receipt.id);
  });

  it('RECEIPT-E2E-002: POST /api/v1/receipts/:id/reprint marks REPRINT', async () => {
    const order = await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId, waiterId: userId, orderNumber: 'ORD-1', currency: 'USD', totalAmount: 50, subtotal: 50, taxAmount: 0 }
    });
    const payment = await fixture.prisma.payment.create({
      data: { organizationId: orgId, orderId: order.id, method: 'CASH', currency: 'USD', tenderedAmount: 50, appliedAmount: 50, status: 'CONFIRMED', receivedById: userId, refundableAmount: 50, changeAmount: 0 }
    });
    const receipt = await fixture.prisma.receipt.create({
      data: {
        organizationId: orgId, branchId, orderId: order.id, paymentId: payment.id, receiptNumber: 'RCP-' + crypto.randomBytes(4).toString('hex'),
        content: { total: 50 }
      }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/receipts/${receipt.id}/reprint`)
      .set('Authorization', `Bearer ${authToken}`)
      .set('Idempotency-Key', 'idemp-reprint-2')
      .send({ reason: 'Customer requested another copy' });

    expect(res.status).toBe(200);
    expect(res.body.reprintCount).toBe(1);
    expect(res.body.lastReprintedBy).toBe(userId);
  });

  it('RECEIPT-E2E-003: missing permission -> 403', async () => {
    const user2 = await fixture.prisma.user.create({
      data: { organizationId: orgId, username: 'u2-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    const sessionToken2 = crypto.randomBytes(16).toString('hex');
    const tokenHash2 = crypto.createHash('sha256').update(sessionToken2).digest('hex');
    await fixture.prisma.session.create({
      data: { userId: user2.id, tokenHash: tokenHash2, expiresAt: new Date(Date.now() + 3600000) }
    });

    const res = await request(fixture.app.getHttpServer())
      .get(`/api/v1/receipts/dummy-id`)
      .set('Authorization', `Bearer ${sessionToken2}`);

    expect(res.status).toBe(403);
  });
});
