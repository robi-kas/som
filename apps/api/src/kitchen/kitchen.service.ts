import { Injectable, ConflictException, NotFoundException, Optional } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateKitchenStationDto } from './dto/create-station.dto.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { toKitchenStationResponse } from '../common/mappers/response.mapper.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class KitchenService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
  ) {}

  private emitTicket(ticket: { id: string; orderId: string; organizationId: string; branchId: string }) {
    this.events?.emit({ type: 'ticket.updated', organizationId: ticket.organizationId, branchId: ticket.branchId, entityId: ticket.id });
    this.events?.emit({ type: 'order.updated', organizationId: ticket.organizationId, branchId: ticket.branchId, entityId: ticket.orderId });
  }

  // Intentionally deferred: list, update, activate

  async create(dto: CreateKitchenStationDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kitchen_station.create');
    const normalizedName = dto.name.trim();

    await assertBranchAccess(this.prisma, principal, dto.branchId);

    try {
      const station = await this.prisma.$transaction(async (tx) => {
        const created = await tx.kitchenStation.create({
          data: {
            organizationId: principal.organizationId,
            branchId: dto.branchId,
            name: normalizedName,
            displayOrder: dto.displayOrder ?? 0,
            isActive: true,
          }
        });

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'CREATE_KITCHEN_STATION',
          entityType: 'KITCHEN_STATION',
          entityId: created.id,
          afterState: { name: normalizedName, branchId: dto.branchId, displayOrder: dto.displayOrder ?? 0 }
        });

        return created;
      });
      return toKitchenStationResponse(station);
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Kitchen station name already exists in this branch');
      }
      throw e;
    }
  }

  async deactivate(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kitchen_station.deactivate');
    
    const result = await this.prisma.$transaction(async (tx) => {
      const station = await tx.kitchenStation.findUnique({ where: { id } });
      if (!station || station.organizationId !== principal.organizationId) {
        throw new NotFoundException('Station not found');
      }

      await assertBranchAccess(tx, principal, station.branchId);

      const activeProducts = await tx.product.count({
        where: {
          preparationStationId: id,
          status: { in: ['AVAILABLE', 'OUT_OF_STOCK'] }
        }
      });

      if (activeProducts > 0) {
        throw new ConflictException('KITCHEN_STATION_HAS_ACTIVE_PRODUCTS');
      }

      const updated = await tx.kitchenStation.update({
        where: { id },
        data: { isActive: false }
      });

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'DEACTIVATE_KITCHEN_STATION',
        entityType: 'KITCHEN_STATION',
        entityId: id,
        beforeState: { isActive: true },
        afterState: { isActive: false }
      });

      return updated;
    });

    return toKitchenStationResponse(result);
  }

  async getTickets(branchId: string, stationId: string | undefined, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kds.view');
    await assertBranchAccess(this.prisma, principal, branchId);

    const tickets = await this.prisma.kitchenTicket.findMany({
      where: {
        organizationId: principal.organizationId,
        branchId,
        ...(stationId ? { stationId } : {}),
        status: { in: ['PENDING', 'PREPARING'] },
      },
      include: {
        order: { include: { table: true, waiter: { include: { employee: true } } } },
        station: true,
        items: { include: { modifiers: true } },
      },
      orderBy: { firedAt: 'asc' },
    });

    const now = Date.now();
    return tickets.map((t) => ({
      id: t.id,
      orderId: t.orderId,
      orderNumber: t.order.orderNumber,
      tableName: t.order.table?.name ?? 'Takeaway',
      waiterName: t.order.waiter?.employee
        ? t.order.waiter.employee.firstName
        : (t.order.waiter?.username ?? ''),
      stationId: t.stationId,
      stationName: t.station.name,
      ticketType: t.ticketType,
      status: t.status,
      firedAt: t.firedAt.toISOString(),
      minutesAgo: Math.floor((now - t.firedAt.getTime()) / 60000),
      items: (t.ticketType === 'CANCELLATION'
        ? t.items
        : t.items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'VOIDED')
      ).map((item) => ({
        id: item.id,
        productNameSnapshot: item.productNameSnapshot,
        quantity: item.quantity,
        notes: item.notes,
        status: item.status,
        modifiers: item.modifiers.map((m) => m.nameSnapshot),
      })),
    }));
  }

  /** Cook taps a new ticket: its items become PREPARING. A cancellation ticket is just dismissed. */
  async acknowledgeTicket(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kds.update');
    const result = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.kitchenTicket.findUnique({ where: { id } });
      if (!ticket || ticket.organizationId !== principal.organizationId) throw new NotFoundException('Ticket not found');
      await assertBranchAccess(tx, principal, ticket.branchId);
      if (ticket.status !== 'PENDING') throw new ConflictException('TICKET_ALREADY_ACKNOWLEDGED');

      if (ticket.ticketType === 'CANCELLATION') {
        await tx.kitchenTicket.update({ where: { id }, data: { status: 'DONE', version: { increment: 1 } } });
        return { ticket, status: 'DONE' };
      }

      const updated = await tx.kitchenTicket.update({
        where: { id, version: ticket.version },
        data: { status: 'PREPARING', version: { increment: 1 } },
      });
      const items = await tx.orderItem.findMany({ where: { kitchenTicketId: id, status: 'SENT_TO_KITCHEN' } });
      for (const item of items) {
        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'PREPARING', version: { increment: 1 } } });
        await tx.orderItemStatusHistory.create({
          data: { orderItemId: item.id, fromStatus: 'SENT_TO_KITCHEN', toStatus: 'PREPARING', changedById: principal.userId },
        });
      }
      return { ticket, status: updated.status };
    });
    this.emitTicket(result.ticket);
    return { status: result.status };
  }

  /** "Bump": the ticket is done, its items are READY and the waiter's phone lights up. */
  async readyTicket(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kds.update');
    const result = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.kitchenTicket.findUnique({ where: { id } });
      if (!ticket || ticket.organizationId !== principal.organizationId) throw new NotFoundException('Ticket not found');
      await assertBranchAccess(tx, principal, ticket.branchId);

      if (ticket.ticketType === 'CANCELLATION') {
        if (ticket.status !== 'PENDING') throw new ConflictException('Ticket already dismissed');
        await tx.kitchenTicket.update({ where: { id }, data: { status: 'DONE', version: { increment: 1 } } });
        return { ticket, status: 'DONE' };
      }
      // Busy kitchens often bump straight from PENDING; allow it.
      if (ticket.status !== 'PENDING' && ticket.status !== 'PREPARING') throw new ConflictException('Ticket already bumped');

      const updated = await tx.kitchenTicket.update({
        where: { id, version: ticket.version },
        data: { status: 'READY', version: { increment: 1 } },
      });
      const items = await tx.orderItem.findMany({
        where: { kitchenTicketId: id, status: { in: ['SENT_TO_KITCHEN', 'PREPARING'] } },
      });
      for (const item of items) {
        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'READY', version: { increment: 1 } } });
        await tx.orderItemStatusHistory.create({
          data: { orderItemId: item.id, fromStatus: item.status, toStatus: 'READY', changedById: principal.userId },
        });
      }
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'KITCHEN_TICKET_READY',
        entityType: 'KitchenTicket',
        entityId: id,
        afterState: { status: 'READY', items: items.length },
      });
      return { ticket, status: updated.status };
    });
    this.emitTicket(result.ticket);
    return { status: result.status };
  }

  /** Undo a bump made by mistake (within the list of the last few tickets). */
  async recallTicket(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kds.update');
    const result = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.kitchenTicket.findUnique({ where: { id } });
      if (!ticket || ticket.organizationId !== principal.organizationId) throw new NotFoundException('Ticket not found');
      await assertBranchAccess(tx, principal, ticket.branchId);
      if (ticket.status !== 'READY') throw new ConflictException('Only bumped tickets can be recalled');

      await tx.kitchenTicket.update({ where: { id }, data: { status: 'PREPARING', version: { increment: 1 } } });
      const items = await tx.orderItem.findMany({ where: { kitchenTicketId: id, status: 'READY' } });
      for (const item of items) {
        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'PREPARING', version: { increment: 1 } } });
        await tx.orderItemStatusHistory.create({
          data: { orderItemId: item.id, fromStatus: 'READY', toStatus: 'PREPARING', changedById: principal.userId },
        });
      }
      return ticket;
    });
    this.emitTicket(result);
    return { status: 'PREPARING' };
  }

  /** Last bumped tickets, so the kitchen can recall one bumped by mistake. */
  async getRecentlyBumped(branchId: string, stationId: string | undefined, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kds.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const tickets = await this.prisma.kitchenTicket.findMany({
      where: {
        organizationId: principal.organizationId,
        branchId,
        ...(stationId ? { stationId } : {}),
        status: 'READY',
        items: { some: { status: 'READY' } },
      },
      include: { order: { include: { table: true } } },
      orderBy: { firedAt: 'desc' },
      take: 8,
    });
    return tickets.map((t) => ({ id: t.id, orderNumber: t.order.orderNumber, tableName: t.order.table?.name ?? 'Takeaway' }));
  }

  async getStations(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'kds.view');
    await assertBranchAccess(this.prisma, principal, branchId);

    const stations = await this.prisma.kitchenStation.findMany({
      where: { organizationId: principal.organizationId, branchId, isActive: true },
      orderBy: { displayOrder: 'asc' }
    });

    return stations.map(s => ({ id: s.id, name: s.name }));
  }

}
