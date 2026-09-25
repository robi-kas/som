import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit, AuditState } from '../common/utils/audit.helper.js';
import { authorizeSensitiveAction, hasPermission } from '../common/utils/approval-policy.js';
import { lockOrderRow, nextBranchCounter, businessDayKey } from '../common/utils/db-locks.js';
import { recalculateOrderTotals, parseMoney, roundMoney, type RoundingMode } from '../common/money/pricing.js';
import { Prisma, Order, OrderItem } from '@prisma/client';
import {
  CreateDraftOrderDto,
  AddItemsToOrderDto,
  VoidOrderItemDto,
  FireOrderDto,
  ServeItemsDto,
  ApplyDiscountDto,
  TransferTableDto,
} from './dto/orders.dto.js';
import { VoidOrderDto } from './dto/void-order.dto.js';
import { toOrderResponse, toOrderItemResponse } from '../common/mappers/response.mapper.js';
import type { OrderResponseDto } from '../common/mappers/response.mapper.js';
import { EventsService } from '../events/events.service.js';

/** Order statuses that mean "someone is still sitting at this table". */
export const OPEN_ORDER_STATUSES = ['DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'];
const CLOSED_ORDER_STATUSES = ['COMPLETED', 'CANCELLED', 'VOIDED'];
/** Payment statuses where the money was actually received (refunds are tracked separately). */
export const COLLECTED_PAYMENT_STATUSES = ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'];
/** Items that were sent to the kitchen and can no longer be removed without a manager. */
const FIRED_ITEM_STATUSES = ['SENT_TO_KITCHEN', 'PREPARING', 'READY'];

function toOrderAuditState(order: Order): AuditState {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    tableId: order.tableId ?? null,
    waiterId: order.waiterId ?? null,
    subtotal: order.subtotal.toString(),
    discountAmount: order.discountAmount.toString(),
    totalAmount: order.totalAmount.toString(),
    version: order.version,
  };
}

function toOrderItemAuditState(item: OrderItem): AuditState {
  return {
    id: item.id,
    orderId: item.orderId,
    productId: item.productId,
    productName: item.productNameSnapshot,
    quantity: item.quantity,
    unitPriceSnapshot: item.unitPriceSnapshot.toString(),
    status: item.status,
    version: item.version,
  };
}

function isVersionConflict(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025';
}

