import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import request from 'supertest';
import * as crypto from 'crypto';
import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';

describe('Phase 3K Sync (e2e)', () => {
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
    orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    branchId = `b1-${crypto.randomBytes(4).toString('hex')}`;
    userId = `u1-${crypto.randomBytes(4).toString('hex')}`;

    const org = await fixture.prisma.organization.create({ data: { id: orgId, name: orgId, slug: orgId } });
    const branch = await fixture.prisma.branch.create({ data: { id: branchId, organizationId: orgId, name: 'B1' } });
    await fixture.prisma.branchConfiguration.create({ data: { branchId, currency: 'USD', taxRate: 10 } });
    const user = await fixture.prisma.user.create({ data: { id: userId, organizationId: orgId, username: userId, passwordHash: 'pwd' } });

    const sessionToken = crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await fixture.prisma.session.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 1000000) }
    });
    authToken = sessionToken;

    const role = await fixture.prisma.role.create({
      data: {
        organizationId: orgId, name: 'Manager',
        rolePermissions: {
          create: ['sync.submit', 'sync.view', 'sync.resolve_conflict'].map(p => ({
            permission: { connectOrCreate: { where: { code: p }, create: { code: p, description: p } } }
          }))
        }
      }
    });
    await fixture.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    await fixture.prisma.userBranch.create({ data: { userId: user.id, branchId: branch.id } });
  });

  it('SYNC-E2E-001: POST /api/v1/sync/batch with one event -> 201 with status array', async () => {
    const table = await fixture.prisma.table.create({ data: { organizationId: orgId, branchId, name: 'T1', capacity: 2, status: 'AVAILABLE' } });
    const cat = await fixture.prisma.category.create({ data: { organizationId: orgId, branchId, name: 'Cat', displayOrder: 1 } });
    const prod = await fixture.prisma.product.create({ data: { organizationId: orgId, branchId, categoryId: cat.id, name: 'Prod', sellingPrice: 10 } });

    const payload = {
      events: [{
        localEventId: 'evt1', entityType: 'Order', entityId: 'tmp1', eventType: 'ORDER_SUBMITTED',
        payload: { branchId, tableId: table.id, items: [{ productId: prod.id, quantity: 1 }] },
        clientTimestamp: new Date().toISOString()
      }]
    };

    const res = await request(fixture.app.getHttpServer())
      .post('/api/v1/sync/batch')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-device-id', 'dev_t1')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.length).toBe(1);
    expect(res.body[0].syncStatus).toBe('SYNCED');
  });

  it('SYNC-E2E-002: POST /api/v1/sync/batch with duplicate localEventId -> same response, one order', async () => {
    const table = await fixture.prisma.table.create({ data: { organizationId: orgId, branchId, name: 'T2', capacity: 2, status: 'AVAILABLE' } });
    const cat = await fixture.prisma.category.create({ data: { organizationId: orgId, branchId, name: 'Cat2', displayOrder: 1 } });
    const prod = await fixture.prisma.product.create({ data: { organizationId: orgId, branchId, categoryId: cat.id, name: 'Prod2', sellingPrice: 10 } });

    const payload = {
      events: [{
        localEventId: 'evt2', entityType: 'Order', entityId: 'tmp2', eventType: 'ORDER_SUBMITTED',
        payload: { branchId, tableId: table.id, items: [{ productId: prod.id, quantity: 1 }] },
        clientTimestamp: new Date().toISOString()
      }]
    };

    const res1 = await request(fixture.app.getHttpServer()).post('/api/v1/sync/batch').set('Authorization', `Bearer ${authToken}`).set('x-device-id', 'dev_t2').send(payload);
    expect(res1.status).toBe(201);
    
    const res2 = await request(fixture.app.getHttpServer()).post('/api/v1/sync/batch').set('Authorization', `Bearer ${authToken}`).set('x-device-id', 'dev_t2').send(payload);
    expect(res2.status).toBe(201);
    expect(res2.body[0].serverEntityId).toBe(res1.body[0].serverEntityId);

    const orders = await fixture.prisma.order.findMany({ where: { deviceId: 'dev_t2' } });
    expect(orders.length).toBe(1);
  });

  it('SYNC-E2E-003: POST /api/v1/payments/:id/confirm with X-Offline-Mode: true -> 409', async () => {
    // Just hitting the endpoint with the header should be rejected by the guard immediately, before any DB calls
    const res = await request(fixture.app.getHttpServer())
      .post('/api/v1/payments/some-id/confirm')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-offline-mode', 'true')
      .send({});
      
    // Even if permission or payment is missing, the guard runs early. But wait, AuthGuard/PermissionsGuard run before. 
    // We don't have payment.confirm permission in the E2E seed, but let's see which throws first.
    // If it throws 403 because of permissions, we can add the permission.
    // Let's add permission just in case
    await fixture.prisma.rolePermission.create({
      data: {
        role: { connect: { id: (await fixture.prisma.userRole.findFirst({ where: { userId } }))!.roleId } },
        permission: { connectOrCreate: { where: { code: 'payment.confirm' }, create: { code: 'payment.confirm', description: 'payment.confirm' } } }
      }
    });

    const res2 = await request(fixture.app.getHttpServer())
      .post('/api/v1/payments/some-id/confirm')
      .set('Authorization', `Bearer ${authToken}`)
      .set('x-offline-mode', 'true')
      .send({});
      
    expect(res2.status).toBe(409);
    expect(res2.body.message).toBe('OFFLINE_NOT_ALLOWED_FOR_OPERATION');
  });
});
