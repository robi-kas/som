import { requirePermission } from '../common/utils/permission-policy.js';
import { Injectable, NotFoundException, ConflictException, BadRequestException, HttpException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { SyncEventDto } from './dto/sync-event.dto.js';
import { Prisma } from '@prisma/client';
import { OrdersService, OPEN_ORDER_STATUSES } from '../orders/orders.service.js';

type SyncResult = { localEventId: string; syncStatus: string; serverEntityId: string | null; errorMessage: string | null };

/**
 * Offline ordering: the waiter's phone queues "ORDER_SUBMITTED" events while offline and
 * sends them here when the connection returns.
 *
 * Each event goes through the normal order flow (create → add items → send to kitchen), so
 * prices, add-ons, stations and totals are exactly what an online order would get.
 * Payments, refunds and price changes are never accepted offline.
 */
@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  async submitSyncBatch(deviceId: string, events: SyncEventDto[], principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'sync.submit');
    const results: SyncResult[] = [];
    for (const event of events) {
      results.push(await this.processEvent(deviceId, event, principal));
    }
    return results;
  }

  private toResult(e: { localEventId: string; syncStatus: string; serverEntityId: string | null; errorMessage: string | null }): SyncResult {
    return { localEventId: e.localEventId, syncStatus: e.syncStatus, serverEntityId: e.serverEntityId, errorMessage: e.errorMessage };
  }

  private async processEvent(deviceId: string, event: SyncEventDto, principal: AuthenticatedPrincipal): Promise<SyncResult> {
    // 1. Claim the event. The unique (deviceId, localEventId) makes replays and concurrent
    //    retries of the same batch safe: only one request ever processes a given event.
    const existing = await this.prisma.syncEvent.findUnique({
      where: { deviceId_localEventId: { deviceId, localEventId: event.localEventId } },
    });
    if (existing && existing.organizationId !== principal.organizationId) {
      return { localEventId: event.localEventId, syncStatus: 'REJECTED', serverEntityId: null, errorMessage: 'DEVICE_MISMATCH' };
    }
    if (existing && existing.syncStatus !== 'PENDING') return this.toResult(existing);
    if (existing && existing.syncStatus === 'PENDING' && Date.now() - existing.serverReceivedAt.getTime() < 60_000) {
      return this.toResult(existing); // another request is working on it right now
    }

    try {
      await assertBranchAccess(this.prisma, principal, event.payload.branchId);
    } catch {
      return this.record(event, deviceId, principal, 'REJECTED', null, 'BRANCH_ACCESS_DENIED');
    }

    if (!existing) {
      try {
        await this.prisma.syncEvent.create({
          data: {
            organizationId: principal.organizationId,
            branchId: event.payload.branchId,
            deviceId,
            localEventId: event.localEventId,
            entityType: event.entityType,
            entityId: event.entityId,
            eventType: event.eventType,
            payload: event.payload as unknown as Prisma.InputJsonValue,
            clientTimestamp: new Date(event.clientTimestamp),
            syncStatus: 'PENDING',
          },
        });
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          return { localEventId: event.localEventId, syncStatus: 'PENDING', serverEntityId: null, errorMessage: null };
        }
        throw e;
      }
    }

    // 2. Did someone else seat this table while the phone was offline?
    const payload = event.payload;
    let tableId = payload.tableId;
    let conflictWith: string | null = null;
    if (tableId) {
      const table = await this.prisma.table.findUnique({ where: { id: tableId } });
      if (!table || table.branchId !== payload.branchId) {
        return this.record(event, deviceId, principal, 'REJECTED', null, 'TABLE_NOT_FOUND');
      }
      const open = await this.prisma.order.findFirst({ where: { tableId, status: { in: OPEN_ORDER_STATUSES } } });
      if (open) {
        conflictWith = open.id;
        tableId = undefined; // create it unassigned; a manager decides what to do
      }
    }

    // 3. Run the normal order flow.
    let orderId: string | null = null;
    try {
      const draft = await this.ordersService.createDraftOrder(
        { branchId: payload.branchId, tableId, type: tableId ? 'DINE_IN' : payload.tableId ? 'DINE_IN' : 'TAKEAWAY' },
        principal,
      );
      orderId = draft.id;
      await this.prisma.order.update({ where: { id: draft.id }, data: { deviceId } });
      const withItems = await this.ordersService.addItemsToOrder(
        draft.id,
        { expectedVersion: draft.version, items: payload.items },
        principal,
      );
      if (conflictWith) {
        return this.record(event, deviceId, principal, 'CONFLICT', draft.id, `TABLE_TAKEN_BY:${conflictWith}`);
      }
      await this.ordersService.fireOrderToKitchen(draft.id, { expectedVersion: withItems.version }, principal);
      return this.record(event, deviceId, principal, 'SYNCED', draft.id, null);
    } catch (e: unknown) {
      const message =
        e instanceof HttpException
          ? (() => {
              const r = e.getResponse();
              return typeof r === 'string' ? r : ((r as { code?: string; message?: string }).code ?? (r as { message?: string }).message ?? e.message);
            })()
          : 'SERVER_ERROR';
      if (!(e instanceof HttpException)) this.logger.error(`Sync event ${event.localEventId} failed`, e as Error);
      if (orderId) {
        const o = await this.prisma.order.findUnique({ where: { id: orderId } });
        if (o && OPEN_ORDER_STATUSES.includes(o.status)) {
          await this.ordersService
            .voidOrder(orderId, { reason: `SYNC_FAILED: ${String(message).slice(0, 100)}`, expectedVersion: o.version }, principal)
            .catch(() => undefined);
        }
      }
      return this.record(event, deviceId, principal, 'REJECTED', null, String(message).slice(0, 200));
    }
  }

  private async record(
    event: SyncEventDto,
    deviceId: string,
    principal: AuthenticatedPrincipal,
    syncStatus: string,
    serverEntityId: string | null,
    errorMessage: string | null,
  ): Promise<SyncResult> {
    const row = await this.prisma.syncEvent.upsert({
      where: { deviceId_localEventId: { deviceId, localEventId: event.localEventId } },
      update: { syncStatus, serverEntityId, errorMessage },
      create: {
        organizationId: principal.organizationId,
        branchId: event.payload.branchId,
        deviceId,
        localEventId: event.localEventId,
        entityType: event.entityType,
        entityId: event.entityId,
        eventType: event.eventType,
        payload: event.payload as unknown as Prisma.InputJsonValue,
        clientTimestamp: new Date(event.clientTimestamp),
        syncStatus,
        serverEntityId,
        errorMessage,
      },
    });
    return this.toResult(row);
  }

  async getSyncStatus(deviceId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'sync.view');
    const counts = await this.prisma.syncEvent.groupBy({
      by: ['syncStatus'],
      where: { deviceId, organizationId: principal.organizationId },
      _count: { syncStatus: true },
    });
    const lastSync = await this.prisma.syncEvent.findFirst({
      where: { deviceId, organizationId: principal.organizationId, syncStatus: 'SYNCED' },
      orderBy: { serverReceivedAt: 'desc' },
    });
    return {
      statusCounts: Object.fromEntries(counts.map((c) => [c.syncStatus, c._count.syncStatus])),
      lastSuccessfulSyncAt: lastSync?.serverReceivedAt || null,
    };
  }

  async listConflicts(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'sync.resolve_conflict');
    await assertBranchAccess(this.prisma, principal, branchId);
    return this.prisma.syncEvent.findMany({
      where: { organizationId: principal.organizationId, branchId, syncStatus: 'CONFLICT' },
      orderBy: { serverReceivedAt: 'asc' },
    });
  }

  /**
   * ACCEPT_LOCAL: keep the offline order (unassigned from the table) and send it to the kitchen.
   * REJECT_LOCAL: void the offline order.
   */
  async resolveConflict(syncEventId: string, resolution: 'ACCEPT_LOCAL' | 'REJECT_LOCAL', principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'sync.resolve_conflict');
    if (resolution !== 'ACCEPT_LOCAL' && resolution !== 'REJECT_LOCAL') throw new BadRequestException('Invalid resolution');

    const syncEvent = await this.prisma.syncEvent.findUnique({ where: { id: syncEventId } });
    if (!syncEvent || syncEvent.organizationId !== principal.organizationId) throw new NotFoundException('Sync event not found');
    if (syncEvent.syncStatus !== 'CONFLICT') throw new BadRequestException('Sync event is not in CONFLICT state');
    await assertBranchAccess(this.prisma, principal, syncEvent.branchId);
    if (!syncEvent.serverEntityId) throw new ConflictException('No serverEntityId found on conflict event');

    const order = await this.prisma.order.findUnique({ where: { id: syncEvent.serverEntityId } });
    if (order && OPEN_ORDER_STATUSES.includes(order.status)) {
      if (resolution === 'REJECT_LOCAL') {
        await this.ordersService.voidOrder(order.id, { reason: 'SYNC_CONFLICT_REJECTED', expectedVersion: order.version }, principal);
      } else {
        await this.ordersService.fireOrderToKitchen(order.id, { expectedVersion: order.version }, principal);
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.syncEvent.update({
        where: { id: syncEvent.id },
        data: { syncStatus: resolution === 'REJECT_LOCAL' ? 'REJECTED' : 'SYNCED' },
      });
      await tx.auditLog.create({
        data: {
          actorId: principal.userId,
          action: 'SYNC_CONFLICT_RESOLVED',
          entityType: 'SyncEvent',
          entityId: syncEvent.id,
          afterState: { resolution },
        },
      });
      return updated;
    });
  }
}
