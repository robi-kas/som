import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import request from 'supertest';
import { Prisma } from '@prisma/client';

describe('Phase 3F Shifts (e2e)', () => {
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
    await fixture.prisma.branchConfiguration.create({
      data: { branchId: branch.id, currency: 'USD', varianceTolerance: 10 }
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
          create: ['shift.open', 'shift.close', 'shift.approve_variance', 'shift.view_report'].map(p => ({
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
    await fixture.prisma.userBranch.create({ data: { userId, branchId } }); await fixture.prisma.userRole.create({
      data: { userId, roleId: role.id }
    });
  });

  it('SHIFT-CLOSE-E2E-001: POST /api/v1/shifts/:id/close -> Auto-closes within tolerance', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ cashCounts: [{ value: 100, count: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.shift.status).toBe('CLOSED');
    expect(res.body.reconciliation.status).toBe('APPROVED');
  });

  it('SHIFT-CLOSE-E2E-002: POST /api/v1/shifts/:id/close -> CLOSING state if variance > tolerance', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ cashCounts: [{ value: 120, count: 1 }] }); // +20 variance, tolerance is 10

    expect(res.status).toBe(200);
    expect(res.body.shift.status).toBe('CLOSING');
    expect(res.body.reconciliation.status).toBe('PENDING');
  });

  it('SHIFT-CLOSE-E2E-003: POST /api/v1/shifts/:id/approve-variance -> Successfully approves variance', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    await request(fixture.app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ cashCounts: [{ value: 120, count: 1 }] });

    const approveRes = await request(fixture.app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/approve-variance`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'Approved variance' });

    expect(approveRes.status).toBe(200);
    expect(approveRes.body.status).toBe('CLOSED');
  });

  it('SHIFT-CLOSE-E2E-004: GET /api/v1/shifts/:id/report -> Returns shift report', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    await request(fixture.app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ cashCounts: [{ value: 100, count: 1 }] });

    const reportRes = await request(fixture.app.getHttpServer())
      .get(`/api/v1/shifts/${shift.id}/report`)
      .set('Authorization', `Bearer ${authToken}`);

    expect(reportRes.status).toBe(200);
    expect(reportRes.body.shift.id).toBe(shift.id);
    expect(reportRes.body.reconciliation.status).toBe('APPROVED');
    expect(reportRes.body.cashCounts).toBeDefined();
    expect(reportRes.body.cashCounts[0].amount).toBe(100);
  });

  it('SHIFT-CLOSE-E2E-005: POST /api/v1/shifts/:id/close -> Denies without shift.close permission', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    const user2 = await fixture.prisma.user.create({
      data: { organizationId: orgId, username: 'u2-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    const sessionToken2 = crypto.randomBytes(16).toString('hex');
    const tokenHash2 = crypto.createHash('sha256').update(sessionToken2).digest('hex');
    await fixture.prisma.session.create({
      data: { userId: user2.id, tokenHash: tokenHash2, expiresAt: new Date(Date.now() + 3600000) }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/shifts/${shift.id}/close`)
      .set('Authorization', `Bearer ${sessionToken2}`)
      .send({ cashCounts: [{ value: 100, count: 1 }] });

    expect(res.status).toBe(403);
  });
});
