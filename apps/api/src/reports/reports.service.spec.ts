import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReportsService, businessDayRange } from './reports.service.js';
import { ReportsController } from './reports.controller.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

const D = (v: number | string) => new Prisma.Decimal(v);
const manager = { userId: 'm', sessionId: 's', organizationId: 'o1', branchIds: ['b1'], permissions: ['report.view', 'report.view_financial'] };

describe('Reports (Unit)', () => {
  let prisma: PrismaMock;
  let service: ReportsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'o1' });
    for (const m of ['order', 'payment', 'refund', 'voidRecord', 'orderItemStatusHistory', 'table', 'cashierShift', 'paymentMethod', 'user']) {
      prisma[m].findMany.mockResolvedValue([]);
    }
    service = new ReportsService(prisma as never);
  });

  it('REPORT-UNIT-001: each endpoint requires the right permission', async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: {} }, { provide: PrismaService, useValue: {} }],
    }).compile();
    const controller = module.get(ReportsController);
    const reflector = new Reflector();
    expect(reflector.get('permissions', controller.getDailySalesReport)).toEqual(['report.view_financial']);
    expect(reflector.get('permissions', controller.getOperationalDashboard)).toEqual(['report.view']);
    expect(reflector.get('permissions', controller.getCashVarianceReport)).toEqual(['report.view_financial']);
    expect(reflector.get('permissions', controller.exportCsv)).toEqual(['report.view_financial']);
  });

  it('business days run on Addis time (UTC+3), not UTC', () => {
    const { start, end } = businessDayRange('2026-09-25');
    expect(start.toISOString()).toBe('2026-09-24T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-25T21:00:00.000Z');
  });

  it('REPORT-UNIT-002: daily totals, money in by method, refunds and best sellers', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        subtotal: D(100), discountAmount: D(10), serviceChargeAmount: D(9), taxAmount: D('14.85'), totalAmount: D('113.85'),
        closedAt: new Date('2026-09-25T07:30:00Z'),
        items: [{ productNameSnapshot: 'Latte', quantity: 2, unitPriceSnapshot: D(50), modifiers: [] }],
      },
    ]);
    prisma.payment.findMany.mockResolvedValue([
      { method: 'CASH', appliedAmount: D(60) },
      { method: 'TELEBIRR', appliedAmount: D('53.85') },
    ]);
    prisma.refund.findMany.mockResolvedValue([{ amount: D(10) }]);
    prisma.paymentMethod.findMany.mockResolvedValue([{ code: 'TELEBIRR', name: 'Telebirr' }, { code: 'CASH', name: 'Cash' }]);

    const r = await service.getDailySalesReport('b1', '2026-09-25', manager);

    expect(r.grossSales).toBe('100.00');
    expect(r.discounts).toBe('10.00');
    expect(r.refunds).toBe('10.00');
    expect(r.netSales).toBe('103.85');
    expect(r.cashSales).toBe('60.00');
    expect(r.digitalSales).toBe('53.85');
    expect(r.payments.find((p) => p.method === 'TELEBIRR')?.name).toBe('Telebirr');
    expect(r.topProducts[0]).toMatchObject({ name: 'Latte', quantity: 2, revenue: '100.00' });
    expect(r.hourly[0]).toMatchObject({ hour: 10, orders: 1 }); // 07:30 UTC is 10:30 in Addis
  });

  it('REPORT-UNIT-003: dashboard returns all expected keys', async () => {
    const res = await service.getOperationalDashboard('b1', manager);
    for (const key of ['todaySales', 'openOrdersCount', 'occupiedTablesCount', 'tablesWaitingForPaymentCount', 'ordersWaitingTooLongCount', 'printerFailuresCount', 'activeEmployeesCount', 'needsAttention']) {
      expect(res).toHaveProperty(key);
    }
  });

  it('REPORT-UNIT-004: another organization’s branch is not found', async () => {
    prisma.branch.findFirst.mockResolvedValue(null);
    await expect(service.getDailySalesReport('b2', '2026-01-01', manager)).rejects.toThrow(NotFoundException);
  });

  it('refuses without report.view', async () => {
    await expect(service.getDailySalesReport('b1', '2026-01-01', { ...manager, permissions: [] })).rejects.toThrow(ForbiddenException);
  });

  it('CSV export neutralises spreadsheet formulas in text', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        closedAt: new Date('2026-09-25T08:00:00Z'), orderNumber: '1', status: 'COMPLETED', table: { name: '=HYPERLINK("x")' }, waiter: { username: 'hana' },
        subtotal: D(1), discountAmount: D(0), serviceChargeAmount: D(0), taxAmount: D(0), totalAmount: D(1), payments: [],
      },
    ]);
    const csv = await service.exportOrdersCsv('b1', '2026-09-25', '2026-09-25', manager);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
