import { getIntegrationFixture } from '../fixture.js';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../src/prisma/prisma.service.js';
import { PaymentsService } from '../../../src/payments/payments.service.js';
import { AppModule } from '../../../src/app.module.js';
import { ConflictException, BadRequestException, ForbiddenException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';
import { Prisma } from '@prisma/client';

describe('PaymentsService (Integration)', () => {
  let service: PaymentsService;
  let prisma: PrismaService;
  let branchId: string;
  let organizationId: string;
  let principal: AuthenticatedPrincipal;
  let shiftId: string;

  beforeAll(async () => {
    const fixture = await getIntegrationFixture();
    prisma = fixture.prisma;
    service = fixture.app.get(PaymentsService);
  });

  

  beforeEach(async () => {
    await prisma.cashMovement.deleteMany({});
    await prisma.payment.deleteMany({});
    await prisma.orderItem.deleteMany({});
    await prisma.order.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({});

    
    
    let branch = await prisma.branch.findFirst();
    if (!branch) {
      const org = await prisma.organization.create({ data: { name: 'Org', slug: 'org-' + require('crypto').randomUUID() } });
      branch = await prisma.branch.create({ data: { name: 'Branch', organizationId: org.id } });
    }
    let user = await prisma.user.findFirst();
    if (!user) {
      user = await prisma.user.create({ data: { username: 'user-' + require('crypto').randomUUID(), passwordHash: 'hash', isActive: true, organizationId: branch.organizationId } });
    }
    let emp = await prisma.employee.findUnique({ where: { userId: user.id } }); if (!emp) { emp = await prisma.employee.create({ data: { userId: user.id, firstName: 'A', lastName: 'B', role: 'CASHIER' } }); }
    branchId = branch.id;
    organizationId = branch.organizationId;
    principal = {
      userId: user.id,
      organizationId,
      branchIds: [branch.id],
      permissions: ['payment.collect', 'payment.confirm', 'payment.view'],
    };

    const shift = await prisma.cashierShift.create({
      data: {
        organizationId,
        branchId,
        cashierId: user.id,
        status: 'OPEN',
        openingFloat: 100,
        expectedCash: 100
      }
    });
    shiftId = shift.id;
  });

  async function createOrder(totalAmount: number): Promise<string> {
    const count = await prisma.order.count();
    const orderNumber = `ORD-${Date.now()}-${count}`;
    const order = await prisma.order.create({
      data: {
        organizationId,
        branchId,
        orderNumber,
        type: 'DINE_IN',
        status: 'SUBMITTED',
        paymentStatus: 'UNPAID',
        subtotal: totalAmount,
        totalAmount: totalAmount,
        taxAmount: 0,
        serviceChargeAmount: 0,
        discountAmount: 0,
        currency: 'USD',
      }
    });
    return order.id;
  }

  it('PAY-DB-001: Exact cash payment (applied == tendered == total)', async () => {
    const orderId = await createOrder(100);
    const pay = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal);

    expect(pay.status).toBe('CONFIRMED');
    expect(pay.changeAmount).toBe('0');
    expect(pay.appliedAmount).toBe('100');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');

    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    expect(shift.expectedCash.toString()).toBe('200'); // 100 + 100
  });

  it('PAY-DB-002: Cash overpayment (tendered > total)', async () => {
    const orderId = await createOrder(50);
    const pay = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 50
    }, principal);

    expect(pay.status).toBe('CONFIRMED');
    expect(pay.changeAmount).toBe('50');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');
    
    const shift = await prisma.cashierShift.findUnique({ where: { id: shiftId } });
    expect(shift.expectedCash.toString()).toBe('150'); // 100 + 50 applied
  });

  it('PAY-DB-003: Underpayment (tendered < applied) rejected', async () => {
    const orderId = await createOrder(100);
    await expect(service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 50,
      appliedAmount: 100
    }, principal)).rejects.toThrow(BadRequestException);
  });

  it('PAY-DB-004: Payment collection rejected if no open shift', async () => {
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({}); // No shift
    const orderId = await createOrder(100);
    
    await expect(service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal)).rejects.toThrow(ForbiddenException);
  });

  it('PAY-DB-005: Partial payment', async () => {
    const orderId = await createOrder(430);
    const pay1 = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 300,
      appliedAmount: 300
    }, principal);

    expect(pay1.status).toBe('CONFIRMED');
    
    let order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PARTIALLY_PAID');

    const pay2 = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 130,
      appliedAmount: 130
    }, principal);

    expect(pay2.status).toBe('CONFIRMED');

    order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');
  });

  it('PAY-DB-006: Digital payment is PENDING_VERIFICATION', async () => {
    const orderId = await createOrder(100);
    const pay = await service.createPayment(orderId, {
      method: 'CARD',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal);

    expect(pay.status).toBe('PENDING_VERIFICATION');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAYMENT_PENDING');
  });

  it('PAY-DB-007: Confirm digital payment', async () => {
    const orderId = await createOrder(100);
    const pay = await service.createPayment(orderId, {
      method: 'CARD',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal);

    const confirmed = await service.confirmPayment(pay.id, {}, principal);
    expect(confirmed.status).toBe('CONFIRMED');

    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');
  });

  it('PAY-DB-008: Reject payment if applied exceeds balance', async () => {
    const orderId = await createOrder(100);
    
    await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 60,
      appliedAmount: 60
    }, principal);

    // Balance is 40. Try to pay 50.
    await expect(service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 50,
      appliedAmount: 50
    }, principal)).rejects.toThrow(ConflictException);
  });

  it('PAY-DB-009: Idempotency works on create', async () => {
    const orderId = await createOrder(100);
    const key = 'pay-create-123';
    const pay1 = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal, key);
    
    const pay2 = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal, key);

    expect(pay1.id).toBe(pay2.id);
  });

  it('PAY-DB-010: Idempotency works on confirm', async () => {
    const orderId = await createOrder(100);
    const pay = await service.createPayment(orderId, {
      method: 'CARD',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal);

    const key = 'pay-confirm-123';
    const c1 = await service.confirmPayment(pay.id, {}, principal, key);
    const c2 = await service.confirmPayment(pay.id, {}, principal, key);

    expect(c1.id).toBe(c2.id);
    expect(c1.status).toBe('CONFIRMED');
    
    // Validate we don't apply it twice
    const order = await prisma.order.findUnique({ where: { id: orderId } });
    expect(order.paymentStatus).toBe('PAID');
  });

  it('PAY-DB-012: Concurrent confirm throws conflict', async () => {
    const orderId = await createOrder(100);
    const p1 = await service.createPayment(orderId, {
      method: 'CARD',
      tenderedAmount: 50,
      appliedAmount: 50,
      currency: 'USD'
    }, principal);

    const results = await Promise.allSettled([
      service.confirmPayment(p1.id, {}, principal),
      service.confirmPayment(p1.id, {}, principal),
      service.confirmPayment(p1.id, {}, principal)
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
  });

  
  it('PAY-DB-013: currency mismatch rejects creation', async () => {
    const orderId = await createOrder(100);
    // Order currency is USD, try to create a payment in EUR
    await expect(
      service.createPayment(orderId, {
        method: 'CASH',
        tenderedAmount: 10,
        appliedAmount: 10,
        currency: 'EUR'
      }, principal)
    ).rejects.toThrow('Currency mismatch');
  });

  it('PAY-DB-014: View payment works', async () => {
    const orderId = await createOrder(100);
    const pay = await service.createPayment(orderId, {
      method: 'CASH',
      currency: 'USD',
      tenderedAmount: 100,
      appliedAmount: 100
    }, principal);

    const fetched = await service.getPayment(pay.id, principal);
    expect(fetched.id).toBe(pay.id);
  });
});
