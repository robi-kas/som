import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { ReportsService } from '../../../src/reports/reports.service.js';

describe('Phase 3J Reports Integration', () => {
  let fixture: IntegrationTestFixture;
  let orgId: string;
  let branchId: string;
  let branchId2: string;
  let userId: string;
  let principal: any;
  let reportsService: ReportsService;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    reportsService = fixture.app.get(ReportsService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
    orgId = `org-${crypto.randomBytes(4).toString('hex')}`;
    branchId = `b1-${crypto.randomBytes(4).toString('hex')}`;
    branchId2 = `b2-${crypto.randomBytes(4).toString('hex')}`;
    userId = `u1-${crypto.randomBytes(4).toString('hex')}`;

    await fixture.prisma.organization.create({
      data: { id: orgId, name: orgId, slug: orgId }
    });
    await fixture.prisma.branch.createMany({
      data: [
        { id: branchId, organizationId: orgId, name: 'B1' },
        { id: branchId2, organizationId: orgId, name: 'B2' }
      ]
    });
    await fixture.prisma.user.create({
      data: { id: userId, organizationId: orgId, username: userId, passwordHash: 'pwd' }
    });

    principal = {
      userId,
      organizationId: orgId,
      branchIds: [branchId],
      permissions: ['report.view', 'report.view_financial'],
    };
  });

  it('REPORT-INT-001: daily sales: cash + card orders, refunds subtracted, discounts subtracted', async () => {
    const today = new Date().toISOString().split('T')[0];
    
    const o1 = await fixture.prisma.order.create({
      data: {
        organizationId: orgId, branchId, orderNumber: '1', status: 'COMPLETED', paymentStatus: 'PAID', currency: 'USD',
        totalAmount: 20, discountAmount: 5,
        payments: {
          create: [{ organizationId: orgId, tenderedAmount: 15, appliedAmount: 15, currency: 'USD', method: 'CASH', status: 'COMPLETED', receivedById: userId }]
        }
      }
    });

    const o2 = await fixture.prisma.order.create({
      data: {
        organizationId: orgId, branchId, orderNumber: '2', status: 'COMPLETED', paymentStatus: 'PAID', currency: 'USD',
        totalAmount: 30, discountAmount: 0,
        payments: {
          create: [{ organizationId: orgId, tenderedAmount: 30, appliedAmount: 30, currency: 'USD', method: 'CARD', status: 'COMPLETED', receivedById: userId }]
        }
      }
    });

    const dummyPayment = await fixture.prisma.payment.create({
      data: {
        organizationId: orgId, orderId: o2.id, tenderedAmount: 0, appliedAmount: 0, currency: 'USD', method: 'CARD', status: 'COMPLETED', receivedById: userId
      }
    });

    await fixture.prisma.refund.create({
      data: {
        amount: 10, method: 'CARD', status: 'CONFIRMED', reason: 'r',
        organization: { connect: { id: orgId } },
        branch: { connect: { id: branchId } },
        order: { connect: { id: o2.id } },
        payment: { connect: { id: dummyPayment.id } },
        initiatedBy: { connect: { id: userId } }
      }
    });

    const report = await reportsService.getDailySalesReport(branchId, today, principal);
    expect(report.grossSales).toBe('50');
    expect(report.discounts).toBe('5');
    expect(report.refunds).toBe('10');
    expect(report.netSales).toBe('35');
    expect(report.cashSales).toBe('15');
    expect(report.digitalSales).toBe('30');
    expect(report.orderCount).toBe(2);
    expect(report.averageOrderValue).toBe('17.5');
  });

  it('REPORT-INT-002: cash variance report matches shift reconciliation data', async () => {
    const today = new Date().toISOString().split('T')[0];
    const s = await fixture.prisma.cashierShift.create({
      data: {
        organizationId: orgId, branchId, cashierId: userId, status: 'CLOSED',
        openingFloat: 100, expectedCash: 150, actualCash: 145, variance: -5,
        reconciliation: {
          create: { expectedCash: 150, actualCash: 145, variance: -5, openingFloat: 100, status: 'APPROVED' }
        }
      }
    });

    const report = await reportsService.getCashVarianceReport(branchId, today + 'T00:00:00Z', today + 'T23:59:59Z', principal);
    expect(report.length).toBe(1);
    expect(report[0].shiftId).toBe(s.id);
    expect(report[0].expectedCash).toBe('150');
    expect(report[0].actualCash).toBe('145');
    expect(report[0].variance).toBe('-5');
    expect(report[0].varianceStatus).toBe('APPROVED');
  });

  it('REPORT-INT-003: dashboard counts open orders, occupied tables, waiting-for-payment correctly', async () => {
    await fixture.prisma.order.createMany({
      data: [
        { organizationId: orgId, branchId, orderNumber: 'O1', currency: 'USD', status: 'DRAFT' },
        { organizationId: orgId, branchId, orderNumber: 'O2', currency: 'USD', status: 'SUBMITTED' }
      ]
    });
    await fixture.prisma.table.createMany({
      data: [
        { organizationId: orgId, branchId, name: 'T1', capacity: 2, status: 'OCCUPIED' },
        { organizationId: orgId, branchId, name: 'T2', capacity: 2, status: 'WAITING_FOR_PAYMENT' }
      ]
    });

    const dash = await reportsService.getOperationalDashboard(branchId, principal);
    expect(dash.openOrdersCount).toBe(2);
    expect(dash.occupiedTablesCount).toBe(1);
    expect(dash.tablesWaitingForPaymentCount).toBe(1);
  });

  it('REPORT-INT-004: dashboard excludes other branches', async () => {
    await fixture.prisma.order.create({
      data: { organizationId: orgId, branchId: branchId2, orderNumber: 'O3', currency: 'USD', status: 'DRAFT' }
    });
    const dash = await reportsService.getOperationalDashboard(branchId, principal);
    expect(dash.openOrdersCount).toBe(0);
  });

  it('REPORT-INT-005: ordersWaitingTooLong uses correct time threshold', async () => {
    const now = new Date();
    const twentyMinsAgo = new Date(now.getTime() - 20 * 60 * 1000);
    const tenMinsAgo = new Date(now.getTime() - 10 * 60 * 1000);
    
    await fixture.prisma.order.createMany({
      data: [
        { organizationId: orgId, branchId, orderNumber: 'O4', currency: 'USD', status: 'SUBMITTED', createdAt: twentyMinsAgo },
        { organizationId: orgId, branchId, orderNumber: 'O5', currency: 'USD', status: 'SUBMITTED', createdAt: tenMinsAgo }
      ]
    });

    const dash = await reportsService.getOperationalDashboard(branchId, principal);
    expect(dash.ordersWaitingTooLongCount).toBe(1);
  });
});
