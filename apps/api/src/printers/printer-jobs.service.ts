import { Injectable, Inject, NotFoundException, ConflictException, Logger, Optional, BadRequestException } from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { PRINTER_TRANSPORT } from './printers.transport.js';
import type { PrinterTransport } from './printers.transport.js';
import { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { Prisma } from '@prisma/client';
import { renderPrintJob } from './escpos.js';
import { decodeEscPos } from './escpos-preview.js';

/** Characters per line on the branch's paper (48 = 80 mm, 32 = 58 mm). */
export const printerColumns = () => Number(process.env.PRINTER_COLUMNS ?? 48);
import { EventsService } from '../events/events.service.js';
import { CreatePrinterDto, UpdatePrinterDto, CreatePrintAgentDto, JobResultDto, HeartbeatDto } from './dto/printer.dto.js';

const MAX_ATTEMPTS = 5;
/** A claimed job that hasn't been acknowledged within this time is handed out again. */
const CLAIM_LEASE_MS = 60_000;

export function printMode(): 'agent' | 'direct' {
  return process.env.PRINT_MODE === 'direct' ? 'direct' : 'agent';
}

export function hashAgentKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class PrinterJobsService {
  private readonly logger = new Logger(PrinterJobsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PRINTER_TRANSPORT) private readonly transport: PrinterTransport,
    @Optional() private readonly events?: EventsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Job lifecycle
  // ---------------------------------------------------------------------------

  private async loadJob(jobId: string, principal: AuthenticatedPrincipal) {
    const job = await this.prisma.printerJob.findUnique({ where: { id: jobId }, include: { printer: true } });
    if (!job) throw new NotFoundException('Printer job not found');
    const branch = await this.prisma.branch.findUnique({ where: { id: job.printer.branchId } });
    if (!branch || branch.organizationId !== principal.organizationId) throw new NotFoundException('Printer job not found');
    await assertBranchAccess(this.prisma, principal, job.printer.branchId);
    return job;
  }

  /** In direct mode, send now. In agent mode, leave PENDING for the agent to claim. */
  private kick(jobId: string) {
    if (printMode() === 'direct') {
      this.dispatch(jobId).catch((err) => this.logger.error(`Dispatch error for job ${jobId}`, err));
    }
  }

  async enqueue(jobId: string) {
    const job = await this.prisma.printerJob.update({ where: { id: jobId }, data: { status: 'QUEUED' } });
    this.kick(jobId);
    return job;
  }

  async dispatch(jobId: string) {
    const job = await this.prisma.printerJob.update({
      where: { id: jobId },
      data: { status: 'PRINTING', attemptCount: { increment: 1 }, claimedAt: new Date() },
      include: { printer: true },
    });
    try {
      await this.transport.send(job.printerId, renderPrintJob(job.payload));
      const done = await this.prisma.printerJob.update({
        where: { id: jobId },
        data: { status: 'PRINTED', printedAt: new Date(), errorMessage: null },
      });
      await this.markPrinter(job.printerId, true);
      return done;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const failed = await this.prisma.printerJob.update({
        where: { id: jobId },
        data: { status: job.attemptCount >= MAX_ATTEMPTS ? 'FAILED_PERMANENT' : 'FAILED', errorMessage: message },
      });
      await this.markPrinter(job.printerId, false, message);
      return failed;
    }
  }

  async retry(jobId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.retry');
    const job = await this.loadJob(jobId, principal);
    if (job.status !== 'FAILED' && job.status !== 'FAILED_PERMANENT') {
      throw new ConflictException('Only FAILED jobs can be retried');
    }
    if (job.attemptCount >= MAX_ATTEMPTS + 3) {
      throw new ConflictException('Max retry attempts reached');
    }
    const updated = await this.prisma.printerJob.update({
      where: { id: jobId },
      data: { status: printMode() === 'direct' ? 'QUEUED' : 'PENDING', claimedAt: null },
    });
    this.kick(jobId);
    this.emit(job.printer.branchId, principal.organizationId);
    return updated;
  }

  async reprint(jobId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.reprint');
    const job = await this.loadJob(jobId, principal);
    const newJob = await this.prisma.printerJob.create({
      data: {
        printerId: job.printerId,
        ticketId: job.ticketId,
        ticketType: job.ticketType,
        payload: { ...(job.payload as Prisma.JsonObject), copy: true } as Prisma.InputJsonValue,
        status: printMode() === 'direct' ? 'QUEUED' : 'PENDING',
        isReprint: true,
      },
    });
    await recordAudit(this.prisma, { actorId: principal.userId, action: 'PRINT_JOB_REPRINTED', entityType: 'PrinterJob', entityId: newJob.id });
    this.kick(newJob.id);
    this.emit(job.printer.branchId, principal.organizationId);
    return newJob;
  }

  async getJob(jobId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.view');
    return this.loadJob(jobId, principal);
  }

  /**
   * Everything sent to the printers in a time window, newest first: bills, receipts,
   * kitchen tickets and test pages, with whether each one actually printed.
   */
  async listHistory(
    { branchId, from, to, kind }: { branchId: string; from: Date; to: Date; kind?: 'bills' | 'kitchen' | 'all' },
    principal: AuthenticatedPrincipal,
  ) {
    requirePermission(principal, 'printer.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Invalid date range');
    if (to.getTime() - from.getTime() > 32 * 24 * 3600_000) throw new BadRequestException('Pick at most a month at a time');
    const where: Prisma.PrinterJobWhereInput = { printer: { branchId }, createdAt: { gte: from, lt: to } };
    if (kind === 'bills') where.ticketType = { in: ['RECEIPT', 'BILL'] };
    if (kind === 'kitchen') where.ticketType = { notIn: ['RECEIPT', 'BILL', 'TEST'] };
    const jobs = await this.prisma.printerJob.findMany({ where, include: { printer: true }, orderBy: { createdAt: 'desc' }, take: 300 });
    return jobs.map((j) => {
      const p = (j.payload ?? {}) as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        id: j.id,
        status: j.status,
        printerName: j.printer.name,
        printerKind: j.printer.kind,
        ticketType: j.ticketType,
        isReprint: j.isReprint,
        orderNumber: s(p.orderNumber),
        table: s(p.table),
        total: s(p.total),
        receiptNumber: s(p.receiptNumber),
        stationName: s(p.stationName),
        itemCount: Array.isArray(p.items) ? p.items.length : null,
        errorMessage: j.errorMessage,
        attemptCount: j.attemptCount,
        createdAt: j.createdAt.toISOString(),
        printedAt: j.printedAt?.toISOString() ?? null,
      };
    });
  }

  /** The job exactly as it came out of (or would come out of) the printer. */
  async preview(jobId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.view');
    const job = await this.loadJob(jobId, principal);
    const columns = printerColumns();
    return decodeEscPos(renderPrintJob(job.payload, columns), columns);
  }

  /** Jobs that need a human: failed prints and anything stuck for more than a minute. */
  async listProblemJobs(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const stuckBefore = new Date(Date.now() - 60_000);
    const jobs = await this.prisma.printerJob.findMany({
      where: {
        printer: { branchId },
        OR: [
          { status: { in: ['FAILED', 'FAILED_PERMANENT'] } },
          { status: { in: ['PENDING', 'QUEUED'] }, createdAt: { lt: stuckBefore } },
        ],
        createdAt: { gt: new Date(Date.now() - 12 * 3600_000) },
      },
      include: { printer: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return jobs.map((j) => {
      const p = j.payload as Record<string, unknown>;
      return {
        id: j.id,
        status: j.status,
        printerName: j.printer.name,
        ticketType: j.ticketType,
        orderNumber: typeof p?.orderNumber === 'string' ? p.orderNumber : null,
        table: typeof p?.table === 'string' ? p.table : null,
        errorMessage: j.errorMessage,
        attemptCount: j.attemptCount,
        createdAt: j.createdAt.toISOString(),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Printer administration
  // ---------------------------------------------------------------------------

  async listPrinters(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const [printers, agents] = await Promise.all([
      this.prisma.printer.findMany({ where: { branchId }, include: { station: true }, orderBy: { name: 'asc' } }),
      this.prisma.printAgent.findMany({ where: { branchId, isActive: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    return {
      mode: printMode(),
      printers: printers.map((p) => ({
        id: p.id,
        name: p.name,
        kind: p.kind,
        stationId: p.stationId,
        stationName: p.station?.name ?? null,
        ipAddress: p.ipAddress,
        port: p.port,
        isActive: p.isActive,
        status: p.status,
        lastSeenAt: p.lastSeenAt?.toISOString() ?? null,
        lastError: p.lastError,
      })),
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        lastSeenAt: a.lastSeenAt?.toISOString() ?? null,
        online: !!a.lastSeenAt && Date.now() - a.lastSeenAt.getTime() < 30_000,
      })),
    };
  }

  async createPrinter(dto: CreatePrinterDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.manage');
    await assertBranchAccess(this.prisma, principal, dto.branchId);
    if (dto.kind === 'KITCHEN' && !dto.stationId) throw new BadRequestException('Kitchen printers need a station');
    if (dto.stationId) {
      const station = await this.prisma.kitchenStation.findUnique({ where: { id: dto.stationId } });
      if (!station || station.branchId !== dto.branchId) throw new BadRequestException('Station not in this branch');
    }
    const printer = await this.prisma.printer.create({
      data: {
        branchId: dto.branchId,
        name: dto.name,
        kind: dto.kind,
        stationId: dto.kind === 'KITCHEN' ? dto.stationId : null,
        ipAddress: dto.ipAddress,
        port: dto.port ?? 9100,
      },
    });
    await recordAudit(this.prisma, { actorId: principal.userId, action: 'PRINTER_CREATED', entityType: 'Printer', entityId: printer.id, afterState: { name: printer.name, ip: printer.ipAddress } });
    return printer;
  }

  async updatePrinter(id: string, dto: UpdatePrinterDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.manage');
    const printer = await this.prisma.printer.findUnique({ where: { id } });
    if (!printer) throw new NotFoundException('Printer not found');
    await assertBranchAccess(this.prisma, principal, printer.branchId);
    const updated = await this.prisma.printer.update({
      where: { id },
      data: {
        name: dto.name,
        ipAddress: dto.ipAddress,
        port: dto.port,
        isActive: dto.isActive,
        stationId: dto.stationId,
      },
    });
    await recordAudit(this.prisma, { actorId: principal.userId, action: 'PRINTER_UPDATED', entityType: 'Printer', entityId: id });
    return updated;
  }

  async testPrint(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.manage');
    const printer = await this.prisma.printer.findUnique({ where: { id } });
    if (!printer) throw new NotFoundException('Printer not found');
    await assertBranchAccess(this.prisma, principal, printer.branchId);
    const job = await this.prisma.printerJob.create({
      data: {
        printerId: id,
        ticketType: 'TEST',
        status: printMode() === 'direct' ? 'QUEUED' : 'PENDING',
        payload: { kind: 'TEST', printerName: printer.name },
      },
    });
    this.kick(job.id);
    return { jobId: job.id };
  }

  /** Creates a print agent for a branch. The key is shown once; only its hash is stored. */
  async createAgent(dto: CreatePrintAgentDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.manage');
    await assertBranchAccess(this.prisma, principal, dto.branchId);
    const key = `pa_${randomBytes(24).toString('hex')}`;
    const agent = await this.prisma.printAgent.create({
      data: { branchId: dto.branchId, name: dto.name, keyHash: hashAgentKey(key) },
    });
    await recordAudit(this.prisma, { actorId: principal.userId, action: 'PRINT_AGENT_CREATED', entityType: 'PrintAgent', entityId: agent.id });
    return { id: agent.id, name: agent.name, agentKey: key };
  }

  async revokeAgent(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'printer.manage');
    const agent = await this.prisma.printAgent.findUnique({ where: { id } });
    if (!agent) throw new NotFoundException();
    await assertBranchAccess(this.prisma, principal, agent.branchId);
    await this.prisma.printAgent.update({ where: { id }, data: { isActive: false } });
    await recordAudit(this.prisma, { actorId: principal.userId, action: 'PRINT_AGENT_REVOKED', entityType: 'PrintAgent', entityId: id });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Print agent protocol (authenticated by agent key, not a user session)
  // ---------------------------------------------------------------------------

  /**
   * Hands out up to 10 jobs for this agent's branch. FOR UPDATE SKIP LOCKED makes this safe
   * even if two agents run at once: each job goes to exactly one of them.
   */
  async claimJobs(agent: { id: string; branchId: string }) {
    await this.prisma.printAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
    const leaseExpired = new Date(Date.now() - CLAIM_LEASE_MS);
    const claimed = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "PrinterJob" SET "status" = 'PRINTING', "claimedAt" = NOW(), "attemptCount" = "attemptCount" + 1
      WHERE "id" IN (
        SELECT j."id" FROM "PrinterJob" j
        JOIN "Printer" p ON p."id" = j."printerId"
        WHERE p."branchId" = ${agent.branchId} AND p."isActive" = true
          AND (j."status" IN ('PENDING', 'QUEUED') OR (j."status" = 'PRINTING' AND j."claimedAt" < ${leaseExpired}))
          AND j."attemptCount" < ${MAX_ATTEMPTS}
        ORDER BY j."createdAt" ASC
        LIMIT 10
        FOR UPDATE OF j SKIP LOCKED
      )
      RETURNING "id"`;
    if (claimed.length === 0) return [];

    const jobs = await this.prisma.printerJob.findMany({
      where: { id: { in: claimed.map((c) => c.id) } },
      include: { printer: true },
      orderBy: { createdAt: 'asc' },
    });
    return jobs.map((j) => ({
      id: j.id,
      printer: { id: j.printer.id, name: j.printer.name, host: j.printer.ipAddress, port: j.printer.port },
      data: renderPrintJob(j.payload).toString('base64'),
    }));
  }

  async reportResult(agent: { id: string; branchId: string }, jobId: string, dto: JobResultDto) {
    const job = await this.prisma.printerJob.findUnique({ where: { id: jobId }, include: { printer: true } });
    if (!job || job.printer.branchId !== agent.branchId) throw new NotFoundException();
    const updated = await this.prisma.printerJob.update({
      where: { id: jobId },
      data: dto.ok
        ? { status: 'PRINTED', printedAt: new Date(), errorMessage: null }
        : {
            status: job.attemptCount >= MAX_ATTEMPTS ? 'FAILED_PERMANENT' : 'FAILED',
            errorMessage: dto.error?.slice(0, 500) ?? 'Unknown error',
          },
    });
    await this.markPrinter(job.printerId, dto.ok, dto.error);
    // Auto-retry transient failures: put it back in the queue after a failed attempt.
    if (!dto.ok && updated.status === 'FAILED') {
      await this.prisma.printerJob.update({ where: { id: jobId }, data: { status: 'PENDING' } });
    }
    return { status: updated.status };
  }

  async heartbeat(agent: { id: string; branchId: string }, dto: HeartbeatDto) {
    await this.prisma.printAgent.update({ where: { id: agent.id }, data: { lastSeenAt: new Date() } });
    for (const p of dto.printers ?? []) {
      const printer = await this.prisma.printer.findUnique({ where: { id: p.id } });
      if (printer && printer.branchId === agent.branchId) await this.markPrinter(p.id, p.online, p.error);
    }
    const printers = await this.prisma.printer.findMany({ where: { branchId: agent.branchId, isActive: true } });
    return { printers: printers.map((p) => ({ id: p.id, name: p.name, host: p.ipAddress, port: p.port })) };
  }

  private async markPrinter(printerId: string, online: boolean, error?: string | null) {
    const before = await this.prisma.printer.findUnique({ where: { id: printerId }, include: { branch: true } });
    if (!before) return;
    const status = online ? 'ONLINE' : 'OFFLINE';
    await this.prisma.printer.update({
      where: { id: printerId },
      data: { status, lastSeenAt: online ? new Date() : before.lastSeenAt, lastError: online ? null : (error ?? before.lastError) },
    });
    if (before.status !== status) this.emit(before.branchId, before.branch.organizationId);
  }

  private emit(branchId: string, organizationId: string) {
    this.events?.emit({ type: 'printer.updated', organizationId, branchId });
  }
}
