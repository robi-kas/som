import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';
import { PaymentsService } from '../../../src/payments/payments.service.js';
import { ReceiptsService } from '../../../src/receipts/receipts.service.js';
import { ForbiddenException, ConflictException } from '@nestjs/common';

describe('Phase 3G Receipts Integration', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let userId: string;
  let principal: AuthenticatedPrincipal;
  let paymentsService: PaymentsService;
  let receiptsService: ReceiptsService;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    paymentsService = fixture.app.get(PaymentsService);
    receiptsService = fixture.app.get(ReceiptsService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
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

    principal = {
      userId,
      organizationId: orgId,
      branchIds: [branchId],
      permissions: ['payment.collect', 'payment.confirm', 'receipt.view', 'receipt.reprint'],
    };
  });

  it('RECEIPT-INT-001: receipt generated on payment confirm', async () => {
    // Setup Order and Payment
    const order = await fixture.prisma.order.create({
      data: {
        organizationId: orgId,
        branchId,
        waiterId: userId,
        orderNumber: 'ORD-1',
        currency: 'USD',
        status: 'SUBMITTED',
        paymentStatus: 'UNPAID',
        totalAmount: 100,
        subtotal: 100,
        taxAmount: 0
      }
    });

    const payment = await fixture.prisma.payment.create({
      data: {
        organizationId: orgId,
        orderId: order.id,
        method: 'DIGITAL',
        currency: 'USD',
        tenderedAmount: 100,
        appliedAmount: 100,
        changeAmount: 0,
        refundableAmount: 0,
        status: 'PENDING_VERIFICATION',
        receivedById: userId,
        referenceNumber: 'REF-123'
      }
    });

    await paymentsService.confirmPayment(payment.id, { referenceNumber: 'REF-123' }, principal, 'idemp-' + crypto.randomBytes(4).toString('hex'));

    const receipt = await fixture.prisma.receipt.findFirst({
      where: { orderId: order.id }
    });

    expect(receipt).toBeDefined();
    expect(receipt!.receiptNumber).toContain('RCP-');
    expect(receipt!.paymentId).toBe(payment.id);
  });

  it('RECEIPT-INT-002: reprint persists new count and metadata', async () => {
    const order = await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId, waiterId: userId, orderNumber: 'ORD-1', currency: 'USD', totalAmount: 50, subtotal: 50, taxAmount: 0 }
    });
    const payment = await fixture.prisma.payment.create({
      data: { organizationId: orgId, orderId: order.id, method: 'CASH', currency: 'USD', tenderedAmount: 50, appliedAmount: 50, status: 'CONFIRMED', receivedById: userId, refundableAmount: 50, changeAmount: 0 }
    });
    const receipt = await fixture.prisma.receipt.create({
      data: {
        organizationId: orgId, branchId, orderId: order.id, paymentId: payment.id, receiptNumber: 'RCP-test-1',
        content: { total: 50 }
      }
    });

    const result = await receiptsService.reprintReceipt(receipt.id, principal, 'idemp-reprint-1');
    expect(result.reprintCount).toBe(1);
    expect(result.lastReprintedBy).toBe(userId);
    expect(result.lastReprintedAt).toBeDefined();

    const dbReceipt = await fixture.prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(dbReceipt!.reprintCount).toBe(1);
  });

  it('RECEIPT-INT-003: cross-org access rejected', async () => {
    const org2 = await fixture.prisma.organization.create({
      data: { name: 'org2', slug: 'o2-' + crypto.randomBytes(4).toString('hex') }
    });
    const branch2 = await fixture.prisma.branch.create({
      data: { organizationId: org2.id, name: 'B2' }
    });
    const order2 = await fixture.prisma.order.create({
      data: { organizationId: org2.id, branchId: branch2.id, waiterId: userId, orderNumber: 'ORD-1', currency: 'USD', totalAmount: 50, subtotal: 50, taxAmount: 0 }
    });
    const payment2 = await fixture.prisma.payment.create({
      data: { organizationId: org2.id, orderId: order2.id, method: 'CASH', currency: 'USD', tenderedAmount: 50, appliedAmount: 50, status: 'CONFIRMED', receivedById: userId, refundableAmount: 50, changeAmount: 0 }
    });
    const receipt2 = await fixture.prisma.receipt.create({
      data: {
        organizationId: org2.id, branchId: branch2.id, orderId: order2.id, paymentId: payment2.id, receiptNumber: 'RCP-test-2',
        content: { total: 50 }
      }
    });

    await expect(receiptsService.getReceipt(receipt2.id, principal)).rejects.toThrow();
  });

  it('RECEIPT-INT-004: unique receiptNumber per branch', async () => {
    const order = await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId, waiterId: userId, orderNumber: 'ORD-1', currency: 'USD', totalAmount: 50, subtotal: 50, taxAmount: 0 }
    });
    const payment = await fixture.prisma.payment.create({
      data: { organizationId: orgId, orderId: order.id, method: 'CASH', currency: 'USD', tenderedAmount: 50, appliedAmount: 50, status: 'CONFIRMED', receivedById: userId, refundableAmount: 50, changeAmount: 0 }
    });
    await fixture.prisma.receipt.create({
      data: {
        organizationId: orgId, branchId, orderId: order.id, paymentId: payment.id, receiptNumber: 'RCP-dup',
        content: { total: 50 }
      }
    });

    await expect(fixture.prisma.receipt.create({
      data: {
        organizationId: orgId, branchId, orderId: order.id, paymentId: payment.id, receiptNumber: 'RCP-dup',
        content: { total: 50 }
      }
    })).rejects.toThrow();
  });
});
