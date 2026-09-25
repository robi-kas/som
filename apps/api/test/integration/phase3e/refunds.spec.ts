import { Test, TestingModule } from '@nestjs/testing';
import { RefundsService } from '../../../src/refunds/refunds.service';
import { getIntegrationFixture, IntegrationTestFixture } from '../fixture';
import { INestApplication, ConflictException, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppModule } from '../../../src/app.module';

describe('Refunds Integration (Phase 3E)', () => {
  let app: INestApplication;
  let fixture: IntegrationTestFixture;
  let service: RefundsService;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    app = fixture.app;
    service = app.get(RefundsService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  async function setupRefundTestState(opts: {
    paymentMethod?: string;
    paymentStatus?: string;
    paymentAmount?: string;
    refundableAmount?: string;
    shiftExpectedCash?: string;
  } = {}) {
    const org = await fixture.prisma.organization.create({ data: { name: `Org-${Date.now()}`, slug: `org-${Date.now()}` } });
    const branch = await fixture.prisma.branch.create({ data: { organizationId: org.id, name: 'B1' } });
    const user = await fixture.prisma.user.create({ data: { organizationId: org.id, username: `u-${Date.now()}`, passwordHash: 'secret' } });
    
    const principal = {
      userId: user.id,
      organizationId: org.id,
      roles: ['CASHIER'],
      permissions: ['refund.create', 'refund.confirm', 'refund.approve', 'org.admin'],
      branchIds: [branch.id],
      sessionId: 'sess-1'
    };

    const order = await fixture.prisma.order.create({
      data: {
        organizationId: org.id,
        branchId: branch.id,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        type: 'DINE_IN',
        totalAmount: opts.paymentAmount ?? '1000.00',
        version: 1,
        orderNumber: `ORD-${Date.now()}`,
        currency: 'ETB'
      }
    });

    const payment = await fixture.prisma.payment.create({
      data: {
        organizationId: org.id,
        orderId: order.id,
        method: opts.paymentMethod ?? 'CARD',
        currency: 'ETB',
        tenderedAmount: opts.paymentAmount ?? '1000.00',
        appliedAmount: opts.paymentAmount ?? '1000.00',
        refundableAmount: opts.refundableAmount ?? opts.paymentAmount ?? '1000.00',
        status: opts.paymentStatus ?? 'CONFIRMED',
        receivedById: user.id,
        version: 1
      }
    });

    let shift = null;
    if (opts.shiftExpectedCash) {
      shift = await fixture.prisma.cashierShift.create({
        data: {
          organizationId: org.id,
          branchId: branch.id,
          cashierId: user.id,
          status: 'OPEN',
          openedAt: new Date(),
          openingFloat: '0.00',
          expectedCash: opts.shiftExpectedCash,
          version: 1
        }
      });
    }

    return { org, branch, user, principal, order, payment, shift };
  }

  describe('Initiate', () => {
    it('REFUND-DB-001: Successful initiate creates PENDING refund linked to payment', async () => {
      const { principal, order, payment } = await setupRefundTestState();
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T1' }, principal);
      
      expect(refund.status).toBe('PENDING');
      expect(refund.amount).toBe('100');
      
      const dbRefund = await fixture.prisma.refund.findUnique({ where: { id: refund.id } });
      expect(dbRefund).not.toBeNull();
      expect(dbRefund!.paymentId).toBe(payment.id);
    });

    it('REFUND-DB-002: Amount exceeding refundable (including pending) -> REFUND_EXCEEDS_REFUNDABLE', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentAmount: '1000.00' });
      await service.initiateRefund(order.id, { paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'T2A' }, principal);
      
      // Second initiate should exceed 1000 total (600 + 500 = 1100 > 1000)
      await expect(
        service.initiateRefund(order.id, { paymentId: payment.id, amount: '500.00', method: 'CARD', reason: 'T2B' }, principal)
      ).rejects.toThrow('REFUND_EXCEEDS_REFUNDABLE');
    });

    it('REFUND-DB-003: Non-CONFIRMED payment -> PAYMENT_NOT_CONFIRMED', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentStatus: 'PENDING_VERIFICATION' });
      await expect(
        service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'T3' }, principal)
      ).rejects.toThrow('PAYMENT_NOT_CONFIRMED');
    });

        it('REFUND-DB-004: Method mismatch -> REFUND_METHOD_MISMATCH', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentMethod: 'CARD' });
      await expect(
        service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CASH', reason: 'T4' }, principal)
      ).rejects.toThrow('REFUND_METHOD_MISMATCH');
    });

    it('REFUND-DB-015: Initiate concurrent with pending refunds > refundableAmount -> REFUND_EXCEEDS_REFUNDABLE', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentAmount: '500.00' });
      await service.initiateRefund(order.id, { paymentId: payment.id, amount: '300.00', method: 'CARD', reason: 'T15A' }, principal);
      
      await expect(
        service.initiateRefund(order.id, { paymentId: payment.id, amount: '300.00', method: 'CARD', reason: 'T15B' }, principal)
      ).rejects.toThrow('REFUND_EXCEEDS_REFUNDABLE');
    });

    it('REFUND-DB-016: Confirm CASH requires open shift -> ForbiddenException', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentMethod: 'CASH', paymentAmount: '500.00' });
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CASH', reason: 'T16' }, principal);
      
      // Close the shift manually
      await fixture.prisma.cashierShift.updateMany({ where: { cashierId: principal.userId }, data: { status: 'CLOSED' } });
      
      await expect(
        service.confirmRefund(refund.id, principal)
      ).rejects.toThrow('SHIFT_REQUIRED');
    });

  });

  describe('Confirm concurrency & atomicity', () => {
    it('REFUND-DB-005: Concurrency - two concurrent confirms of separate PENDING refunds totalling more than refundable', async () => {
      // Setup payment with 600 refundable.
      const { org, branch, user, principal, order, payment } = await setupRefundTestState({ paymentAmount: '600.00' });
      
      // Directly inject two PENDING refunds of 400 each (total 800) to bypass initiate check.
      const r1 = await fixture.prisma.refund.create({
        data: { organizationId: org.id, branchId: branch.id, orderId: order.id, paymentId: payment.id, amount: '400.00', method: 'CARD', status: 'PENDING', reason: 'R1', initiatedById: user.id }
      });
      const r2 = await fixture.prisma.refund.create({
        data: { organizationId: org.id, branchId: branch.id, orderId: order.id, paymentId: payment.id, amount: '400.00', method: 'CARD', status: 'PENDING', reason: 'R2', initiatedById: user.id }
      });

      const results = await Promise.allSettled([
        service.confirmRefund(r1.id, principal),
        service.confirmRefund(r2.id, principal)
      ]);

      const fulfilled = results.filter(r => r.status === 'fulfilled');
      const rejected = results.filter(r => r.status === 'rejected');

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      expect((rejected[0] as PromiseRejectedResult).reason.message).toBe('REFUND_EXCEEDS_REFUNDABLE');

      const pAfter = await fixture.prisma.payment.findUnique({ where: { id: payment.id } });
      // 600 - 400 = 200
      expect(pAfter!.refundableAmount.toString()).toBe('200');
      // Verify no negative value
      expect(pAfter!.refundableAmount.isNegative()).toBe(false);
    });

    it('REFUND-DB-006: Idempotency: Replaying the same Idempotency-Key on initiate returns the same refund', async () => {
      const { principal, order, payment } = await setupRefundTestState();
      const ik = `init-key-${Date.now()}`;
      
      const r1 = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'A' }, principal, ik);
      const r2 = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'A' }, principal, ik);
      
      expect(r1.id).toBe(r2.id);
      
      const count = await fixture.prisma.refund.count({ where: { paymentId: payment.id, id: r1.id } });
      expect(count).toBe(1);
    });

    it('REFUND-DB-007: Idempotency: Same on confirm', async () => {
      const { principal, order, payment } = await setupRefundTestState();
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'A' }, principal);
      
      const ik = `confirm-key-${Date.now()}`;
      const c1 = await service.confirmRefund(refund.id, principal, ik);
      const c2 = await service.confirmRefund(refund.id, principal, ik);
      
      expect(c1.status).toBe('CONFIRMED');
      expect(c1.id).toBe(c2.id);
      
      const pAfter = await fixture.prisma.payment.findUnique({ where: { id: payment.id } });
      expect(pAfter!.version).toBe(payment.version + 1); // Incremented exactly once
    });

    it('REFUND-DB-008: Successful confirm: payment.status transitions PARTIALLY_REFUNDED, order paymentStatus transitions PARTIALLY_REFUNDED, order status unchanged', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentAmount: '1000.00' });
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '200.00', method: 'CARD', reason: 'A' }, principal);
      await service.confirmRefund(refund.id, principal);
      
      const pAfter = await fixture.prisma.payment.findUnique({ where: { id: payment.id } });
      expect(pAfter!.status).toBe('PARTIALLY_REFUNDED');
      expect(pAfter!.refundableAmount.toString()).toBe('800');

      const oAfter = await fixture.prisma.order.findUnique({ where: { id: order.id } });
      expect(oAfter!.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(oAfter!.status).toBe('COMPLETED'); // Unchanged
    });

    it('REFUND-DB-009: Full refund: payment.status = FULLY_REFUNDED, order paymentStatus = REFUNDED', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentAmount: '100.00' });
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '100.00', method: 'CARD', reason: 'Full' }, principal);
      await service.confirmRefund(refund.id, principal);
      
      const pAfter = await fixture.prisma.payment.findUnique({ where: { id: payment.id } });
      expect(pAfter!.status).toBe('FULLY_REFUNDED');
      expect(pAfter!.refundableAmount.toString()).toBe('0');

      const oAfter = await fixture.prisma.order.findUnique({ where: { id: order.id } });
      expect(oAfter!.paymentStatus).toBe('REFUNDED');
    });
  });

  describe('Approval workflow', () => {
    it('REFUND-DB-010: Amount > cashier limit creates ApprovalRequest in PENDING', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentAmount: '1000.00' });
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'Big' }, principal);
      
      const ar = await fixture.prisma.approvalRequest.findFirst({ where: { entityId: refund.id } });
      expect(ar).not.toBeNull();
      expect(ar!.status).toBe('PENDING');
    });

    it('REFUND-DB-011: approveRefund transitions refund to APPROVED and ApprovalRequest to APPROVED', async () => {
      const { org, principal, order, payment } = await setupRefundTestState({ paymentAmount: '1000.00' });
    const manager = await fixture.prisma.user.create({ data: { organizationId: org.id, username: `m-${Date.now()}`, passwordHash: 'secret' } });
      const managerPrincipal = { ...principal, userId: manager.id, roles: ['MANAGER'], permissions: ['refund.create', 'refund.confirm', 'refund.approve', 'org.admin'] };

      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'Big' }, principal);
      const approved = await service.approveRefund(refund.id, managerPrincipal);
      
      expect(approved.status).toBe('APPROVED');
      
      const ar = await fixture.prisma.approvalRequest.findFirst({ where: { entityId: refund.id } });
      expect(ar!.status).toBe('APPROVED');
    });

    it('REFUND-DB-012: Self-approval blocked', async () => {
      const { principal, order, payment } = await setupRefundTestState({ paymentAmount: '1000.00' });
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '600.00', method: 'CARD', reason: 'Big' }, principal);
      
      await expect(
        service.approveRefund(refund.id, principal)
      ).rejects.toThrow('SELF_APPROVAL_FORBIDDEN');
    });
  });

  describe('Cash movement', () => {
    it('REFUND-DB-013: Cash refund creates CashMovement and decrements shift.expectedCash', async () => {
      const { principal, order, payment, shift } = await setupRefundTestState({ 
        paymentMethod: 'CASH', 
        paymentAmount: '100.00', 
        shiftExpectedCash: '500.00' 
      });
      
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '50.00', method: 'CASH', reason: 'CashRefund' }, principal);
      await service.confirmRefund(refund.id, principal);
      
      const cm = await fixture.prisma.cashMovement.findFirst({ where: { sourceId: refund.id } });
      expect(cm).not.toBeNull();
      expect(cm!.type).toBe('CASH_REFUND');
      expect(cm!.amount.toString()).toBe('50');

      const sAfter = await fixture.prisma.cashierShift.findUnique({ where: { id: shift!.id } });
      expect(sAfter!.expectedCash.toString()).toBe('450'); // 500 - 50 = 450
    });

    it('REFUND-DB-014: Cash refund with drawer balance < refund amount -> INSUFFICIENT_DRAWER_CASH, no state change', async () => {
      const { principal, order, payment, shift } = await setupRefundTestState({ 
        paymentMethod: 'CASH', 
        paymentAmount: '100.00', 
        shiftExpectedCash: '20.00' 
      });
      
      const refund = await service.initiateRefund(order.id, { paymentId: payment.id, amount: '50.00', method: 'CASH', reason: 'CashRefund' }, principal);
      
      await expect(
        service.confirmRefund(refund.id, principal)
      ).rejects.toThrow('INSUFFICIENT_DRAWER_CASH');

      const cm = await fixture.prisma.cashMovement.findFirst({ where: { sourceId: refund.id } });
      expect(cm).toBeNull(); // no movement

      const sAfter = await fixture.prisma.cashierShift.findUnique({ where: { id: shift!.id } });
      expect(sAfter!.expectedCash.toString()).toBe('20'); // unchanged
    });
  });
});
