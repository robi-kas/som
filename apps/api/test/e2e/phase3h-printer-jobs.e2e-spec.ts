import { IntegrationTestFixture, getIntegrationFixture } from '../integration/fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import request from 'supertest';
import { PRINTER_TRANSPORT } from '../../src/printers/printers.transport.js';
import { MockPrinterTransport } from '../helpers/mock-printers.transport.js';

describe('Phase 3H Printer Jobs (e2e)', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let userId: string;
  let authToken: string;
  let printerId: string;

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

    const station = await fixture.prisma.kitchenStation.create({
      data: { organizationId: orgId, branchId, name: 'Kitchen 1' }
    });

    const printer = await fixture.prisma.printer.create({
      data: { stationId: station.id, name: 'Printer 1', ipAddress: '192.168.1.10' }
    });
    printerId = printer.id;

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
          create: ['printer.retry', 'printer.reprint', 'printer.view'].map(p => ({
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

  it('PRINTER-E2E-001: POST /api/v1/printer-jobs/:id/retry endpoint works', async () => {
    const job = await fixture.prisma.printerJob.create({
      data: { printerId, ticketType: 'ORDER', payload: { foo: 'bar' }, status: 'FAILED' }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/printer-jobs/${job.id}/retry`)
      .set('Authorization', `Bearer ${authToken}`)
      .send();

    expect(res.status).toBe(200);
    
    // It's fire-and-forget, so in the DB it could be QUEUED or already PRINTED
    const updated = await fixture.prisma.printerJob.findUnique({ where: { id: job.id } });
    expect(updated!.attemptCount).toBe(1);
  });

  it('PRINTER-E2E-002: POST /api/v1/printer-jobs/:id/reprint marks isReprint', async () => {
    const job = await fixture.prisma.printerJob.create({
      data: { printerId, ticketType: 'ORDER', payload: { foo: 'bar' }, status: 'PRINTED' }
    });

    const res = await request(fixture.app.getHttpServer())
      .post(`/api/v1/printer-jobs/${job.id}/reprint`)
      .set('Authorization', `Bearer ${authToken}`)
      .send();

    expect(res.status).toBe(200);
    expect(res.body.isReprint).toBe(true);
  });

  it('PRINTER-E2E-003: missing permission -> 403', async () => {
    const user2 = await fixture.prisma.user.create({
      data: { organizationId: orgId, username: 'u2-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    const sessionToken2 = crypto.randomBytes(16).toString('hex');
    const tokenHash2 = crypto.createHash('sha256').update(sessionToken2).digest('hex');
    await fixture.prisma.session.create({
      data: { userId: user2.id, tokenHash: tokenHash2, expiresAt: new Date(Date.now() + 3600000) }
    });

    const res = await request(fixture.app.getHttpServer())
      .get(`/api/v1/printer-jobs/dummy-id`)
      .set('Authorization', `Bearer ${sessionToken2}`);

    expect(res.status).toBe(403);
  });
});
