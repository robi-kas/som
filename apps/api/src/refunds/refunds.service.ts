import { Injectable, BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { Prisma } from '@prisma/client';
import { toRefundResponse } from '../common/mappers/response.mapper.js';
import { InitiateRefundDto } from './dto/refund.dto.js';
import { RefundResponseDto } from '../common/mappers/response.mapper.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { authorizeSensitiveAction, hasPermission } from '../common/utils/approval-policy.js';
import { lockOrderRow, lockShiftRow } from '../common/utils/db-locks.js';
import { parseMoney } from '../common/money/pricing.js';

import { OrdersService } from '../orders/orders.service.js';

@Injectable()
export class RefundsService {
  private async refundLimit(tx: Prisma.TransactionClient, branchId: string) {
    const config = await tx.branchConfiguration.findUnique({ where: { branchId } });
    return config?.cashierRefundLimit ?? new Prisma.Decimal(500);
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly ordersService: OrdersService,
  ) {}

  /**
   * Starts a refund. Up to the branch's cashier limit it can be confirmed straight away.
   * Above the limit it needs refund.approve: a manager's PIN on this screen approves it
   * immediately; otherwise it waits in the manager's approval queue.
   */
  async initiateRefund(
    orderId: string,
    dto: InitiateRefundDto,
    principal: AuthenticatedPrincipal,
    idempotencyKey?: string,
    approvalToken?: string,
  ): Promise<RefundResponseDto> {
    requirePermission(principal, 'refund.create');
    const endpoint = `POST /orders/${orderId}/refunds`;

    const created = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_endpoint_idempotencyKey: {
              organizationId: principal.organizationId,
              endpoint,
              idempotencyKey,
            }
          }
        });
        if (existing) return existing.responseBody as unknown as RefundResponseDto;
      }

      await lockOrderRow(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.organizationId !== principal.organizationId) {
        throw new NotFoundException('Order not found');
      }

      await assertBranchAccess(tx, principal, order.branchId);

      const payment = await tx.payment.findUnique({ where: { id: dto.paymentId } });
      if (!payment || payment.orderId !== order.id) {
        throw new NotFoundException('Payment not found');
      }

      if (payment.status !== 'CONFIRMED' && payment.status !== 'PARTIALLY_REFUNDED') {
        throw new BadRequestException('PAYMENT_NOT_CONFIRMED');
      }

      if (dto.method !== payment.method) {
        throw new BadRequestException('REFUND_METHOD_MISMATCH');
      }

      let dtoAmount: Prisma.Decimal;
      try {
        dtoAmount = parseMoney(dto.amount);
      } catch {
        throw new BadRequestException('REFUND_AMOUNT_INVALID');
      }

      if (dtoAmount.isNegative() || dtoAmount.equals(0)) {
        throw new BadRequestException('REFUND_AMOUNT_INVALID');
      }

      const pendingRefunds = await tx.refund.aggregate({
        where: { paymentId: dto.paymentId, status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { amount: true },
      });
      const pendingSum = pendingRefunds._sum.amount ?? new Prisma.Decimal(0);
      const availableRefundable = payment.refundableAmount.sub(pendingSum);
      
      if (dtoAmount.greaterThan(availableRefundable)) {
        throw new ConflictException('REFUND_EXCEEDS_REFUNDABLE');
      }

      if (dto.items && dto.items.length > 0) {
        let totalItemsRefunded = new Prisma.Decimal(0);
        for (const itemDto of dto.items) {
          const item = await tx.orderItem.findUnique({ where: { id: itemDto.orderItemId } });
          if (!item || item.orderId !== orderId) {
            throw new NotFoundException(`Order item ${itemDto.orderItemId} not found on this order`);
          }
          let itemRefundedAmount: Prisma.Decimal;
          let qty: Prisma.Decimal;
          try {
            itemRefundedAmount = parseMoney(itemDto.refundedAmount);
            qty = new Prisma.Decimal(itemDto.quantity);
          } catch {
            throw new BadRequestException('REFUND_AMOUNT_INVALID');
          }
          // Can't refund more of an item than was ordered, across all earlier refunds too.
          const already = await tx.refundItem.aggregate({
            where: { orderItemId: item.id, refund: { status: { in: ['PENDING', 'APPROVED', 'CONFIRMED'] } } },
            _sum: { quantity: true },
          });
          const alreadyQty = already._sum.quantity ?? new Prisma.Decimal(0);
          if (qty.lte(0) || qty.add(alreadyQty).gt(item.quantity)) {
            throw new BadRequestException({ code: 'REFUND_QUANTITY_INVALID', message: `Only ${new Prisma.Decimal(item.quantity).sub(alreadyQty).toString()} × ${item.productNameSnapshot} can still be refunded` });
          }
          totalItemsRefunded = totalItemsRefunded.add(itemRefundedAmount);
        }
        if (!totalItemsRefunded.equals(dtoAmount)) {
          throw new BadRequestException('REFUND_AMOUNT_INVALID');
        }
      }

      const refund = await tx.refund.create({

        data: {
          organizationId: principal.organizationId,
          branchId: order.branchId,
          orderId,
          paymentId: dto.paymentId,
          amount: dtoAmount,
          method: dto.method,
          // V1 statuses: PENDING -> APPROVED -> CONFIRMED
          // TODO(phase-3f): add REJECTED/CANCELLED and the ApprovalRequest denial path
          status: 'PENDING',
          reason: dto.reason,
          initiatedById: principal.userId,
          items: dto.items ? {
            create: dto.items.map(i => ({
              orderItemId: i.orderItemId,
              quantity: new Prisma.Decimal(i.quantity),
              refundedAmount: new Prisma.Decimal(i.refundedAmount),
            }))
          } : undefined
        },
        include: { items: true }
      });

      const limit = await this.refundLimit(tx, order.branchId);
      if (dtoAmount.greaterThan(limit) && approvalToken && !hasPermission(principal, 'refund.approve')) {
        const auth = await authorizeSensitiveAction(tx, principal, 'refund.approve', approvalToken, `refund:${refund.id}:approve`);
        await tx.refund.update({ where: { id: refund.id }, data: { status: 'APPROVED', approvedById: auth.approverId } });
        refund.status = 'APPROVED';
        refund.approvedById = auth.approverId;
      } else if (dtoAmount.greaterThan(limit)) {
        await tx.approvalRequest.create({
          data: {
            entityType: 'Refund',
            entityId: refund.id,
            status: 'PENDING',
            requestedById: principal.userId,
          }
        });
      }

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'REFUND_INITIATED',
        entityType: 'Refund',
        entityId: refund.id,
        afterState: { amount: dtoAmount.toString(), method: dto.method },
        reason: dto.reason
      });

      const response = toRefundResponse(refund);
      
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseBody: response as unknown as Prisma.InputJsonValue,
            responseCode: 201,
          }
        });
      }

      return response;
    });
    return created;
  }

  /**
   * A manager OKs a refund above the cashier's limit: either signed in themselves, or by typing
   * their PIN on the cashier's screen (approvalToken), so nobody has to walk to the back office.
   */
  async approveRefund(refundId: string, principal: AuthenticatedPrincipal, idempotencyKey?: string, approvalToken?: string): Promise<RefundResponseDto> {
    if (!hasPermission(principal, 'refund.approve')) requirePermission(principal, 'refund.create');
    const endpoint = `POST /refunds/${refundId}/approve`;

    return await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_endpoint_idempotencyKey: {
              organizationId: principal.organizationId,
              endpoint,
              idempotencyKey,
            }
          }
        });
        if (existing) return existing.responseBody as unknown as RefundResponseDto;
      }

      const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { items: true } });
      if (!refund || refund.organizationId !== principal.organizationId) {
        throw new NotFoundException('Refund not found');
      }

      await assertBranchAccess(tx, principal, refund.branchId);

      if (refund.status !== 'PENDING') {
        throw new ConflictException('REFUND_NOT_PENDING');
      }

      const { approverId } = await authorizeSensitiveAction(tx, principal, 'refund.approve', approvalToken, `refund:${refund.id}:approve`);
      if (refund.initiatedById === approverId) {
        throw new ForbiddenException('SELF_APPROVAL_FORBIDDEN');
      }

      let updatedRefund;
      try {
        updatedRefund = await tx.refund.update({
          where: { id: refundId, status: 'PENDING' },
          data: { status: 'APPROVED', approvedById: approverId },
          include: { items: true }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new ConflictException('REFUND_ALREADY_RESOLVED');
        }
        throw error;
      }

      const approval = await tx.approvalRequest.findFirst({
        where: { entityType: 'Refund', entityId: refund.id, status: 'PENDING' }
      });

      if (approval) {
        await tx.approvalRequest.update({
          where: { id: approval.id },
          data: { status: 'APPROVED' } // reviewedById not in schema yet
        });
      }

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'REFUND_APPROVED',
        entityType: 'Refund',
        entityId: refund.id,
        afterState: { approvedById: approverId }
      });

      const response = toRefundResponse(updatedRefund);

      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseBody: response as unknown as Prisma.InputJsonValue,
            responseCode: 200,
          }
        });
      }

      return response;
    });
  }

  async confirmRefund(refundId: string, principal: AuthenticatedPrincipal, idempotencyKey?: string): Promise<RefundResponseDto> {
    requirePermission(principal, 'refund.confirm');
    const endpoint = `POST /refunds/${refundId}/confirm`;

    const txResult = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: {
            organizationId_endpoint_idempotencyKey: {
              organizationId: principal.organizationId,
              endpoint,
              idempotencyKey,
            }
          }
        });
        if (existing) return existing.responseBody as unknown as RefundResponseDto;
      }

      const refund = await tx.refund.findUnique({ 
        where: { id: refundId }, 
        include: { order: true, items: true } 
      });
      if (!refund || refund.organizationId !== principal.organizationId) {
        throw new NotFoundException('Refund not found');
      }

      await assertBranchAccess(tx, principal, refund.branchId);

      await lockOrderRow(tx, refund.orderId);
      if (refund.status === 'PENDING') {
        if (refund.amount.greaterThan(await this.refundLimit(tx, refund.branchId))) {
          throw new ConflictException('REFUND_NOT_READY_TO_CONFIRM');
        }
      } else if (refund.status !== 'APPROVED') {
        throw new ConflictException('REFUND_NOT_READY_TO_CONFIRM');
      }

      let confirmedRefund;
      try {
        confirmedRefund = await tx.refund.update({
          where: { id: refundId, status: { in: ['PENDING', 'APPROVED'] } },
          data: { 
            status: 'CONFIRMED', 
            confirmedAt: new Date()
            // approvedById remains as-is: null if cashier self-confirmed, or the manager's ID if APPROVED.
          },
          include: { items: true }
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
          throw new ConflictException('REFUND_ALREADY_CONFIRMED');
        }
        throw error;
      }

      const rowsAffected = await tx.$executeRaw`
        UPDATE "Payment"
        SET "refundableAmount" = "refundableAmount" - ${refund.amount},
            "status" = CASE
              WHEN "refundableAmount" - ${refund.amount} = 0 THEN 'FULLY_REFUNDED'
              ELSE 'PARTIALLY_REFUNDED'
            END,
            "version" = "version" + 1
        WHERE "id" = ${refund.paymentId}
          AND "refundableAmount" >= ${refund.amount}
      `;
      if (rowsAffected === 0) {
        throw new ConflictException('REFUND_EXCEEDS_REFUNDABLE');
      }

      const updatedPayment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      const newPaymentStatus = updatedPayment.status;

      const orderPaymentStatus = await this.ordersService.syncPaymentStatus(tx, refund.orderId);
      await tx.order.update({ where: { id: refund.orderId }, data: { version: { increment: 1 } } });

      if (refund.method === 'CASH') {
        const shift = await tx.cashierShift.findFirst({
          where: { branchId: refund.branchId, status: 'OPEN', cashierId: principal.userId }
        });
        if (!shift) {
          throw new ForbiddenException('SHIFT_REQUIRED');
        }
        await lockShiftRow(tx, shift.id);
        const fresh = await tx.cashierShift.findUniqueOrThrow({ where: { id: shift.id } });
        if (fresh.expectedCash.lessThan(refund.amount)) {
          throw new ConflictException('INSUFFICIENT_DRAWER_CASH');
        }

        await tx.cashMovement.create({
          data: {
            shiftId: shift.id,
            type: 'CASH_REFUND',
            amount: refund.amount,
            reason: refund.reason,
            userId: principal.userId,
            sourceType: 'Refund',
            sourceId: refund.id,
          }
        });

        await tx.cashierShift.update({
          where: { id: shift.id },
          data: {
            expectedCash: { decrement: refund.amount },
            version: { increment: 1 }
          }
        });
      }

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'REFUND_CONFIRMED',
        entityType: 'Refund',
        entityId: refund.id,
        afterState: { amount: refund.amount.toString(), newPaymentStatus, newOrderPaymentStatus: orderPaymentStatus }
      });

      const response = toRefundResponse(confirmedRefund);
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseBody: response as unknown as Prisma.InputJsonValue,
            responseCode: 200,
          }
        });
      }

      return response;
    });

    await this.ordersService.tryCompleteOrder(txResult.orderId, principal);
    const order = await this.prisma.order.findUnique({ where: { id: txResult.orderId } });
    if (order) this.ordersService.emitOrder(order);
    return txResult;
  }

  async getRefund(refundId: string, principal: AuthenticatedPrincipal): Promise<RefundResponseDto> {
    requirePermission(principal, 'refund.view');
    const refund = await this.prisma.refund.findUnique({
      where: { id: refundId },
      include: { items: true }
    });
    if (!refund || refund.organizationId !== principal.organizationId) {
      throw new NotFoundException('Refund not found');
    }
    
    await assertBranchAccess(this.prisma, principal, refund.branchId);
    return toRefundResponse(refund);
  }

  async listRefundsByOrder(orderId: string, principal: AuthenticatedPrincipal): Promise<RefundResponseDto[]> {
    requirePermission(principal, 'refund.view');
    
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.organizationId !== principal.organizationId) {
      throw new NotFoundException('Order not found');
    }
    await assertBranchAccess(this.prisma, principal, order.branchId);

    const refunds = await this.prisma.refund.findMany({
      where: { orderId },
      include: { items: true },
      orderBy: { createdAt: 'desc' }
    });
    
    return refunds.map(toRefundResponse);
  }

  /** Manager's approval queue: refunds above the cashier limit that nobody has approved yet. */
  async listPending(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'refund.approve');
    await assertBranchAccess(this.prisma, principal, branchId);
    const refunds = await this.prisma.refund.findMany({
      where: { organizationId: principal.organizationId, branchId, status: 'PENDING' },
      include: { items: true, order: true, initiatedBy: { include: { employee: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return refunds.map((r) => ({
      ...toRefundResponse(r),
      orderNumber: r.order.orderNumber,
      initiatedByName: r.initiatedBy.employee
        ? `${r.initiatedBy.employee.firstName} ${r.initiatedBy.employee.lastName}`.trim()
        : r.initiatedBy.username,
      canApprove: r.initiatedById !== principal.userId,
    }));
  }
}
