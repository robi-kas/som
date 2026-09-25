import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { nextBranchCounter, businessDayKey } from '../common/utils/db-locks.js';
import { EventsService } from '../events/events.service.js';
import * as path from 'path';
import { BRANDING_UPLOAD_DIR } from '../uploads/uploads.controller.js';
import { logoRasterFor } from '../printers/logo-raster.js';
import { renderPrintJob } from '../printers/escpos.js';
import { decodeEscPos } from '../printers/escpos-preview.js';

/** The org's logo as printer dots, if it's a printable PNG. */
function printableLogo(logoReference: string | null) {
  if (!logoReference) return undefined;
  const file = logoReference.split('/').pop()?.split('?')[0];
  if (!file || !file.toLowerCase().endsWith('.png')) return undefined;
  const raster = logoRasterFor(path.join(BRANDING_UPLOAD_DIR, file));
  return raster ? { widthBytes: raster.widthBytes, height: raster.height, data: raster.data.toString('base64') } : undefined;
}

/**
 * Receipts are an immutable snapshot of the bill at the moment a payment was confirmed.
 * They are printed through the same job queue as kitchen tickets, on the branch's RECEIPT printer.
 *
 * Legal note (Ethiopia): VAT-registered businesses generally must issue receipts from a
 * Ministry of Revenue approved sales register machine. Until fiscal-printer integration exists,
 * every receipt is marked as a non-fiscal bill.
 */
export const NON_FISCAL_NOTICE = 'Order bill — not a fiscal receipt';