const ORDER_DETAIL_INCLUDE = {
  items: { include: { modifiers: true }, orderBy: { id: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' }, include: { receivedBy: { include: { employee: true } } } },
  table: true,
  waiter: { include: { employee: true } },
} satisfies Prisma.OrderInclude;

type OrderDetail = Prisma.OrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async findAll(
    { branchId, status, paymentStatus, limit }: { branchId: string; status?: string; paymentStatus?: string; limit: number },
    principal: AuthenticatedPrincipal,
  ) {
    requirePermission(principal, 'order.view');
    await assertBranchAccess(this.prisma, principal, branchId);

    const where: Prisma.OrderWhereInput = { organizationId: principal.organizationId, branchId };
    if (status) where.status = { in: status.split(',') };
    if (paymentStatus) where.paymentStatus = { in: paymentStatus.split(',') };

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit || 50, 1), 200),
      include: {
        table: true,
        waiter: { include: { employee: true } },
        payments: { where: { status: { in: [...COLLECTED_PAYMENT_STATUSES, 'PENDING_VERIFICATION'] } } },
        items: { select: { status: true, quantity: true } },
      },
    });

    return orders.map((order) => {
      const paid = order.payments
        .filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status))
        .reduce((acc, p) => acc.add(p.appliedAmount), new Prisma.Decimal(0));
      const live = order.items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'VOIDED');
      return {
        id: order.id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        tableName: order.table?.name ?? (order.type === 'TAKEAWAY' ? 'Takeaway' : '—'),
        tableStatus: order.table?.status ?? null,
        type: order.type,
        status: order.status,
        paymentStatus: order.paymentStatus,
        totalAmount: order.totalAmount.toString(),
        paidAmount: paid.toString(),
        balanceDue: Prisma.Decimal.max(order.totalAmount.sub(paid), 0).toString(),
        hasPendingVerification: order.payments.some((p) => p.status === 'PENDING_VERIFICATION'),
        currency: order.currency,
        itemCount: live.reduce((n, i) => n + i.quantity, 0),
        readyCount: live.filter((i) => i.status === 'READY').length,
        createdAt: order.createdAt.toISOString(),
        updatedAt: order.updatedAt.toISOString(),
        waiterName: order.waiter
          ? order.waiter.employee
            ? `${order.waiter.employee.firstName} ${order.waiter.employee.lastName}`.trim()
            : order.waiter.username
          : '—',
      };
    });
  }

  async getOrder(orderId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.view');
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, include: ORDER_DETAIL_INCLUDE });
    if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
    await assertBranchAccess(this.prisma, principal, order.branchId);
    return this.toDetail(order);
  }

  async getOrderReceipts(orderId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.view');
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
    await assertBranchAccess(this.prisma, principal, order.branchId);
    return this.prisma.receipt.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' } });
  }

  // ---------------------------------------------------------------------------
  // Opening and building an order
  // ---------------------------------------------------------------------------

  async createDraftOrder(dto: CreateDraftOrderDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.create');
    await assertBranchAccess(this.prisma, principal, dto.branchId);

    try {
      const order = await this.prisma.$transaction(async (tx) => {
        if (dto.tableId) {
          const table = await tx.table.findUnique({ where: { id: dto.tableId } });
          if (!table || table.organizationId !== principal.organizationId || table.branchId !== dto.branchId || !table.isActive) {
            throw new NotFoundException('Table not found');
          }
          if (table.status === 'OUT_OF_SERVICE') throw new ConflictException('TABLE_OUT_OF_SERVICE');
        }

        const branchConfig = await tx.branchConfiguration.findUnique({ where: { branchId: dto.branchId } });
        if (!branchConfig) throw new BadRequestException('Branch configuration missing');

        const day = businessDayKey();
        const seq = await nextBranchCounter(tx, dto.branchId, `ORDER:${day}`);
        const orderNumber = `${day.slice(2)}-${String(seq).padStart(4, '0')}`;

        const created = await tx.order.create({
          data: {
            organizationId: principal.organizationId,
            branchId: dto.branchId,
            tableId: dto.tableId,
            waiterId: principal.userId,
            orderNumber,
            currency: branchConfig.currency,
            status: 'DRAFT',
            paymentStatus: 'UNPAID',
            type: dto.type || (dto.tableId ? 'DINE_IN' : 'TAKEAWAY'),
            taxConfigSnapshot: { taxRate: branchConfig.taxRate.toString(), isTaxInclusive: branchConfig.isTaxInclusive },
            serviceChargeConfigSnapshot: {
              // Takeaway orders don't carry a table-service charge.
              rate: dto.tableId ? branchConfig.serviceChargeRate.toString() : '0',
            },
            roundingModeSnapshot: branchConfig.roundingMode,
          },
        });

        if (dto.tableId) await this.syncTableStatus(tx, dto.tableId);

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'ORDER_CREATED',
          entityType: 'Order',
          entityId: created.id,
          afterState: toOrderAuditState(created),
        });
        return created;
      });

      this.emitOrder(order);
      return toOrderResponse(order);
    } catch (e: unknown) {
      // uq_active_order_per_table: another waiter opened this table a moment ago.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'TABLE_HAS_OPEN_ORDER', message: 'This table already has an open order' });
      }
      throw e;
    }
  }

  async addItemsToOrder(
    orderId: string,
    dto: AddItemsToOrderDto,
    principal: AuthenticatedPrincipal,
    isOffline?: boolean,
    requestDeviceId?: string,
  ) {
    requirePermission(principal, 'order.edit');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockOrderRow(tx, orderId);
        const order = await this.loadForWrite(tx, orderId, principal);

        if (isOffline && (!order.deviceId || order.deviceId !== requestDeviceId)) {
          throw new ConflictException('OFFLINE_NOT_ALLOWED_FOR_OPERATION');
        }
        if (!OPEN_ORDER_STATUSES.includes(order.status)) {
          throw new BadRequestException('Order is closed');
        }
        if (order.version !== dto.expectedVersion) throw this.versionConflict();

        const productIds = [...new Set(dto.items.map((i) => i.productId))];
        const products = await tx.product.findMany({
          where: { id: { in: productIds }, organizationId: principal.organizationId, branchId: order.branchId },
          include: { modifiers: { where: { isActive: true } } },
        });
        const productMap = new Map(products.map((p) => [p.id, p]));

        for (const itemDto of dto.items) {
          const product = productMap.get(itemDto.productId);
          if (!product || !product.isActive) throw new BadRequestException('Product not found');
          if (product.status !== 'AVAILABLE') {
            throw new ConflictException({ code: 'PRODUCT_UNAVAILABLE', message: `${product.name} is out of stock` });
          }

          // Add-ons are resolved on the server; prices come from the database, never the client.
          const modifierIds = [...new Set(itemDto.modifierIds ?? [])];
          const modifiers = modifierIds.map((id) => {
            const m = product.modifiers.find((pm) => pm.id === id);
            if (!m) throw new BadRequestException('Add-on not available for this product');
            return m;
          });

          await tx.orderItem.create({
            data: {
              organizationId: principal.organizationId,
              branchId: order.branchId,
              orderId,
              productId: product.id,
              stationId: product.preparationStationId,
              productNameSnapshot: product.name,
              unitPriceSnapshot: product.sellingPrice,
              quantity: itemDto.quantity,
              notes: itemDto.notes?.trim() || null,
              status: 'PENDING',
              modifiers: modifiers.length
                ? {
                    create: modifiers.map((m) => ({
                      organizationId: principal.organizationId,
                      branchId: order.branchId,
                      modifierId: m.id,
                      nameSnapshot: m.name,
                      priceDeltaSnapshot: m.priceDelta,
                    })),
                  }
                : undefined,
            },
          });
        }

        const updated = await this.applyTotals(tx, orderId);
        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'ORDER_ITEMS_ADDED',
          entityType: 'Order',
          entityId: order.id,
          beforeState: toOrderAuditState(order),
          afterState: toOrderAuditState(updated),
        });
        return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
      });
      this.emitOrder(result);
      return toOrderResponse(result);
    } catch (e: unknown) {
      if (isVersionConflict(e)) throw this.versionConflict();
      throw e;
    }
  }

  /** Sends every not-yet-sent item to its kitchen station and queues the printer tickets. */
  async fireOrderToKitchen(orderId: string, dto: FireOrderDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.submit');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockOrderRow(tx, orderId);
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: { table: true, waiter: { include: { employee: true } } },
        });
        if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
        await assertBranchAccess(tx, principal, order.branchId);

        if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new BadRequestException('Order is closed');
        if (order.version !== dto.expectedVersion) throw this.versionConflict();

        const pendingItems = await tx.orderItem.findMany({
          where: { orderId, status: 'PENDING' },
          include: { modifiers: true },
        });
        if (pendingItems.length === 0) return { order, ticketIds: [] as string[] };

        // Items with no prep station (bottled Coca, Pepsi, water) come straight from the fridge:
        // the waiter hands them over, so they're served now and no ticket is printed.
        for (const item of pendingItems.filter((i) => !i.stationId)) {
          await tx.orderItem.update({
            where: { id: item.id, version: item.version },
            data: { status: 'SERVED', version: { increment: 1 } },
          });
          await tx.orderItemStatusHistory.create({
            data: { orderItemId: item.id, fromStatus: 'PENDING', toStatus: 'SERVED', changedById: principal.userId },
          });
        }

        const nextBatch = order.fireBatchNumber + 1;
        const ticketType = nextBatch === 1 ? 'NEW_ORDER' : 'ADDITION';
        const byStation = new Map<string, typeof pendingItems>();
        for (const item of pendingItems.filter((i) => i.stationId)) {
          const list = byStation.get(item.stationId!) ?? [];
          list.push(item);
          byStation.set(item.stationId!, list);
        }

        const stations = await tx.kitchenStation.findMany({ where: { id: { in: [...byStation.keys()] } } });
        const stationMap = new Map(stations.map((s) => [s.id, s]));
        const waiterName = order.waiter?.employee
          ? `${order.waiter.employee.firstName} ${order.waiter.employee.lastName}`.trim()
          : (order.waiter?.username ?? '—');

        const ticketIds: string[] = [];
        for (const [stationId, items] of byStation) {
          const ticket = await tx.kitchenTicket.create({
            data: {
              organizationId: principal.organizationId,
              branchId: order.branchId,
              orderId,
              stationId,
              fireBatchNumber: nextBatch,
              ticketType,
              status: 'PENDING',
            },
          });
          ticketIds.push(ticket.id);

          for (const item of items) {
            await tx.orderItem.update({
              where: { id: item.id, version: item.version },
              data: { status: 'SENT_TO_KITCHEN', kitchenTicketId: ticket.id, version: { increment: 1 } },
            });
            await tx.orderItemStatusHistory.create({
              data: { orderItemId: item.id, fromStatus: 'PENDING', toStatus: 'SENT_TO_KITCHEN', changedById: principal.userId },
            });
          }

          const payload = {
            kind: 'KITCHEN_TICKET',
            orderNumber: order.orderNumber,
            table: order.table?.name ?? 'Takeaway',
            waiter: waiterName,
            stationName: stationMap.get(stationId)?.name ?? 'Kitchen',
            ticketType,
            firedAt: new Date().toISOString(),
            items: items.map((i) => ({
              name: i.productNameSnapshot,
              quantity: i.quantity,
              modifiers: i.modifiers.map((m) => m.nameSnapshot),
              notes: i.notes,
            })),
          };
          await this.enqueuePrintJobs(tx, { stationId, ticketId: ticket.id, ticketType, payload });
        }

        const finalOrder = await tx.order.update({
          where: { id: orderId },
          data: {
            status: order.status === 'DRAFT' ? 'SUBMITTED' : order.status,
            fireBatchNumber: nextBatch,
            version: { increment: 1 },
          },
        });
        if (order.tableId) await this.syncTableStatus(tx, order.tableId);

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'ORDER_FIRED',
          entityType: 'Order',
          entityId: order.id,
          beforeState: toOrderAuditState(order),
          afterState: { ...toOrderAuditState(finalOrder), batch: nextBatch, tickets: ticketIds.length },
        });
        return { order: finalOrder, ticketIds };
      });

      this.emitOrder(result.order);
      for (const ticketId of result.ticketIds) {
        this.events?.emit({ type: 'ticket.updated', organizationId: result.order.organizationId, branchId: result.order.branchId, entityId: ticketId });
      }
      if (result.ticketIds.length) {
        this.events?.emit({ type: 'printer.updated', organizationId: result.order.organizationId, branchId: result.order.branchId });
      }
      return toOrderResponse(result.order);
    } catch (e: unknown) {
      if (isVersionConflict(e)) throw this.versionConflict();
      throw e;
    }
  }

  /** Waiter confirms food reached the table. Closes the order automatically if it's also paid. */
  async serveItems(orderId: string, dto: ServeItemsDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.edit');
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      const order = await this.loadForWrite(tx, orderId, principal);
      if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new BadRequestException('Order is closed');

      const items = await tx.orderItem.findMany({
        where: {
          orderId,
          ...(dto.itemIds?.length
            ? { id: { in: dto.itemIds }, status: { in: [...FIRED_ITEM_STATUSES] } }
            : { status: 'READY' }),
        },
      });
      if (items.length === 0) throw new ConflictException({ code: 'NOTHING_TO_SERVE', message: 'No items ready to serve' });

      for (const item of items) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: { status: 'SERVED', version: { increment: 1 } },
        });
        await tx.orderItemStatusHistory.create({
          data: { orderItemId: item.id, fromStatus: item.status, toStatus: 'SERVED', changedById: principal.userId },
        });
      }

      await tx.order.update({ where: { id: orderId }, data: { version: { increment: 1 } } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'ORDER_ITEMS_SERVED',
        entityType: 'Order',
        entityId: orderId,
        afterState: { itemIds: items.map((i) => i.id) },
      });
      await this.closeIfDone(tx, orderId, principal.userId);
      return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_DETAIL_INCLUDE });
    });
    this.emitOrder(result);
    return this.toDetail(result);
  }

  /** Waiter flags that the table asked for the bill; the cashier's list lights up. */
  async requestBill(orderId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.edit');
    const order = await this.prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      const o = await this.loadForWrite(tx, orderId, principal);
      if (!OPEN_ORDER_STATUSES.includes(o.status)) throw new BadRequestException('Order is closed');
      if (o.tableId) {
        await tx.table.update({
          where: { id: o.tableId },
          data: { status: 'WAITING_FOR_PAYMENT', version: { increment: 1 } },
        });
      }
      await recordAudit(tx, { actorId: principal.userId, action: 'BILL_REQUESTED', entityType: 'Order', entityId: orderId });
      return o;
    });
    this.emitOrder(order);
    return { success: true };
  }

  async transferTable(orderId: string, dto: TransferTableDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.edit');
    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await lockOrderRow(tx, orderId);
        const order = await this.loadForWrite(tx, orderId, principal);
        if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new BadRequestException('Order is closed');
        if (order.version !== dto.expectedVersion) throw this.versionConflict();
        if (order.tableId === dto.toTableId) return order;

        const target = await tx.table.findUnique({ where: { id: dto.toTableId } });
        if (!target || target.branchId !== order.branchId || !target.isActive) throw new NotFoundException('Table not found');
        if (target.status === 'OUT_OF_SERVICE') throw new ConflictException('TABLE_OUT_OF_SERVICE');

        const fromTableId = order.tableId;
        const result = await tx.order.update({
          where: { id: orderId },
          data: { tableId: target.id, type: 'DINE_IN', version: { increment: 1 } },
        });
        if (fromTableId) await this.syncTableStatus(tx, fromTableId);
        await this.syncTableStatus(tx, target.id);

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'ORDER_TABLE_TRANSFERRED',
          entityType: 'Order',
          entityId: orderId,
          beforeState: { tableId: fromTableId },
          afterState: { tableId: target.id },
        });
        return result;
      });
      this.emitOrder(updated);
      return toOrderResponse(updated);
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ code: 'TABLE_HAS_OPEN_ORDER', message: 'That table already has an open order' });
      }
      if (isVersionConflict(e)) throw this.versionConflict();
      throw e;
    }
  }

  // ---------------------------------------------------------------------------
  // Corrections: discounts and voids
  // ---------------------------------------------------------------------------

  /**
   * Discounts up to the branch threshold (default 10%) need `order.discount`.
   * Bigger ones need `order.discount_large` — the caller's own, or a manager's PIN approval.
   */
  async applyDiscount(orderId: string, dto: ApplyDiscountDto, principal: AuthenticatedPrincipal, approvalToken?: string) {
    requirePermission(principal, 'order.discount');
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockOrderRow(tx, orderId);
        const order = await this.loadForWrite(tx, orderId, principal);
        if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new BadRequestException('Order is closed');
        if (order.version !== dto.expectedVersion) throw this.versionConflict();
        await this.assertNoConfirmedPayments(tx, orderId, 'Take the discount off before any payment is recorded');

        let type: string | null = null;
        let value: Prisma.Decimal | null = null;
        let approverId: string | null = null;

        if (dto.type !== 'NONE') {
          if (!dto.value) throw new BadRequestException('Discount value is required');
          if (!dto.reason?.trim()) throw new BadRequestException('A reason is required for every discount');
          value = parseMoney(dto.value);
          if (value.lte(0)) throw new BadRequestException('Discount must be more than zero');
          if (dto.type === 'PERCENT' && value.gt(100)) throw new BadRequestException('Percent must be 100 or less');
          if (dto.type === 'FIXED' && value.gt(order.subtotal)) throw new BadRequestException('Discount is larger than the bill');

          const config = await tx.branchConfiguration.findUnique({ where: { branchId: order.branchId } });
          const threshold = config?.largeDiscountPercent ?? new Prisma.Decimal(10);
          const effectivePercent =
            dto.type === 'PERCENT'
              ? value
              : order.subtotal.gt(0)
                ? value.div(order.subtotal).mul(100)
                : new Prisma.Decimal(100);

          if (effectivePercent.gt(threshold)) {
            const auth = await authorizeSensitiveAction(tx, principal, 'order.discount_large', approvalToken, `order:${orderId}:discount`);
            approverId = auth.approverId;
          }
          type = dto.type;
        }

        await tx.order.update({
          where: { id: orderId },
          data: {
            discountType: type,
            discountValue: value,
            discountReason: type ? dto.reason!.trim() : null,
            discountAppliedById: type ? principal.userId : null,
            discountApprovedById: approverId,
          },
        });
        const updated = await this.applyTotals(tx, orderId);

        await recordAudit(tx, {
          actorId: principal.userId,
          action: type ? 'ORDER_DISCOUNT_APPLIED' : 'ORDER_DISCOUNT_REMOVED',
          entityType: 'Order',
          entityId: orderId,
          reason: dto.reason,
          beforeState: toOrderAuditState(order),
          afterState: {
            ...toOrderAuditState(updated),
            discountType: type,
            discountValue: value?.toString() ?? null,
            approvedById: approverId,
          },
        });
        return updated;
      });
      this.emitOrder(result);
      return toOrderResponse(result);
    } catch (e: unknown) {
      if (isVersionConflict(e)) throw this.versionConflict();
      throw e;
    }
  }

  /**
   * Removes one item.
   * - Not yet sent to the kitchen: any waiter can remove it (free undo).
   * - Already sent: needs `order.void_item` — the caller's own or a manager PIN — and the
   *   kitchen gets a CANCELLATION ticket so they stop cooking it.
   * - Served items, or orders that already took money, must go through a refund instead.
   */
  async voidOrderItem(
    orderId: string,
    itemId: string,
    dto: VoidOrderItemDto,
    principal: AuthenticatedPrincipal,
    approvalToken?: string,
  ) {
    requirePermission(principal, 'order.edit');
    try {
      const txResult = await this.prisma.$transaction(async (tx) => {
        await lockOrderRow(tx, orderId);
        const order = await this.loadForWrite(tx, orderId, principal);
        if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new BadRequestException('Order is closed');
        if (order.version !== dto.orderVersion) throw this.versionConflict();

        const item = await tx.orderItem.findUnique({ where: { id: itemId } });
        if (!item || item.orderId !== orderId) throw new NotFoundException('Item not found');
        if (item.version !== dto.itemVersion) throw this.versionConflict();
        if (item.status === 'CANCELLED' || item.status === 'VOIDED') throw new ConflictException('Item already removed');
        if (item.status === 'SERVED') {
          throw new ConflictException({ code: 'ITEM_SERVED', message: 'Served items can only be refunded' });
        }
        await this.assertNoConfirmedPayments(tx, orderId, 'This bill is already (partly) paid — use a refund instead');

        let approverId = principal.userId;
        const wasFired = FIRED_ITEM_STATUSES.includes(item.status);
        if (wasFired) {
          const auth = await authorizeSensitiveAction(tx, principal, 'order.void_item', approvalToken, `item:${itemId}:void`);
          approverId = auth.approverId;
        }

        const updatedItem = await tx.orderItem.update({
          where: { id: itemId, version: item.version },
          data: { status: 'CANCELLED', version: { increment: 1 } },
        });
        await tx.orderItemStatusHistory.create({
          data: { orderItemId: item.id, fromStatus: item.status, toStatus: 'CANCELLED', changedById: principal.userId },
        });

        let cancelTicketId: string | null = null;
        if (wasFired && item.stationId) {
          const cancelTicket = await tx.kitchenTicket.create({
            data: {
              organizationId: principal.organizationId,
              branchId: order.branchId,
              orderId,
              stationId: item.stationId,
              // Cancellation tickets get their own batch so they never collide with the unique
              // (orderId, stationId, fireBatchNumber) constraint of the original ticket.
              fireBatchNumber: -(await tx.kitchenTicket.count({ where: { orderId, ticketType: 'CANCELLATION' } }) + 1),
              ticketType: 'CANCELLATION',
              status: 'PENDING',
            },
          });
          cancelTicketId = cancelTicket.id;
          const table = order.tableId ? await tx.table.findUnique({ where: { id: order.tableId } }) : null;
          await this.enqueuePrintJobs(tx, {
            stationId: item.stationId,
            ticketId: cancelTicket.id,
            ticketType: 'CANCELLATION',
            payload: {
              kind: 'KITCHEN_TICKET',
              ticketType: 'CANCELLATION',
              orderNumber: order.orderNumber,
              table: table?.name ?? 'Takeaway',
              firedAt: new Date().toISOString(),
              items: [{ name: item.productNameSnapshot, quantity: item.quantity, modifiers: [], notes: `VOID: ${dto.reason}` }],
            },
          });
        }

        const newOrder = await this.applyTotals(tx, orderId);
        await recordAudit(tx, {
          actorId: principal.userId,
          action: wasFired ? 'ORDER_ITEM_VOIDED' : 'ORDER_ITEM_REMOVED',
          entityType: 'OrderItem',
          entityId: itemId,
          reason: dto.reason,
          beforeState: toOrderItemAuditState(item),
          afterState: { ...toOrderItemAuditState(updatedItem), approvedById: approverId },
        });
        await this.closeIfDone(tx, orderId, principal.userId);
        return { item: updatedItem, order: newOrder, cancelTicketId };
      });

      this.emitOrder(txResult.order);
      if (txResult.cancelTicketId) {
        this.events?.emit({ type: 'ticket.updated', organizationId: txResult.order.organizationId, branchId: txResult.order.branchId, entityId: txResult.cancelTicketId });
      }
      return { item: toOrderItemResponse(txResult.item), order: toOrderResponse(txResult.order) };
    } catch (e: unknown) {
      if (isVersionConflict(e)) throw this.versionConflict();
      throw e;
    }
  }

  async voidOrder(
    orderId: string,
    dto: VoidOrderDto,
    principal: AuthenticatedPrincipal,
    idempotencyKey?: string,
    externalTx?: Prisma.TransactionClient,
    approvalToken?: string,
  ) {
    requirePermission(principal, 'order.edit');
    const endpoint = `POST /orders/${orderId}/void`;

    const txLogic = async (tx: Prisma.TransactionClient) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: { organizationId_endpoint_idempotencyKey: { organizationId: principal.organizationId, endpoint, idempotencyKey } },
        });
        if (existing) return existing.responseBody as unknown as OrderResponseDto;
      }

      await lockOrderRow(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { payments: true, items: true } });
      if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
      await assertBranchAccess(tx, principal, order.branchId);

      if (CLOSED_ORDER_STATUSES.includes(order.status)) throw new ConflictException('ORDER_NOT_VOIDABLE');
      if (order.payments.some((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status) || p.status === 'PENDING_VERIFICATION')) {
        throw new ConflictException({ code: 'ORDER_HAS_PAYMENTS', message: 'Refund the payments before voiding' });
      }

      // An order nothing has been sent from can be cancelled by the waiter. Anything the
      // kitchen has seen needs order.void (own or manager PIN).
      const anyFired = order.items.some((i) => i.status !== 'PENDING' && i.status !== 'CANCELLED');
      let approverId = principal.userId;
      if (anyFired) {
        const auth = await authorizeSensitiveAction(tx, principal, 'order.void', approvalToken, `order:${orderId}:void`);
        approverId = auth.approverId;
      }

      const { count } = await tx.order.updateMany({
        where: { id: order.id, version: dto.expectedVersion },
        data: { status: 'VOIDED', closedAt: new Date(), version: { increment: 1 } },
      });
      if (count === 0) throw new ConflictException('ORDER_VERSION_CONFLICT');

      await tx.orderItem.updateMany({
        where: { orderId: order.id, status: { notIn: ['CANCELLED', 'SERVED'] } },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      await tx.kitchenTicket.updateMany({
        where: { orderId: order.id, status: { in: ['PENDING', 'PREPARING'] } },
        data: { status: 'CANCELLED', version: { increment: 1 } },
      });
      if (order.tableId) await this.syncTableStatus(tx, order.tableId);

      await tx.voidRecord.create({
        data: {
          organizationId: principal.organizationId,
          branchId: order.branchId,
          orderId: order.id,
          reason: dto.reason,
          voidedById: principal.userId,
        },
      });

      const updatedOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'ORDER_VOIDED',
        entityType: 'Order',
        entityId: order.id,
        reason: dto.reason,
        beforeState: toOrderAuditState(order),
        afterState: { ...toOrderAuditState(updatedOrder), approvedById: approverId },
      });

      const response = toOrderResponse(updatedOrder);
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseCode: 200,
            responseBody: response as unknown as Prisma.InputJsonValue,
          },
        });
      }
      this.pendingEmits.push({ organizationId: updatedOrder.organizationId, branchId: updatedOrder.branchId, id: updatedOrder.id, tableId: updatedOrder.tableId });
      return response;
    };

    const response = externalTx ? await txLogic(externalTx) : await this.prisma.$transaction(txLogic);
    this.flushPendingEmits();
    return response;
  }

  // ---------------------------------------------------------------------------
  // Closing
  // ---------------------------------------------------------------------------

  /**
   * "Close bill" (cashier / manager). Normally bills close themselves when the last payment
   * is confirmed; this is for anything left open (e.g. paid before this rule existed).
   */
  async completeOrder(orderId: string, principal: AuthenticatedPrincipal, idempotencyKey?: string) {
    requirePermission(principal, 'order.complete');
    const endpoint = `POST /orders/${orderId}/complete`;

    const response = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: { organizationId_endpoint_idempotencyKey: { organizationId: principal.organizationId, endpoint, idempotencyKey } },
        });
        if (existing) return existing.responseBody as unknown as OrderResponseDto;
      }

      await lockOrderRow(tx, orderId);
      const order = await this.loadForWrite(tx, orderId, principal);
      if (CLOSED_ORDER_STATUSES.includes(order.status)) throw new ConflictException('ORDER_INVALID_STATE');

      const blocker = await this.closeBlocker(tx, orderId, true);
      if (blocker) throw new ConflictException(blocker);

      const closed = await this.closeOrder(tx, orderId, principal.userId, true);
      const res = toOrderResponse(closed);
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseCode: 200,
            responseBody: res as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return res;
    });
    this.events?.emit({ type: 'order.updated', organizationId: principal.organizationId, branchId: response.branchId, entityId: orderId });
    return response;
  }

  /** Kept for callers outside a transaction (refunds). Never throws for "not ready yet". */
  async tryCompleteOrder(orderId: string, principal: AuthenticatedPrincipal) {
    await this.prisma.$transaction(async (tx) => {
      await lockOrderRow(tx, orderId);
      await this.closeIfDone(tx, orderId, principal.userId);
    });
  }

  /**
   * Closes the order when it's done. System action: runs inside whichever transaction made the
   * last change. Returns true if the order was closed.
   *
   * - After a serve / void: closes once everything is served AND paid.
   * - After a payment (`paid: true`): paid in full means done. Customers pay at the end, and many
   *   kitchens work from printed tickets and never press "Done", so waiting for every item to be
   *   tapped "served" left paid bills open forever. Anything already sent is marked served; the
   *   kitchen ticket stays on the screen so a prepaid takeaway still gets made.
   */
  async closeIfDone(tx: Prisma.TransactionClient, orderId: string, actorId: string, opts: { paid?: boolean } = {}): Promise<boolean> {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || !OPEN_ORDER_STATUSES.includes(order.status)) return false;
    if (await this.closeBlocker(tx, orderId, !!opts.paid)) return false;
    await this.closeOrder(tx, orderId, actorId, !!opts.paid);
    return true;
  }

  private async closeBlocker(tx: Prisma.TransactionClient, orderId: string, paidClose = false): Promise<string | null> {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, refunds: true, payments: true } });
    const live = order.items.filter((i) => i.status !== 'CANCELLED' && i.status !== 'VOIDED');
    if (live.length === 0) return 'ORDER_EMPTY';
    if (paidClose) {
      // Charged for but never sent to a station: someone should look before it closes.
      if (live.some((i) => i.status === 'PENDING')) return 'ORDER_ITEMS_NOT_SENT';
    } else if (!live.every((i) => i.status === 'SERVED')) {
      return 'ORDER_ITEMS_NOT_SERVED';
    }
    if (order.paymentStatus !== 'PAID') return 'ORDER_UNPAID';
    if (order.payments.some((p) => p.status === 'PENDING_VERIFICATION')) return 'ORDER_HAS_PENDING_PAYMENT';
    if (order.refunds.some((r) => r.status === 'PENDING' || r.status === 'APPROVED')) return 'ORDER_HAS_PENDING_REFUND';
    return null;
  }

  private async closeOrder(tx: Prisma.TransactionClient, orderId: string, actorId: string, markServed = false) {
    const before = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (markServed) {
      const open = await tx.orderItem.findMany({ where: { orderId, status: { in: [...FIRED_ITEM_STATUSES] } } });
      for (const item of open) {
        await tx.orderItem.update({ where: { id: item.id }, data: { status: 'SERVED', version: { increment: 1 } } });
        await tx.orderItemStatusHistory.create({
          data: { orderItemId: item.id, fromStatus: item.status, toStatus: 'SERVED', changedById: actorId },
        });
      }
    }
    const closed = await tx.order.update({
      where: { id: orderId },
      data: { status: 'COMPLETED', closedAt: new Date(), version: { increment: 1 } },
      include: { items: true },
    });
    if (closed.tableId) await this.syncTableStatus(tx, closed.tableId);
    await recordAudit(tx, {
      actorId,
      action: 'ORDER_COMPLETED',
      entityType: 'Order',
      entityId: orderId,
      beforeState: toOrderAuditState(before),
      afterState: toOrderAuditState(closed),
    });
    return closed;
  }

  // ---------------------------------------------------------------------------
  // Shared helpers (also used by payments / refunds)
  // ---------------------------------------------------------------------------

  /**
   * Recomputes paymentStatus from confirmed payments and pending ones.
   * Must be called whenever the total or the payments change.
   */
  async syncPaymentStatus(tx: Prisma.TransactionClient, orderId: string) {
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: true, refunds: true } });
    const confirmed = order.payments
      .filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status))
      .reduce((acc, p) => acc.add(p.appliedAmount), new Prisma.Decimal(0));
    const refunded = order.refunds
      .filter((r) => r.status === 'CONFIRMED')
      .reduce((acc, r) => acc.add(r.amount), new Prisma.Decimal(0));
    const pending = order.payments.some((p) => p.status === 'PENDING_VERIFICATION');

    let status: string;
    if (refunded.gt(0) && refunded.gte(confirmed)) status = 'REFUNDED';
    else if (confirmed.gte(order.totalAmount) && order.totalAmount.gt(0)) status = refunded.gt(0) ? 'PARTIALLY_REFUNDED' : 'PAID';
    else if (confirmed.gt(0)) status = 'PARTIALLY_PAID';
    else if (pending) status = 'PAYMENT_PENDING';
    else status = 'UNPAID';

    if (status !== order.paymentStatus) {
      await tx.order.update({ where: { id: orderId }, data: { paymentStatus: status, version: { increment: 1 } } });
    }
    return status;
  }

  /** Derives the table's status from its open order (never overrides OUT_OF_SERVICE). */
  async syncTableStatus(tx: Prisma.TransactionClient, tableId: string) {
    const table = await tx.table.findUnique({ where: { id: tableId } });
    if (!table || table.status === 'OUT_OF_SERVICE') return;
    const open = await tx.order.findFirst({ where: { tableId, status: { in: OPEN_ORDER_STATUSES } } });
    const next = !open ? 'AVAILABLE' : table.status === 'WAITING_FOR_PAYMENT' ? 'WAITING_FOR_PAYMENT' : 'OCCUPIED';
    if (next !== table.status) {
      await tx.table.update({ where: { id: tableId }, data: { status: next, version: { increment: 1 } } });
    }
  }

  emitOrder(order: { id: string; organizationId: string; branchId: string; tableId: string | null }) {
    this.events?.emit({ type: 'order.updated', organizationId: order.organizationId, branchId: order.branchId, entityId: order.id });
    if (order.tableId) {
      this.events?.emit({ type: 'table.updated', organizationId: order.organizationId, branchId: order.branchId, entityId: order.tableId });
    }
  }

  private pendingEmits: { id: string; organizationId: string; branchId: string; tableId: string | null }[] = [];
  private flushPendingEmits() {
    const list = this.pendingEmits.splice(0);
    list.forEach((o) => this.emitOrder(o));
  }

  private async applyTotals(tx: Prisma.TransactionClient, orderId: string) {
    const totals = await recalculateOrderTotals(tx, orderId);
    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: totals.subtotal,
        discountAmount: totals.discountAmount,
        serviceChargeAmount: totals.serviceChargeAmount,
        taxAmount: totals.taxAmount,
        totalAmount: totals.totalAmount,
        version: { increment: 1 },
      },
    });
    await this.syncPaymentStatus(tx, orderId);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  }

  private async assertNoConfirmedPayments(tx: Prisma.TransactionClient, orderId: string, message: string) {
    const paid = await tx.payment.count({ where: { orderId, status: { in: [...COLLECTED_PAYMENT_STATUSES, 'PENDING_VERIFICATION'] } } });
    if (paid > 0) throw new ConflictException({ code: 'ORDER_HAS_PAYMENTS', message });
  }

  private async loadForWrite(tx: Prisma.TransactionClient, orderId: string, principal: AuthenticatedPrincipal) {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
    await assertBranchAccess(tx, principal, order.branchId);
    return order;
  }

  private async enqueuePrintJobs(
    tx: Prisma.TransactionClient,
    job: { stationId: string; ticketId: string; ticketType: string; payload: Record<string, unknown> },
  ) {
    const printers = await tx.printer.findMany({ where: { stationId: job.stationId, isActive: true } });
    for (const printer of printers) {
      await tx.printerJob.create({
        data: {
          printerId: printer.id,
          ticketId: job.ticketId,
          ticketType: job.ticketType,
          status: 'PENDING',
          payload: job.payload as Prisma.InputJsonValue,
        },
      });
    }
  }

  private versionConflict() {
    return new ConflictException({ code: 'ORDER_VERSION_CONFLICT', message: 'Someone else just changed this order. Reload and try again.' });
  }

  toDetail(order: OrderDetail) {
    const confirmed = order.payments
      .filter((p) => COLLECTED_PAYMENT_STATUSES.includes(p.status))
      .reduce((acc, p) => acc.add(p.appliedAmount), new Prisma.Decimal(0));
    const mode = (order.roundingModeSnapshot ?? 'HALF_UP') as RoundingMode;
    return {
      ...toOrderResponse(order),
      tableName: order.table?.name ?? null,
      tableStatus: order.table?.status ?? null,
      waiterName: order.waiter
        ? order.waiter.employee
          ? `${order.waiter.employee.firstName} ${order.waiter.employee.lastName}`.trim()
          : order.waiter.username
        : null,
      discountType: order.discountType,
      discountValue: order.discountValue?.toString() ?? null,
      discountReason: order.discountReason,
      paidAmount: confirmed.toString(),
      balanceDue: roundMoney(Prisma.Decimal.max(order.totalAmount.sub(confirmed), 0), mode).toString(),
      createdAt: order.createdAt.toISOString(),
      closedAt: order.closedAt?.toISOString() ?? null,
      items: order.items.map((i) => ({
        ...toOrderItemResponse(i),
        modifiers: i.modifiers.map((m) => ({ id: m.modifierId, name: m.nameSnapshot, priceDelta: m.priceDeltaSnapshot.toString() })),
        lineTotal: i.modifiers
          .reduce((acc, m) => acc.add(m.priceDeltaSnapshot), i.unitPriceSnapshot)
          .mul(i.quantity)
          .toString(),
      })),
      payments: order.payments.map((p) => ({
        id: p.id,
        method: p.method,
        methodName: p.methodName,
        payerBank: p.payerBank,
        status: p.status,
        appliedAmount: p.appliedAmount.toString(),
        tenderedAmount: p.tenderedAmount.toString(),
        changeAmount: p.changeAmount.toString(),
        refundableAmount: p.refundableAmount.toString(),
        referenceNumber: p.referenceNumber,
        receivedById: p.receivedById,
        receivedByName: p.receivedBy?.employee
          ? `${p.receivedBy.employee.firstName} ${p.receivedBy.employee.lastName}`.trim()
          : (p.receivedBy?.username ?? null),
        reportedByWaiter: p.reportedByWaiter,
        hasEvidence: !!p.evidenceId,
        rejectedReason: p.rejectedReason,
        createdAt: p.createdAt.toISOString(),
      })),
      canEdit: OPEN_ORDER_STATUSES.includes(order.status),
    };
  }
}

export { hasPermission };
export type { OrderDetail };
