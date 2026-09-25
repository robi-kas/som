import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import request from 'supertest';

describe('Phase 3J Reports (e2e)', () => {
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

    const org = await fixture.prisma.organization.create({
      data: { id: orgId, name: orgId, slug: orgId }
    });
    const branch = await fixture.prisma.branch.create({
      data: { id: branchId, organizationId: org.id, name: 'B1' }
    });
    const user = await fixture.prisma.user.create({
      data: { id: userId, organizationId: org.id, username: userId, passwordHash: 'pwd' }
    });

    const sessionToken = crypto.randomBytes(16).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
    await fixture.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 1000000)
      }
    });
    authToken = sessionToken;

    const role = await fixture.prisma.role.create({
      data: {
        organizationId: org.id,
        name: 'Manager',
        rolePermissions: {
          create: ['report.view', 'report.view_financial'].map(p => ({
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
      data: { userId: user.id, branchId: branch.id }
    });
    await fixture.prisma.userRole.create({
      data: {
        userId: user.id,
        roleId: role.id
      }
    });
  });

  it('REPORT-E2E-001: GET /api/v1/reports/daily-sales → 200 with expected fields', async () => {
    const res = await request(fixture.app.getHttpServer())
      .get(`/api/v1/reports/daily-sales?branchId=${branchId}&date=2026-09-19`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('grossSales');
    expect(res.body).toHaveProperty('netSales');
    expect(res.body).toHaveProperty('cashSales');
    expect(res.body).toHaveProperty('digitalSales');
  });

  it('REPORT-E2E-002: GET /api/v1/reports/dashboard → 200 with expected keys', async () => {
    const res = await request(fixture.app.getHttpServer())
      .get(`/api/v1/reports/dashboard?branchId=${branchId}`)
      .set('Authorization', `Bearer ${authToken}`);
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('todaySales');
    expect(res.body).toHaveProperty('openOrdersCount');
  });

  it('REPORT-E2E-003: missing report.view_financial permission → 403', async () => {
    const noPermUser = await fixture.prisma.user.create({
      data: { organizationId: orgId, username: 'noperm', passwordHash: 'pwd' }
    });
    const noPermToken = crypto.randomBytes(16).toString('hex');
    const noPermHash = crypto.createHash('sha256').update(noPermToken).digest('hex');
    await fixture.prisma.session.create({
      data: { userId: noPermUser.id, tokenHash: noPermHash, expiresAt: new Date(Date.now() + 1000000) }
    });

    const res = await request(fixture.app.getHttpServer())
      .get(`/api/v1/reports/daily-sales?branchId=${branchId}&date=2026-09-19`)
      .set('Authorization', `Bearer ${noPermToken}`);
    
    expect(res.status).toBe(403);
  });
});