@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
  ) {}

  private async buildContent(tx: Prisma.TransactionClient, orderId: string, paymentId: string | null) {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { where: { status: { notIn: ['CANCELLED', 'VOIDED'] } }, include: { modifiers: true } },
        waiter: { include: { employee: true } },
        table: true,
        payments: { where: { status: { in: ['CONFIRMED', 'PARTIALLY_REFUNDED', 'FULLY_REFUNDED'] } }, orderBy: { createdAt: 'asc' } },
        organization: true,
        branch: { include: { config: true, paymentMethods: { where: { isActive: true, accountInfo: { not: null } }, orderBy: { displayOrder: 'asc' } } } },
      },
    });
    const payment = paymentId ? order.payments.find((p) => p.id === paymentId) ?? null : null;
    const paid = order.payments.reduce((acc, p) => acc.add(p.appliedAmount), new Prisma.Decimal(0));

    return {
      order,
      content: {
        notice: NON_FISCAL_NOTICE,
        cafeName: order.organization.name,
        logo: printableLogo(order.organization.logoReference),
        branchName: order.branch.name,
        tin: order.branch.config?.tinNumber ?? null,
        footer: order.branch.config?.receiptFooter ?? 'Thank you for visiting',
        orderNumber: order.orderNumber,
        table: order.table?.name ?? 'Takeaway',
        waiterName: order.waiter?.employee
          ? `${order.waiter.employee.firstName} ${order.waiter.employee.lastName}`.trim()
          : (order.waiter?.username ?? '—'),
        currency: order.currency,
        items: order.items.map((i) => {
          const unit = i.modifiers.reduce((acc, m) => acc.add(m.priceDeltaSnapshot), i.unitPriceSnapshot);
          return {
            name: i.productNameSnapshot,
            modifiers: i.modifiers.map((m) => m.nameSnapshot),
            quantity: i.quantity,
            unitPrice: unit.toFixed(2),
            lineTotal: unit.mul(i.quantity).toFixed(2),
          };
        }),
        subtotal: order.subtotal.toFixed(2),
        discount: order.discountAmount.toFixed(2),
        discountReason: order.discountReason,
        serviceCharge: order.serviceChargeAmount.toFixed(2),
        tax: order.taxAmount.toFixed(2),
        total: order.totalAmount.toFixed(2),
        paidToDate: paid.toFixed(2),
        balanceDue: Prisma.Decimal.max(order.totalAmount.sub(paid), 0).toFixed(2),
        payment: payment
          ? {
              id: payment.id,
              method: payment.methodName ?? payment.method,
              tendered: payment.tenderedAmount.toFixed(2),
              applied: payment.appliedAmount.toFixed(2),
              change: payment.changeAmount.toFixed(2),
              reference: payment.referenceNumber,
            }
          : null,
        // "Pay by Telebirr: merchant 123456" lines, printed on the bill so the customer knows where to send money.
        payTo: order.branch.paymentMethods.map((m) => ({ name: m.name, account: m.accountInfo })),
        timestamp: new Date().toISOString(),
      },
    };
  }

  private async enqueueReceiptPrint(tx: Prisma.TransactionClient, branchId: string, payload: Record<string, unknown>, ticketType: string, isReprint = false) {
    const printers = await tx.printer.findMany({ where: { branchId, kind: 'RECEIPT', isActive: true } });
    for (const printer of printers) {
      await tx.printerJob.create({
        data: { printerId: printer.id, ticketType, status: 'PENDING', isReprint, payload: payload as Prisma.InputJsonValue },
      });
    }
    return printers.length;
  }

  /** Called inside the payment transaction when a payment becomes CONFIRMED. */
  async generateReceipt(tx: Prisma.TransactionClient, orderId: string, paymentId: string, principal: AuthenticatedPrincipal) {
    const { order, content } = await this.buildContent(tx, orderId, paymentId);
    const day = businessDayKey();
    const seq = await nextBranchCounter(tx, order.branchId, `RECEIPT:${day}`);
    const receiptNumber = `R${day.slice(2)}-${String(seq).padStart(4, '0')}`;

    const receipt = await tx.receipt.create({
      data: {
        organizationId: principal.organizationId,
        branchId: order.branchId,
        orderId: order.id,
        paymentId,
        receiptNumber,
        content: { ...content, receiptNumber } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.enqueueReceiptPrint(tx, order.branchId, { kind: 'RECEIPT', copy: false, receiptNumber, ...content }, 'RECEIPT');
    return receipt;
  }

  /** Prints the bill for the table before payment (no receipt record, nothing is final). */
  async printBill(orderId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'order.view');
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.organizationId !== principal.organizationId) throw new NotFoundException('Order not found');
    await assertBranchAccess(this.prisma, principal, order.branchId);

    const { queued, content } = await this.prisma.$transaction(async (tx) => {
      const built = await this.buildContent(tx, orderId, null);
      const count = await this.enqueueReceiptPrint(tx, order.branchId, { kind: 'BILL', copy: false, ...built.content }, 'BILL');
      await recordAudit(tx, { actorId: principal.userId, action: 'BILL_PRINTED', entityType: 'Order', entityId: orderId });
      return { queued: count, content: built.content };
    });
    this.events?.emit({ type: 'printer.updated', organizationId: order.organizationId, branchId: order.branchId });
    return { queued, content };
  }

  /** Reprints are allowed but always marked COPY and audited with a reason. */
  async reprintReceipt(receiptId: string, reason: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'receipt.reprint');
    const result = await this.prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({ where: { id: receiptId } });
      if (!receipt || receipt.organizationId !== principal.organizationId) throw new NotFoundException('Receipt not found');
      await assertBranchAccess(tx, principal, receipt.branchId);

      const updated = await tx.receipt.update({
        where: { id: receiptId },
        data: { reprintCount: { increment: 1 }, lastReprintedBy: principal.userId, lastReprintedAt: new Date() },
      });
      const content = receipt.content as Record<string, unknown>;
      await this.enqueueReceiptPrint(
        tx,
        receipt.branchId,
        { ...content, kind: 'RECEIPT', copy: true, copyNumber: updated.reprintCount },
        'RECEIPT',
        true,
      );
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'RECEIPT_REPRINTED',
        entityType: 'Receipt',
        entityId: receiptId,
        reason,
        afterState: { reprintCount: updated.reprintCount },
      });
      return updated;
    });
    this.events?.emit({ type: 'printer.updated', organizationId: result.organizationId, branchId: result.branchId });
    return result;
  }

  /** Every receipt issued in a time window (whether or not a printer is set up). */
  async listReceipts({ branchId, from, to }: { branchId: string; from: Date; to: Date }, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'receipt.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) throw new BadRequestException('Invalid date range');
    if (to.getTime() - from.getTime() > 32 * 24 * 3600_000) throw new BadRequestException('Pick at most a month at a time');
    const rows = await this.prisma.receipt.findMany({
      where: { organizationId: principal.organizationId, branchId, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      take: 300,
    });
    return rows.map((r) => {
      const c = (r.content ?? {}) as Record<string, unknown>;
      const pay = (c.payment ?? {}) as Record<string, unknown>;
      const s = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        id: r.id,
        orderId: r.orderId,
        receiptNumber: r.receiptNumber,
        orderNumber: s(c.orderNumber),
        table: s(c.table),
        waiterName: s(c.waiterName),
        total: s(c.total),
        paid: s(pay.applied),
        method: s(pay.method),
        reprintCount: r.reprintCount,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** The receipt as the printer prints it (logo, wrapping and all), decoded from the real bytes. */
  async previewReceipt(receiptId: string, principal: AuthenticatedPrincipal) {
    const receipt = await this.getReceipt(receiptId, principal);
    const columns = Number(process.env.PRINTER_COLUMNS ?? 48);
    const content = (receipt.content ?? {}) as Record<string, unknown>;
    return decodeEscPos(renderPrintJob({ ...content, kind: 'RECEIPT', copy: false }, columns), columns);
  }

  async getReceipt(receiptId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'receipt.view');
    const receipt = await this.prisma.receipt.findUnique({ where: { id: receiptId } });
    if (!receipt || receipt.organizationId !== principal.organizationId) throw new NotFoundException('Receipt not found');
    await assertBranchAccess(this.prisma, principal, receipt.branchId);
    return receipt;
  }
}
