import { Injectable, ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { UpdateTableStatusDto, TableStatus } from './dto/update-table-status.dto.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { toTableResponse } from '../common/mappers/response.mapper.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class TablesService {
  private readonly allowedTransitions: Record<TableStatus, TableStatus[]> = {
    AVAILABLE: [TableStatus.OCCUPIED, TableStatus.OUT_OF_SERVICE],
    OCCUPIED: [TableStatus.WAITING_FOR_PAYMENT, TableStatus.OUT_OF_SERVICE],
    WAITING_FOR_PAYMENT: [TableStatus.OCCUPIED, TableStatus.AVAILABLE],
    OUT_OF_SERVICE: [TableStatus.AVAILABLE],
  };

  constructor(private prisma: PrismaService) {}
  /** Floor plan: every table with a summary of its open order. */
  async findAll(principal: AuthenticatedPrincipal, branchId?: string, includeInactive = false) {
    const isAdmin = principal.permissions.includes('org.admin');
    if (branchId) await assertBranchAccess(this.prisma, principal, branchId);
    const tables = await this.prisma.table.findMany({
      where: {
        organizationId: principal.organizationId,
        ...(includeInactive ? {} : { isActive: true }),
        ...(branchId ? { branchId } : isAdmin ? {} : { branchId: { in: principal.branchIds } }),
      },
      include: {
        orders: {
          where: { status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] } },
          include: {
            waiter: { include: { employee: true } },
            items: { select: { status: true, quantity: true } },
          },
        },
      },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });

    return tables.map((t) => {
      const order = t.orders[0];
      const live = order ? order.items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'VOIDED') : [];
      return {
        id: t.id,
        branchId: t.branchId,
        name: t.name,
        capacity: t.capacity,
        status: t.status,
        isActive: t.isActive,
        version: t.version,
        activeOrderId: order?.id ?? null,
        order: order
          ? {
              id: order.id,
              orderNumber: order.orderNumber,
              status: order.status,
              paymentStatus: order.paymentStatus,
              totalAmount: order.totalAmount.toString(),
              openedAt: order.createdAt.toISOString(),
              waiterId: order.waiterId,
              waiterName: order.waiter?.employee?.firstName ?? order.waiter?.username ?? null,
              itemCount: live.reduce((n, i) => n + i.quantity, 0),
              pendingCount: live.filter((i) => i.status === 'PENDING').length,
              inKitchenCount: live.filter((i) => ['SENT_TO_KITCHEN', 'PREPARING'].includes(i.status)).length,
              readyCount: live.filter((i) => i.status === 'READY').length,
            }
          : null,
      };
    });
  }

  async findOne(id: string, principal: AuthenticatedPrincipal) {
    const table = await this.prisma.table.findUnique({
      where: { id },
      include: {
        orders: {
          where: {
            status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] }
          }
        }
      }
    });

    if (!table || table.organizationId !== principal.organizationId) {
      throw new NotFoundException('Table not found');
    }
    await assertBranchAccess(this.prisma, principal, table.branchId);

    return {
      id: table.id,
      name: table.name,
      capacity: table.capacity,
      status: table.status,
      activeOrderId: table.orders.length > 0 ? table.orders[0].id : null,
    };
  }


  async create(dto: CreateTableDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'table.create');
    const normalizedName = dto.name.trim();

    await assertBranchAccess(this.prisma, principal, dto.branchId);

    try {
      const table = await this.prisma.$transaction(async (tx) => {
        const created = await tx.table.create({
          data: {
            organizationId: principal.organizationId,
            branchId: dto.branchId,
            name: normalizedName,
            capacity: dto.capacity,
            status: TableStatus.AVAILABLE,
            isActive: true,
            version: 1,
          }
        });

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'CREATE_TABLE',
          entityType: 'TABLE',
          entityId: created.id,
          afterState: { name: normalizedName, branchId: dto.branchId, capacity: dto.capacity }
        });

        return created;
      });
      return toTableResponse(table);
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Table name already exists in this branch');
      }
      throw e;
    }
  }

  async setStatus(id: string, dto: UpdateTableStatusDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'table.status_update');
    
    // Initial fast lookup
    const initialTable = await this.prisma.table.findUnique({ where: { id } });
    if (!initialTable || initialTable.organizationId !== principal.organizationId) {
      throw new NotFoundException('Table not found');
    }
    await assertBranchAccess(this.prisma, principal, initialTable.branchId);

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const table = await tx.table.findUnique({ where: { id } });
        if (!table) throw new NotFoundException('Table not found');

        const currentStatus = table.status as TableStatus;
        const requestedStatus = dto.status;

        if (!this.allowedTransitions[currentStatus].includes(requestedStatus)) {
          throw new BadRequestException(`Cannot transition table from ${currentStatus} to ${requestedStatus}`);
        }

        if (requestedStatus === TableStatus.AVAILABLE) {
          const activeOrders = await tx.order.count({
            where: {
              tableId: id,
              table: {
                organizationId: principal.organizationId,
                branchId: table.branchId,
              },
              status: { notIn: ['COMPLETED', 'CANCELLED'] }
            }
          });
          if (activeOrders > 0) {
            throw new ConflictException('Cannot mark table AVAILABLE while active orders exist');
          }
        }

        const updated = await tx.table.update({
          where: { id, version: table.version },
          data: { 
            status: requestedStatus,
            version: { increment: 1 } 
          }
        });

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'UPDATE_TABLE_STATUS',
          entityType: 'TABLE',
          entityId: id,
          beforeState: { status: currentStatus },
          afterState: { status: requestedStatus }
        });

        return updated;
      });
      
      return toTableResponse(result);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('TABLE_VERSION_CONFLICT');
      }
      throw error;
    }
  }

  /** Removes a table from the floor plan (kept for history). Only when nobody is sitting at it. */
  async setActive(id: string, isActive: boolean, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'table.update');
    const table = await this.prisma.table.findUnique({ where: { id } });
    if (!table || table.organizationId !== principal.organizationId) throw new NotFoundException('Table not found');
    await assertBranchAccess(this.prisma, principal, table.branchId);
    if (!isActive) {
      const open = await this.prisma.order.count({ where: { tableId: id, status: { notIn: ['COMPLETED', 'CANCELLED', 'VOIDED'] } } });
      if (open > 0) throw new ConflictException('This table has an open order');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.table.update({ where: { id }, data: { isActive, version: { increment: 1 } } });
      await recordAudit(tx, { actorId: principal.userId, action: isActive ? 'TABLE_ACTIVATED' : 'TABLE_DEACTIVATED', entityType: 'TABLE', entityId: id });
      return u;
    });
    return toTableResponse(updated);
  }
}
