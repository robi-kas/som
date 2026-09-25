import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ForbiddenException, ConflictException } from '@nestjs/common';
import { PrinterJobsService } from './printer-jobs.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

describe('PrinterJobsService (Unit)', () => {
  let prisma: PrismaMock;
  let transport: { send: ReturnType<typeof vi.fn> };
  let service: PrinterJobsService;
  const principal = { userId: 'u1', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: ['printer.retry', 'printer.reprint', 'printer.view'] };
  const job = (over: Record<string, unknown> = {}) => ({
    id: 'job1',
    printerId: 'p1',
    status: 'FAILED',
    attemptCount: 1,
    payload: { kind: 'KITCHEN_TICKET', table: 'T1', items: [] },
    printer: { id: 'p1', branchId: 'b1', name: 'Kitchen' },
    ...over,
  });

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    prisma.branch.findUnique.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    prisma.printer.findUnique.mockResolvedValue({ id: 'p1', branchId: 'b1', status: 'UNKNOWN', lastSeenAt: null, lastError: null, branch: { organizationId: 'org1' } });
    transport = { send: vi.fn() };
    service = new PrinterJobsService(prisma as never, transport);
  });
  afterEach(() => {
    delete process.env.PRINT_MODE;
  });

  it('PRINTER-UNIT-001: dispatch renders ESC/POS and marks the job printed and the printer online', async () => {
    prisma.printerJob.update.mockResolvedValueOnce(job({ status: 'PRINTING' })).mockResolvedValueOnce({ id: 'job1', status: 'PRINTED' });
    transport.send.mockResolvedValueOnce(undefined);

    const result = await service.dispatch('job1');

    expect(transport.send).toHaveBeenCalledWith('p1', expect.any(Buffer));
    expect(result.status).toBe('PRINTED');
    expect(prisma.printer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'ONLINE' }) }));
  });

  it('PRINTER-UNIT-002: dispatch failure sets FAILED and marks the printer offline', async () => {
    prisma.printerJob.update.mockResolvedValueOnce(job({ status: 'PRINTING', attemptCount: 1 })).mockResolvedValueOnce({ id: 'job1', status: 'FAILED' });
    transport.send.mockRejectedValueOnce(new Error('Printer offline'));

    const result = await service.dispatch('job1');

    expect(result.status).toBe('FAILED');
    expect(prisma.printerJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED', errorMessage: 'Printer offline' }) }));
    expect(prisma.printer.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'OFFLINE' }) }));
  });

  it('PRINTER-UNIT-003: a job that keeps failing becomes FAILED_PERMANENT', async () => {
    prisma.printerJob.update.mockResolvedValueOnce(job({ status: 'PRINTING', attemptCount: 5 })).mockResolvedValueOnce({ id: 'job1', status: 'FAILED_PERMANENT' });
    transport.send.mockRejectedValueOnce(new Error('Paper out'));
    await service.dispatch('job1');
    expect(prisma.printerJob.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED_PERMANENT' }) }));
  });

  it('PRINTER-UNIT-004: methods deny access if permissions are missing', async () => {
    const none = { ...principal, permissions: [] };
    await expect(service.getJob('job1', none)).rejects.toThrow(ForbiddenException);
    await expect(service.retry('job1', none)).rejects.toThrow(ForbiddenException);
    await expect(service.reprint('job1', none)).rejects.toThrow(ForbiddenException);
  });

  it('PRINTER-UNIT-005: in agent mode a retry puts the job back in the queue for the agent', async () => {
    prisma.printerJob.findUnique.mockResolvedValue(job());
    prisma.printerJob.update.mockResolvedValue({ id: 'job1', status: 'PENDING' });
    await service.retry('job1', principal);
    expect(prisma.printerJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PENDING' }) }));
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('PRINTER-UNIT-006: only failed jobs can be retried', async () => {
    prisma.printerJob.findUnique.mockResolvedValue(job({ status: 'PRINTED' }));
    await expect(service.retry('job1', principal)).rejects.toThrow(ConflictException);
  });

  it('PRINTER-UNIT-007: the agent only gets jobs for its own branch', async () => {
    prisma.printerJob.findUnique.mockResolvedValue(job({ printer: { id: 'p1', branchId: 'other-branch' } }));
    await expect(service.reportResult({ id: 'a1', branchId: 'b1' }, 'job1', { ok: true })).rejects.toThrow();
  });
});
