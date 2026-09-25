import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import * as crypto from 'crypto';
import { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';
import { PrinterJobsService } from '../../../src/printers/printer-jobs.service.js';
import { PRINTER_TRANSPORT } from '../../../src/printers/printers.transport.js';
import { MockPrinterTransport } from '../../helpers/mock-printers.transport.js';
import { ConflictException } from '@nestjs/common';

describe('Phase 3H Printer Jobs Integration', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let userId: string;
  let principal: AuthenticatedPrincipal;
  let printerJobsService: PrinterJobsService;
  let transport: MockPrinterTransport;
  let printerId: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    printerJobsService = fixture.app.get(PrinterJobsService);
    transport = fixture.app.get(PRINTER_TRANSPORT);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
    transport.shouldFail = false;
    const org = await fixture.prisma.organization.create({
      data: { name: 'org-' + crypto.randomBytes(4).toString('hex'), slug: 'o-' + crypto.randomBytes(4).toString('hex') }
    });
    orgId = org.id;

    const branch = await fixture.prisma.branch.create({
      data: { organizationId: orgId, name: 'B1' }
    });
    branchId = branch.id;

    const user = await fixture.prisma.user.create({
      data: { organizationId: orgId, username: 'u-' + crypto.randomBytes(4).toString('hex'), passwordHash: 'dummy' }
    });
    userId = user.id;

    const station = await fixture.prisma.kitchenStation.create({
      data: { organizationId: orgId, branchId, name: 'Kitchen 1' }
    });

    const printer = await fixture.prisma.printer.create({
      data: { stationId: station.id, name: 'Printer 1', ipAddress: '192.168.1.10' }
    });
    printerId = printer.id;

    principal = {
      userId,
      organizationId: orgId,
      branchIds: [branchId],
      permissions: ['printer.retry', 'printer.reprint', 'printer.view'],
    };
  });

  it('PRINTER-INT-001: enqueue creates QUEUED', async () => {
    const job = await fixture.prisma.printerJob.create({
      data: { printerId, ticketType: 'ORDER', payload: { foo: 'bar' }, status: 'PENDING' }
    });

    // Replace dispatch to avoid state change during test
    const origDispatch = printerJobsService.dispatch;
    printerJobsService.dispatch = async () => {};

    const updated = await printerJobsService.enqueue(job.id);
    expect(updated.status).toBe('QUEUED');

    printerJobsService.dispatch = origDispatch.bind(printerJobsService);
  });

  it('PRINTER-INT-002: dispatch marks PRINTED', async () => {
    const job = await fixture.prisma.printerJob.create({
      data: { printerId, ticketType: 'ORDER', payload: { foo: 'bar' }, status: 'QUEUED' }
    });

    const updated = await printerJobsService.dispatch(job.id);
    expect(updated.status).toBe('PRINTED');
    expect(updated.printedAt).toBeDefined();
  });

  it('PRINTER-INT-003: retry after failure', async () => {
    const job = await fixture.prisma.printerJob.create({
      data: { printerId, ticketType: 'ORDER', payload: { foo: 'bar' }, status: 'FAILED' }
    });
    
    // Replace dispatch to just see it queuing
    const origDispatch = printerJobsService.dispatch;
    printerJobsService.dispatch = async () => {};

    const updated = await printerJobsService.retry(job.id, principal);
    expect(updated.status).toBe('QUEUED');
    expect(updated.attemptCount).toBe(1);

    printerJobsService.dispatch = origDispatch.bind(printerJobsService);
  });

  it('PRINTER-INT-004: reprint creates new job', async () => {
    const job = await fixture.prisma.printerJob.create({
      data: { printerId, ticketType: 'ORDER', payload: { foo: 'bar' }, status: 'PRINTED' }
    });

    // Replace dispatch
    const origDispatch = printerJobsService.dispatch;
    printerJobsService.dispatch = async () => {};

    const newJob = await printerJobsService.reprint(job.id, principal);
    expect(newJob.id).not.toBe(job.id);
    expect(newJob.isReprint).toBe(true);
    expect(newJob.status).toBe('QUEUED');

    printerJobsService.dispatch = origDispatch.bind(printerJobsService);
  });
});
