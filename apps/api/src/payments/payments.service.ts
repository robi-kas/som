import { Injectable, ConflictException, NotFoundException, BadRequestException, ForbiddenException, Optional } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreatePaymentDto, ReportPaymentDto } from './dto/payment.dto.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { lockOrderRow, lockShiftRow } from '../common/utils/db-locks.js';
import { parseMoney } from '../common/money/pricing.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { toPaymentResponse, PaymentResponseDto } from '../common/mappers/response.mapper.js';
import { Prisma } from '@prisma/client';
import { ReceiptsService } from '../receipts/receipts.service.js';
import { OrdersService, OPEN_ORDER_STATUSES, COLLECTED_PAYMENT_STATUSES } from '../orders/orders.service.js';
import { EventsService } from '../events/events.service.js';

export const EVIDENCE_DIR = path.resolve(process.cwd(), 'uploads', 'evidence');

/** The real file type from its first bytes, so a renamed file can't pass as a photo. */
export function sniffImage(buf: Buffer): 'png' | 'jpeg' | 'webp' | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Saves a payment screenshot privately and returns the stored file name. */
function saveEvidenceFile(file: Express.Multer.File) {
  const ext = sniffImage(file.buffer);
  if (!ext) throw new BadRequestException({ code: 'PHOTO_INVALID', message: 'That file is not a photo (PNG, JPEG or WebP)' });
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const filename = `${randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(EVIDENCE_DIR, filename), file.buffer);
  return filename;
}

@Injectable()
export class PaymentsService {
  constructor(
    private prisma: PrismaService,
    private receiptsService: ReceiptsService,
    private ordersService: OrdersService,
    private methods: PaymentMethodsService,
    @Optional() private readonly events?: EventsService,
  ) {}

  private async getActiveShift(tx: Prisma.TransactionClient, principal: AuthenticatedPrincipal, branchId: string) {
    const shift = await tx.cashierShift.findFirst({
      where: { cashierId: principal.userId, branchId, status: 'OPEN' },
    });
    if (!shift) {
      throw new ForbiddenException({ code: 'SHIFT_REQUIRED', message: 'Open your cash drawer shift first' });
    }
    return shift;
  }

  /**
   * Records a payment against an order.
   *
   * - CASH / CARD are settled at the counter: CONFIRMED immediately, receipt printed.
   * - TELEBIRR / CBE_BIRR / BANK_TRANSFER need a transaction reference and stay
   *   PENDING_VERIFICATION until someone else (a manager) checks the statement.
   *
   * The order row is locked for the whole transaction, so two cashiers cannot both
   * pay the same balance.
   */
  async createPayment(orderId: string, dto: CreatePaymentDto, principal: AuthenticatedPrincipal, idempotencyKey?: string): Promise<PaymentResponseDto> {
    requirePermission(principal, 'payment.collect');
    const endpoint = `POST /orders/${orderId}/payments`;

    let tendered: Prisma.Decimal;
    let applied: Prisma.Decimal;
    try {
      tendered = parseMoney(dto.tenderedAmount);
      applied = parseMoney(dto.appliedAmount);
    } catch {
      throw new BadRequestException('PAYMENT_AMOUNT_INVALID');
    }
    if (applied.lte(0)) throw new BadRequestException('PAYMENT_AMOUNT_INVALID');
    if (tendered.lt(applied)) throw new BadRequestException({ code: 'PAYMENT_AMOUNT_INVALID', message: 'Tendered is less than the amount applied' });


    const result = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: { organizationId_endpoint_idempotencyKey: { organizationId: principal.organizationId, endpoint, idempotencyKey } },
        });
        if (existing) return { response: existing.responseBody as unknown as PaymentResponseDto, order: null };
      }

      await lockOrderRow(tx, orderId);
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
      await assertBranchAccess(tx, principal, order.branchId);
      const shift = await this.getActiveShift(tx, principal, order.branchId);

      // The method's own settings decide the rules, never the client.
      const config = await this.methods.getActive(order.branchId, dto.method, tx);
      const method = config.code;
      const isCash = config.kind === 'CASH';
      const needsVerification = config.requiresVerification;
      // Change: cash, or a transfer that was more than the bill (the difference goes back in cash
      // from the drawer). A card is charged the exact amount, so it never has change.
      const change = tendered.sub(applied);
      if (config.kind === 'CARD' && change.gt(0)) {
        throw new BadRequestException({ code: 'PAYMENT_AMOUNT_INVALID', message: 'Only cash payments can have change' });
      }
      if (!isCash && change.gt(applied)) {
        throw new BadRequestException({ code: 'CHANGE_TOO_BIG', message: 'Change can’t be more than the bill itself — that would be handing out cash for a transfer.' });
      }
      // The transaction number may be skipped at the till when the queue is long; it then shows
      // on the cashier's "needs a transaction number" list and must be filled in before the
      // drawer can be closed (see missingReferences / ShiftsService.closeShift).
      if (config.askPayerBank && !dto.payerBank?.trim()) {
        throw new BadRequestException({ code: 'PAYER_BANK_REQUIRED', message: 'Which bank or app did the customer pay with?' });
      }

      if (order.currency !== dto.currency) throw new BadRequestException('Currency mismatch');
      if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new ConflictException('ORDER_INVALID_STATE');

      // Balance = total − confirmed − still-pending digital payments (so pending ones can't be doubled up).
      const amountDue = await this.amountDue(tx, order);
      if (applied.gt(amountDue)) {
        throw new ConflictException({ code: 'PAYMENT_BALANCE_EXCEEDED', message: `Only ${amountDue.toFixed(2)} is still due` });
      }

      const confirmedNow = !needsVerification;
      let payment;
      try {
        payment = await tx.payment.create({
          data: {
            organizationId: principal.organizationId,
            orderId,
            method,
            currency: dto.currency,
            tenderedAmount: tendered,
            appliedAmount: applied,
            changeAmount: change,
            methodName: config.askPayerBank && dto.payerBank ? `${config.name}: ${dto.payerBank.trim()}` : config.name,
            payerBank: dto.payerBank?.trim() || null,
            refundableAmount: confirmedNow ? applied : 0,
            status: confirmedNow ? 'CONFIRMED' : 'PENDING_VERIFICATION',
            receivedById: principal.userId,
            referenceNumber: dto.referenceNumber?.trim() || null,
            confirmedAt: confirmedNow ? new Date() : null,
          },
        });
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({ code: 'REFERENCE_ALREADY_USED', message: 'This transaction reference was already used for another payment' });
        }
        throw e;
      }

      if (isCash) {
        await lockShiftRow(tx, shift.id);
        await tx.cashMovement.create({
          data: {
            shiftId: shift.id,
            type: 'CASH_SALE',
            amount: applied,
            reason: `Order ${order.orderNumber}`,
            userId: principal.userId,
            sourceType: 'PAYMENT',
            sourceId: payment.id,
          },
        });
        await tx.cashierShift.update({
          where: { id: shift.id },
          data: { expectedCash: { increment: applied }, version: { increment: 1 } },
        });
      }

      if (!isCash && change.gt(0)) {
        await this.takeChangeFromDrawer(tx, shift.id, change, `Change for ${config.name} · order ${order.orderNumber}`, principal.userId, payment.id);
      }

      if (confirmedNow) {
        await this.receiptsService.generateReceipt(tx, order.id, payment.id, principal);
      }

      await this.ordersService.syncPaymentStatus(tx, orderId);
      await recordAudit(tx, {
        actorId: principal.userId,
        action: confirmedNow ? 'PAYMENT_CONFIRMED' : 'PAYMENT_RECORDED_PENDING',
        entityType: 'Payment',
        entityId: payment.id,
        afterState: {
          orderId,
          method: payment.methodName ?? method,
          applied: applied.toString(),
          reference: payment.referenceNumber,
          ...(change.gt(0) ? { sent: tendered.toString(), change: change.toString() } : {}),
        },
      });
      // Paid in full → the bill closes and the table frees itself.
      if (confirmedNow) await this.ordersService.closeIfDone(tx, orderId, principal.userId, { paid: true });

      const response = toPaymentResponse(payment);
      if (idempotencyKey) {
        await tx.idempotencyKey.create({
          data: {
            organizationId: principal.organizationId,
            endpoint,
            idempotencyKey,
            responseCode: 201,
            responseBody: response as unknown as Prisma.InputJsonValue,
          },
        });
      }
      return { response, order };
    });

    if (result.order) this.emitPayment(result.order);
    return result.response;
  }

  /**
   * Verifies a digital payment against the merchant statement.
   * Four-eyes rule: the person who recorded a payment can never verify it.
   */
  async confirmPayment(paymentId: string, principal: AuthenticatedPrincipal, idempotencyKey?: string): Promise<PaymentResponseDto> {
    requirePermission(principal, 'payment.confirm');
    const endpoint = `POST /payments/${paymentId}/confirm`;

    const result = await this.prisma.$transaction(async (tx) => {
      if (idempotencyKey) {
        const existing = await tx.idempotencyKey.findUnique({
          where: { organizationId_endpoint_idempotencyKey: { organizationId: principal.organizationId, endpoint, idempotencyKey } },
        });
        if (existing) return { response: existing.responseBody as unknown as PaymentResponseDto, order: null };
      }

      const pre = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!pre || pre.organizationId !== principal.organizationId) throw new NotFoundException('Payment not found');
      await lockOrderRow(tx, pre.orderId);

      const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
      await assertBranchAccess(tx, principal, order.branchId);

      if (payment.status !== 'PENDING_VERIFICATION') {
        throw new ConflictException('Payment is not waiting for verification');
      }
      await this.assertMayVerify(tx, order.branchId, payment.receivedById, principal);
      const config = await tx.paymentMethod.findUnique({ where: { branchId_code: { branchId: order.branchId, code: payment.method } } });
      if (config?.requiresProof && !payment.evidenceId) {
        throw new ConflictException({ code: 'PROOF_REQUIRED', message: 'This method needs the customer’s screenshot before it can be verified' });
      }
      // A waiter took a transfer that was more than the bill: the change is handed out at the
      // till only now, once the money is confirmed. (If it's rejected, no cash ever left.)
      const changeNow = payment.reportedByWaiter && payment.changeAmount.gt(0);
      if (changeNow) {
        const shift = await tx.cashierShift.findFirst({ where: { cashierId: principal.userId, branchId: order.branchId, status: 'OPEN' } });
        if (!shift) {
          throw new ForbiddenException({
            code: 'SHIFT_REQUIRED',
            message: `Open your cash drawer first — the customer gets ${payment.changeAmount.toFixed(2)} change from it`,
          });
        }
        await this.takeChangeFromDrawer(tx, shift.id, payment.changeAmount, `Change for ${payment.methodName ?? payment.method} · order ${order.orderNumber}`, principal.userId, payment.id);
      }

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: new Date(),
          verifiedById: principal.userId,
          refundableAmount: payment.appliedAmount,
          version: { increment: 1 },
        },
      });

      await this.receiptsService.generateReceipt(tx, order.id, updated.id, principal);
      await this.ordersService.syncPaymentStatus(tx, order.id);
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'PAYMENT_VERIFIED',
        entityType: 'Payment',
        entityId: paymentId,
        afterState: {
          receivedById: payment.receivedById,
          reference: payment.referenceNumber,
          ...(changeNow ? { changeGiven: payment.changeAmount.toString() } : {}),
        },
      });
      await this.ordersService.closeIfDone(tx, order.id, principal.userId, { paid: true });

      const response = toPaymentResponse(updated);
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
      return { response, order };
    });

    if (result.order) this.emitPayment(result.order);
    return result.response;
  }

  /** The reference didn't show up on the statement: the order goes back to owing that amount. */
  async rejectPayment(paymentId: string, reason: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'payment.confirm');
    const result = await this.prisma.$transaction(async (tx) => {
      const pre = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!pre || pre.organizationId !== principal.organizationId) throw new NotFoundException('Payment not found');
      await lockOrderRow(tx, pre.orderId);
      const order = await tx.order.findUniqueOrThrow({ where: { id: pre.orderId } });
      await assertBranchAccess(tx, principal, order.branchId);

      if (pre.status !== 'PENDING_VERIFICATION') throw new ConflictException('Payment is not waiting for verification');
      await this.assertMayVerify(tx, order.branchId, pre.receivedById, principal);

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'REJECTED', rejectedReason: reason, verifiedById: principal.userId, version: { increment: 1 } },
      });
      await this.ordersService.syncPaymentStatus(tx, order.id);
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'PAYMENT_REJECTED',
        entityType: 'Payment',
        entityId: paymentId,
        reason,
        afterState: {
          receivedById: pre.receivedById,
          reference: pre.referenceNumber,
          // Cash change handed out for a transfer that never arrived: a loss to follow up.
          ...(pre.method !== 'CASH' && !pre.reportedByWaiter && pre.changeAmount.gt(0) ? { changeLost: pre.changeAmount.toString() } : {}),
        },
      });
      return { payment: updated, order };
    });
    this.emitPayment(result.order);
    return toPaymentResponse(result.payment);
  }

  /**
   * Who may say "yes, the money arrived". By default the cashier can confirm their own
   * Telebirr / bank payment (small cafes often have one person on the till). A branch can turn
   * on "second person must verify" in Settings for a stricter four-eyes check.
   */
  private async assertMayVerify(tx: Prisma.TransactionClient, branchId: string, receivedById: string, principal: AuthenticatedPrincipal) {
    if (receivedById !== principal.userId) return;
    const config = await tx.branchConfiguration.findUnique({ where: { branchId } });
    if (config?.verifyBySecondPerson) {
      throw new ForbiddenException({ code: 'SELF_VERIFICATION', message: 'Your cafe requires someone else to verify a payment you took' });
    }
  }

  /** Cash change for an over-paid transfer leaves the cashier's drawer. */
  private async takeChangeFromDrawer(tx: Prisma.TransactionClient, shiftId: string, change: Prisma.Decimal, reason: string, userId: string, paymentId: string) {
    await lockShiftRow(tx, shiftId);
    const fresh = await tx.cashierShift.findUniqueOrThrow({ where: { id: shiftId } });
    if (fresh.expectedCash.lt(change)) {
      throw new ConflictException({ code: 'INSUFFICIENT_DRAWER_CASH', message: 'There is not enough cash in the drawer for this change' });
    }
    await tx.cashMovement.create({
      data: { shiftId, type: 'CHANGE_OUT', amount: change, reason, userId, sourceType: 'PAYMENT', sourceId: paymentId },
    });
    await tx.cashierShift.update({ where: { id: shiftId }, data: { expectedCash: { decrement: change }, version: { increment: 1 } } });
  }

  /**
   * A waiter records a transfer at the table, from their phone: which app, how much, the
   * transaction number and a photo of the customer's "payment successful" screen.
   *
   * - It is always PENDING_VERIFICATION: a waiter can never say the money arrived; the cashier checks.
   * - Part payments are fine (half transfer, the rest in cash at the till).
   * - If the customer sent more than the bill, the difference is recorded; the cashier hands it
   *   out from the drawer when confirming the transfer (never before the money is confirmed).
   */
  async reportPayment(orderId: string, dto: ReportPaymentDto, file: Express.Multer.File | undefined, principal: AuthenticatedPrincipal, idempotencyKey?: string) {
    requirePermission(principal, 'payment.report');
    const endpoint = `POST /orders/${orderId}/payments/report`;
    let applied: Prisma.Decimal;
    let sent: Prisma.Decimal;
    try {
      applied = parseMoney(dto.appliedAmount);
      sent = dto.sentAmount ? parseMoney(dto.sentAmount) : applied;
    } catch {
      throw new BadRequestException('PAYMENT_AMOUNT_INVALID');
    }
    if (applied.lte(0)) throw new BadRequestException('PAYMENT_AMOUNT_INVALID');
    if (sent.lt(applied)) throw new BadRequestException({ code: 'PAYMENT_AMOUNT_INVALID', message: 'The customer sent less than the amount for the bill' });
    const change = sent.sub(applied);
    if (change.gt(applied)) {
      throw new BadRequestException({ code: 'CHANGE_TOO_BIG', message: 'Change can’t be more than the bill itself — that would be handing out cash for a transfer.' });
    }

    let savedFile = null as string | null; // set inside the transaction callback
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existing = await tx.idempotencyKey.findUnique({
            where: { organizationId_endpoint_idempotencyKey: { organizationId: principal.organizationId, endpoint, idempotencyKey } },
          });
          if (existing) return { response: existing.responseBody as unknown as PaymentResponseDto, order: null };
        }

        await lockOrderRow(tx, orderId);
        const order = await tx.order.findUnique({ where: { id: orderId } });
        if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
        await assertBranchAccess(tx, principal, order.branchId);
        if (!OPEN_ORDER_STATUSES.includes(order.status)) throw new ConflictException('ORDER_INVALID_STATE');

        const settings = await tx.branchConfiguration.findUnique({ where: { branchId: order.branchId } });
        if (settings && !settings.waiterPayments) {
          throw new ForbiddenException({ code: 'WAITER_PAYMENTS_OFF', message: 'Your cafe takes all payments at the till' });
        }
        if ((settings?.waiterPhotoRequired ?? true) && !file) {
          throw new BadRequestException({ code: 'PHOTO_REQUIRED', message: 'Take a photo of the customer’s payment confirmation' });
        }

        const config = await this.methods.getActive(order.branchId, dto.method, tx);
        if (config.kind === 'CASH' || config.kind === 'CARD') {
          throw new BadRequestException({ code: 'METHOD_AT_TILL', message: 'Cash and card are taken at the till' });
        }
        if (config.askPayerBank && !dto.payerBank?.trim()) {
          throw new BadRequestException({ code: 'PAYER_BANK_REQUIRED', message: 'Which bank or app did the customer pay with?' });
        }

        const due = await this.amountDue(tx, order);
        if (applied.gt(due)) {
          throw new ConflictException({ code: 'PAYMENT_BALANCE_EXCEEDED', message: `Only ${due.toFixed(2)} is still due` });
        }

        let evidenceId: string | null = null;
        if (file) {
          savedFile = saveEvidenceFile(file);
          evidenceId = (await tx.paymentEvidence.create({ data: { fileUrl: savedFile } })).id;
        }

        let payment;
        try {
          payment = await tx.payment.create({
            data: {
              organizationId: principal.organizationId,
              orderId,
              method: config.code,
              currency: order.currency,
              tenderedAmount: sent,
              appliedAmount: applied,
              changeAmount: change,
              methodName: config.askPayerBank && dto.payerBank ? `${config.name}: ${dto.payerBank.trim()}` : config.name,
              payerBank: dto.payerBank?.trim() || null,
              refundableAmount: 0,
              status: 'PENDING_VERIFICATION',
              receivedById: principal.userId,
              referenceNumber: dto.referenceNumber?.trim() || null,
              reportedByWaiter: true,
              evidenceId,
            },
          });
        } catch (e: unknown) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            throw new ConflictException({ code: 'REFERENCE_ALREADY_USED', message: 'This transaction reference was already used for another payment' });
          }
          throw e;
        }

        await this.ordersService.syncPaymentStatus(tx, orderId);
        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'PAYMENT_REPORTED_BY_WAITER',
          entityType: 'Payment',
          entityId: payment.id,
          afterState: {
            orderId,
            method: payment.methodName ?? config.code,
            applied: applied.toString(),
            sent: sent.toString(),
            change: change.toString(),
            reference: payment.referenceNumber,
            photo: !!evidenceId,
          },
        });

        const response = toPaymentResponse(payment);
        if (idempotencyKey) {
          await tx.idempotencyKey.create({
            data: { organizationId: principal.organizationId, endpoint, idempotencyKey, responseCode: 201, responseBody: response as unknown as Prisma.InputJsonValue },
          });
        }
        return { response, order };
      });
      if (result.order) this.emitPayment(result.order);
      return result.response;
    } catch (e) {
      // The transaction rolled back: don't keep an orphan photo on disk.
      if (savedFile) fs.rmSync(path.join(EVIDENCE_DIR, savedFile), { force: true });
      throw e;
    }
  }

  /** What is still open on a bill: total − confirmed − still-pending digital payments. */
  private async amountDue(tx: Prisma.TransactionClient, order: { id: string; totalAmount: Prisma.Decimal }) {
    const existing = await tx.payment.findMany({
      where: { orderId: order.id, status: { in: [...COLLECTED_PAYMENT_STATUSES, 'PENDING_VERIFICATION'] } },
    });
    const committed = existing.reduce((sum, p) => sum.add(p.appliedAmount), new Prisma.Decimal(0));
    return Prisma.Decimal.max(order.totalAmount.sub(committed), 0);
  }

  /**
   * Payment history for the cashier's Payments page: every payment in a time window, newest
   * first, with who took and verified it and whether a screenshot is attached.
   */
  async listHistory(
    { branchId, from, to, method, status }: { branchId: string; from: Date; to: Date; method?: string; status?: string },
    principal: AuthenticatedPrincipal,
  ) {
    requirePermission(principal, 'payment.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Invalid date range');
    if (to.getTime() - from.getTime() > 32 * 24 * 3600_000) throw new BadRequestException('Pick at most a month at a time');

    const where: Prisma.PaymentWhereInput = { organizationId: principal.organizationId, order: { branchId }, createdAt: { gte: from, lt: to } };
    if (method) where.method = method;
    if (status) where.status = { in: status.split(',') };

    const name = (u: { username: string; employee: { firstName: string; lastName: string } | null } | null) =>
      u ? (u.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u.username) : null;
    const payments = await this.prisma.payment.findMany({
      where,
      include: {
        order: { include: { table: true } },
        receivedBy: { include: { employee: true } },
        verifiedBy: { include: { employee: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return payments.map((p) => ({
      ...toPaymentResponse(p),
      methodName: p.methodName ?? p.method,
      payerBank: p.payerBank,
      orderId: p.orderId,
      orderNumber: p.order.orderNumber,
      tableName: p.order.table?.name ?? 'Takeaway',
      receivedByName: name(p.receivedBy),
      verifiedByName: name(p.verifiedBy),
      rejectedReason: p.rejectedReason,
      refundableAmount: p.refundableAmount.toString(),
      hasEvidence: !!p.evidenceId,
      reportedByWaiter: p.reportedByWaiter,
      createdAt: p.createdAt,
    }));
  }

  /** Payments whose method needs a transaction number that nobody has typed in yet. */
  async listMissingReferences(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'payment.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const codes = (await this.prisma.paymentMethod.findMany({ where: { branchId, requiresReference: true }, select: { code: true } })).map((m) => m.code);
    const payments = await this.prisma.payment.findMany({
      where: { organizationId: principal.organizationId, order: { branchId }, method: { in: codes }, referenceNumber: null, status: { not: 'REJECTED' } },
      include: { order: { include: { table: true } }, receivedBy: { include: { employee: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return payments.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      orderNumber: p.order.orderNumber,
      tableName: p.order.table?.name ?? 'Takeaway',
      methodName: p.methodName ?? p.method,
      appliedAmount: p.appliedAmount.toString(),
      status: p.status,
      createdAt: p.createdAt,
      mine: p.receivedById === principal.userId,
      receivedByName: p.receivedBy.employee ? `${p.receivedBy.employee.firstName} ${p.receivedBy.employee.lastName}`.trim() : p.receivedBy.username,
    }));
  }

  /**
   * Fill in (or correct) a payment's transaction number after the fact. Adding a missing one is
   * a normal cashier task; changing one that was already entered needs payment.confirm. Both
   * are written to the activity log with the old and new value.
   */
  async setReference(paymentId: string, reference: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'payment.collect');
    const ref = reference.trim();
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.organizationId !== principal.organizationId) throw new NotFoundException('Payment not found');
    await assertBranchAccess(this.prisma, principal, payment.order.branchId);
    if (payment.status === 'REJECTED') throw new ConflictException({ code: 'PAYMENT_REJECTED', message: 'This payment was rejected' });
    if (payment.method === 'CASH') throw new BadRequestException('Cash payments have no transaction number');
    if (payment.referenceNumber === ref) return toPaymentResponse(payment);
    if (payment.referenceNumber) requirePermission(principal, 'payment.confirm');

    const result = await this.prisma.$transaction(async (tx) => {
      let updated;
      try {
        updated = await tx.payment.update({ where: { id: paymentId }, data: { referenceNumber: ref, version: { increment: 1 } } });
      } catch (e: unknown) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException({ code: 'REFERENCE_ALREADY_USED', message: 'This transaction reference was already used for another payment' });
        }
        throw e;
      }
      await recordAudit(tx, {
        actorId: principal.userId,
        action: payment.referenceNumber ? 'PAYMENT_REFERENCE_CHANGED' : 'PAYMENT_REFERENCE_ADDED',
        entityType: 'Payment',
        entityId: paymentId,
        beforeState: { reference: payment.referenceNumber },
        afterState: { reference: ref, orderNumber: payment.order.orderNumber, applied: payment.appliedAmount.toString() },
      });
      return toPaymentResponse(updated);
    });
    this.events?.emit({ type: 'payment.updated', organizationId: payment.organizationId, branchId: payment.order.branchId, entityId: payment.orderId });
    return result;
  }

  /** Verification queue (manager, or cashier checking their own). */
  async listPending(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'payment.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const requireSecond = !!(await this.prisma.branchConfiguration.findUnique({ where: { branchId } }))?.verifyBySecondPerson;
    const payments = await this.prisma.payment.findMany({
      where: { organizationId: principal.organizationId, status: 'PENDING_VERIFICATION', order: { branchId } },
      include: { order: { include: { table: true } }, receivedBy: { include: { employee: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return payments.map((p) => ({
      ...toPaymentResponse(p),
      orderNumber: p.order.orderNumber,
      tableName: p.order.table?.name ?? 'Takeaway',
      methodName: p.methodName ?? p.method,
      payerBank: p.payerBank,
      receivedByName: p.receivedBy.employee
        ? `${p.receivedBy.employee.firstName} ${p.receivedBy.employee.lastName}`.trim()
        : p.receivedBy.username,
      hasEvidence: !!p.evidenceId,
      reportedByWaiter: p.reportedByWaiter,
      sentAmount: p.tenderedAmount.toString(),
      changeAmount: p.changeAmount.toString(),
      canVerify: p.receivedById !== principal.userId || !requireSecond,
    }));
  }

  async attachEvidence(paymentId: string, file: Express.Multer.File, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'payment.collect');
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.organizationId !== principal.organizationId) throw new NotFoundException('Payment not found');
    await assertBranchAccess(this.prisma, principal, payment.order.branchId);
    if (payment.status !== 'PENDING_VERIFICATION') throw new ConflictException('Evidence can only be added while pending');

    const filename = saveEvidenceFile(file);

    await this.prisma.$transaction(async (tx) => {
      const evidence = await tx.paymentEvidence.create({ data: { fileUrl: filename } });
      await tx.payment.update({ where: { id: paymentId }, data: { evidenceId: evidence.id } });
      await recordAudit(tx, { actorId: principal.userId, action: 'PAYMENT_EVIDENCE_ADDED', entityType: 'Payment', entityId: paymentId });
    });
    return { success: true };
  }

  /** Evidence is private: served only through this authenticated endpoint, never as a public file. */
  async getEvidencePath(paymentId: string, principal: AuthenticatedPrincipal): Promise<string> {
    requirePermission(principal, 'payment.view');
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true, evidence: true } });
    if (!payment || payment.organizationId !== principal.organizationId || !payment.evidence) throw new NotFoundException();
    await assertBranchAccess(this.prisma, principal, payment.order.branchId);
    const file = path.resolve(EVIDENCE_DIR, payment.evidence.fileUrl);
    if (!file.startsWith(EVIDENCE_DIR + path.sep) || !fs.existsSync(file)) throw new NotFoundException();
    return file;
  }

  async getPayment(paymentId: string, principal: AuthenticatedPrincipal): Promise<PaymentResponseDto> {
    requirePermission(principal, 'payment.view');
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment || payment.organizationId !== principal.organizationId) throw new NotFoundException('Payment not found');
    await assertBranchAccess(this.prisma, principal, payment.order.branchId);
    return toPaymentResponse(payment);
  }

  private emitPayment(order: { id: string; organizationId: string; branchId: string; tableId: string | null }) {
    this.events?.emit({ type: 'payment.updated', organizationId: order.organizationId, branchId: order.branchId, entityId: order.id });
    this.ordersService.emitOrder(order);
  }
}
