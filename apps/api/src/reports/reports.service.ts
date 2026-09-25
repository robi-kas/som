import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { COLLECTED_PAYMENT_STATUSES } from '../orders/orders.service.js';

const D = Prisma.Decimal;
const money = (v: Prisma.Decimal) => v.toFixed(2);

/**
 * Business days follow the cafe's clock, not UTC. Ethiopia is UTC+3 all year (no DST),
 * so a "day" runs 21:00 UTC → 21:00 UTC. Without this, everything sold after midnight
 * until 3am local time lands on the wrong day.
 */
function utcOffsetHours() {
  return Number(process.env.BUSINESS_UTC_OFFSET_HOURS ?? 3);
}

export function businessDayRange(date: string): { start: Date; end: Date } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('date must be YYYY-MM-DD');
  const start = new Date(`${date}T00:00:00.000Z`);
  start.setUTCHours(start.getUTCHours() - utcOffsetHours());
  const end = new Date(start.getTime() + 24 * 3600_000);
  return { start, end };
}

function localHour(d: Date) {
  return (d.getUTCHours() + utcOffsetHours() + 24) % 24;
}

function localDate(d: Date) {
  return new Date(d.getTime() + utcOffsetHours() * 3600_000).toISOString().slice(0, 10);
}

export function todayLocal() {
  return localDate(new Date());
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Configured display names for payment method codes ("TELEBIRR" → "Telebirr"). */
  private async methodNames(branchId: string) {
    const rows = await this.prisma.paymentMethod.findMany({ where: { branchId }, select: { code: true, name: true } });
    return new Map(rows.map((r) => [r.code, r.name]));
  }

  /**
   * Everything for one business day:
   * - sales: orders closed that day (what was sold)
   * - takings: money received that day, by payment method (what's in the drawer / bank)
   * - corrections: discounts, voids, refunds
   * - best sellers and busy hours
   */
  async getDailySalesReport(branchId: string, date: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'report.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const { start, end } = businessDayRange(date);
    return this.buildPeriod(branchId, start, end, principal);
  }

  /** Weekly / monthly view: the same numbers for a range, plus a per-day series for charts. */
  async getRangeReport(branchId: string, from: string, to: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'report.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const { start } = businessDayRange(from);
    const { end } = businessDayRange(to);
    if (end <= start) throw new BadRequestException('"to" must be on or after "from"');
    if (end.getTime() - start.getTime() > 400 * 24 * 3600_000) throw new BadRequestException('Range is limited to about a year');

    const summary = await this.buildPeriod(branchId, start, end, principal);

    const orders = await this.prisma.order.findMany({
      where: { organizationId: principal.organizationId, branchId, status: 'COMPLETED', closedAt: { gte: start, lt: end } },
      select: { closedAt: true, totalAmount: true },
    });
    const byDay = new Map<string, { sales: Prisma.Decimal; orders: number }>();
    for (let t = start.getTime(); t < end.getTime(); t += 24 * 3600_000) {
      byDay.set(localDate(new Date(t)), { sales: new D(0), orders: 0 });
    }
    for (const o of orders) {
      const key = localDate(o.closedAt!);
      const row = byDay.get(key) ?? { sales: new D(0), orders: 0 };
      row.sales = row.sales.add(o.totalAmount);
      row.orders += 1;
      byDay.set(key, row);
    }
    return {
      ...summary,
      from,
      to,
      series: [...byDay.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([day, r]) => ({ date: day, sales: money(r.sales), orders: r.orders })),
    };
  }

  private async buildPeriod(branchId: string, start: Date, end: Date, principal: AuthenticatedPrincipal) {
    const orgBranch = { organizationId: principal.organizationId, branchId };

    const orders = await this.prisma.order.findMany({
      where: { ...orgBranch, status: 'COMPLETED', closedAt: { gte: start, lt: end } },
      include: { items: { where: { status: { notIn: ['CANCELLED', 'VOIDED'] } }, include: { modifiers: true } } },
    });

    const sum = (pick: (o: (typeof orders)[number]) => Prisma.Decimal) => orders.reduce((a, o) => a.add(pick(o)), new D(0));
    const subtotal = sum((o) => o.subtotal);
    const discounts = sum((o) => o.discountAmount);
    const serviceCharge = sum((o) => o.serviceChargeAmount);
    const tax = sum((o) => o.taxAmount);
    const total = sum((o) => o.totalAmount);

    const payments = await this.prisma.payment.findMany({
      where: {
        organizationId: principal.organizationId,
        order: { branchId },
        status: { in: COLLECTED_PAYMENT_STATUSES },
        confirmedAt: { gte: start, lt: end },
      },
    });
    const methods = new Map<string, { count: number; total: Prisma.Decimal }>();
    for (const p of payments) {
      const row = methods.get(p.method) ?? { count: 0, total: new D(0) };
      row.count += 1;
      row.total = row.total.add(p.appliedAmount);
      methods.set(p.method, row);
    }
    const cashSales = methods.get('CASH')?.total ?? new D(0);
    const names = await this.methodNames(branchId);
    const takings = payments.reduce((a, p) => a.add(p.appliedAmount), new D(0));

    const refundRows = await this.prisma.refund.findMany({
      where: { ...orgBranch, status: 'CONFIRMED', confirmedAt: { gte: start, lt: end } },
    });
    const refunds = refundRows.reduce((a, r) => a.add(r.amount), new D(0));

    const voidRows = await this.prisma.voidRecord.findMany({
      where: { ...orgBranch, createdAt: { gte: start, lt: end } },
      include: { order: true },
    });
    const voidedItems = await this.prisma.orderItemStatusHistory.findMany({
      where: {
        toStatus: 'CANCELLED',
        fromStatus: { in: ['SENT_TO_KITCHEN', 'PREPARING', 'READY'] },
        createdAt: { gte: start, lt: end },
        orderItem: { branchId, organizationId: principal.organizationId },
      },
      include: { orderItem: true },
    });

    const products = new Map<string, { quantity: number; revenue: Prisma.Decimal }>();
    for (const o of orders) {
      for (const i of o.items) {
        const unit = i.modifiers.reduce((a, m) => a.add(m.priceDeltaSnapshot), i.unitPriceSnapshot);
        const row = products.get(i.productNameSnapshot) ?? { quantity: 0, revenue: new D(0) };
        row.quantity += i.quantity;
        row.revenue = row.revenue.add(unit.mul(i.quantity));
        products.set(i.productNameSnapshot, row);
      }
    }
    const ranked = [...products.entries()]
      .map(([name, r]) => ({ name, quantity: r.quantity, revenue: money(r.revenue) }))
      .sort((a, b) => b.quantity - a.quantity || Number(b.revenue) - Number(a.revenue));

    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, sales: new D(0) }));
    for (const o of orders) {
      const h = hours[localHour(o.closedAt!)];
      h.orders += 1;
      h.sales = h.sales.add(o.totalAmount);
    }

    const netSales = total.sub(refunds);
    const orderCount = orders.length;
    return {
      // Kept for existing clients:
      grossSales: money(subtotal),
      discounts: money(discounts),
      refunds: money(refunds),
      netSales: money(netSales),
      cashSales: money(cashSales),
      digitalSales: money(takings.sub(cashSales)),
      orderCount,
      averageOrderValue: money(orderCount ? total.div(orderCount) : new D(0)),
      // Fuller breakdown:
      serviceCharge: money(serviceCharge),
      tax: money(tax),
      totalBilled: money(total),
      takings: money(takings),
      payments: [...methods.entries()].map(([method, r]) => ({ method, name: names.get(method) ?? method, count: r.count, total: money(r.total) })),
      voids: {
        orders: voidRows.length,
        ordersValue: money(voidRows.reduce((a, v) => a.add(v.order.subtotal), new D(0))),
        items: voidedItems.length,
        itemsValue: money(voidedItems.reduce((a, v) => a.add(v.orderItem.unitPriceSnapshot.mul(v.orderItem.quantity)), new D(0))),
      },
      refundCount: refundRows.length,
      topProducts: ranked.slice(0, 10),
      slowProducts: ranked.slice(-5).reverse(),
      hourly: hours.filter((h) => h.orders > 0).map((h) => ({ hour: h.hour, orders: h.orders, sales: money(h.sales) })),
    };
  }

  /** The manager's live screen. Everything here is "right now". */
  async getOperationalDashboard(branchId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'report.view');
    await assertBranchAccess(this.prisma, principal, branchId);
    const { start } = businessDayRange(todayLocal());
    const orgBranch = { organizationId: principal.organizationId, branchId };
    const config = await this.prisma.branchConfiguration.findUnique({ where: { branchId } });
    const lateBefore = new Date(Date.now() - (config?.ticketLateMinutes ?? 12) * 60_000);

    const [
      closedToday,
      openOrdersCount,
      tables,
      lateTickets,
      printerProblems,
      printersOffline,
      openShifts,
      pendingVerifications,
      pendingRefunds,
      pendingVariances,
      takingsToday,
    ] = await Promise.all([
      this.prisma.order.findMany({ where: { ...orgBranch, status: 'COMPLETED', closedAt: { gte: start } }, select: { totalAmount: true } }),
      this.prisma.order.count({ where: { ...orgBranch, status: { notIn: ['COMPLETED', 'VOIDED', 'CANCELLED'] } } }),
      this.prisma.table.findMany({ where: { ...orgBranch, isActive: true }, select: { status: true } }),
      this.prisma.kitchenTicket.count({ where: { ...orgBranch, status: { in: ['PENDING', 'PREPARING'] }, ticketType: { not: 'CANCELLATION' }, firedAt: { lt: lateBefore } } }),
      this.prisma.printerJob.count({ where: { printer: { branchId }, status: { in: ['FAILED', 'FAILED_PERMANENT'] }, createdAt: { gte: start } } }),
      this.prisma.printer.count({ where: { branchId, isActive: true, status: 'OFFLINE' } }),
      this.prisma.cashierShift.findMany({ where: { ...orgBranch, status: 'OPEN' }, select: { cashierId: true } }),
      this.prisma.payment.count({ where: { organizationId: principal.organizationId, order: { branchId }, status: 'PENDING_VERIFICATION' } }),
      this.prisma.refund.count({ where: { ...orgBranch, status: 'PENDING' } }),
      this.prisma.cashierShift.count({ where: { ...orgBranch, status: 'CLOSING' } }),
      this.prisma.payment.findMany({
        where: { organizationId: principal.organizationId, order: { branchId }, status: { in: COLLECTED_PAYMENT_STATUSES }, confirmedAt: { gte: start } },
        select: { appliedAmount: true, method: true },
      }),
    ]);

    const todaySales = closedToday.reduce((a, o) => a.add(o.totalAmount), new D(0));
    const names = await this.methodNames(branchId);
    const byMethod = new Map<string, Prisma.Decimal>();
    for (const p of takingsToday) byMethod.set(p.method, (byMethod.get(p.method) ?? new D(0)).add(p.appliedAmount));

    return {
      todaySales: money(todaySales),
      ordersClosedToday: closedToday.length,
      averageOrderValue: money(closedToday.length ? todaySales.div(closedToday.length) : new D(0)),
      takingsByMethod: [...byMethod.entries()].map(([method, total]) => ({ method, name: names.get(method) ?? method, total: money(total) })),
      openOrdersCount,
      tablesTotal: tables.length,
      occupiedTablesCount: tables.filter((t) => t.status === 'OCCUPIED').length,
      tablesWaitingForPaymentCount: tables.filter((t) => t.status === 'WAITING_FOR_PAYMENT').length,
      ordersWaitingTooLongCount: lateTickets,
      printerFailuresCount: printerProblems,
      printersOffline,
      activeEmployeesCount: new Set(openShifts.map((s) => s.cashierId)).size,
      needsAttention: {
        paymentVerifications: pendingVerifications,
        refundApprovals: pendingRefunds,
        drawerVariances: pendingVariances,
        lateTickets,
        printerProblems: printerProblems + printersOffline,
      },
    };
  }

  async getCashVarianceReport(branchId: string, dateFrom: string, dateTo: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'report.view_financial');
    await assertBranchAccess(this.prisma, principal, branchId);
    const { start } = businessDayRange(dateFrom);
    const { end } = businessDayRange(dateTo);

    const shifts = await this.prisma.cashierShift.findMany({
      where: { organizationId: principal.organizationId, branchId, openedAt: { gte: start, lt: end } },
      include: { reconciliation: true },
      orderBy: { openedAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({ where: { id: { in: shifts.map((s) => s.cashierId) } }, include: { employee: true } });

    return shifts.map((shift) => {
      const u = users.find((x) => x.id === shift.cashierId);
      return {
        shiftId: shift.id,
        cashierId: shift.cashierId,
        cashierName: u?.employee ? `${u.employee.firstName} ${u.employee.lastName}`.trim() : u?.username,
        openedAt: shift.openedAt,
        closedAt: shift.closedAt,
        status: shift.status,
        expectedCash: money(shift.expectedCash),
        actualCash: shift.actualCash ? money(shift.actualCash) : null,
        variance: shift.variance ? money(shift.variance) : null,
        varianceStatus: shift.reconciliation ? shift.reconciliation.status : null,
      };
    });
  }

  /** CSV of every closed order in a range, for the accountant's spreadsheet. */
  async exportOrdersCsv(branchId: string, from: string, to: string, principal: AuthenticatedPrincipal): Promise<string> {
    requirePermission(principal, 'report.view_financial');
    await assertBranchAccess(this.prisma, principal, branchId);
    const { start } = businessDayRange(from);
    const { end } = businessDayRange(to);

    const orders = await this.prisma.order.findMany({
      where: { organizationId: principal.organizationId, branchId, status: { in: ['COMPLETED', 'VOIDED'] }, closedAt: { gte: start, lt: end } },
      include: { table: true, payments: { where: { status: { in: COLLECTED_PAYMENT_STATUSES } } }, waiter: true },
      orderBy: { closedAt: 'asc' },
    });

    // Prefix cells that start with =, +, - or @ so spreadsheets don't execute them as formulas.
    const cell = (v: unknown) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = `'${s}`;
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['closed_at', 'order_number', 'status', 'table', 'waiter', 'subtotal', 'discount', 'service', 'vat', 'total', 'paid', 'methods'];
    const rows = orders.map((o) =>
      [
        o.closedAt?.toISOString(),
        o.orderNumber,
        o.status,
        o.table?.name ?? 'Takeaway',
        o.waiter?.username ?? '',
        money(o.subtotal),
        money(o.discountAmount),
        money(o.serviceChargeAmount),
        money(o.taxAmount),
        money(o.totalAmount),
        money(o.payments.reduce((a, p) => a.add(p.appliedAmount), new D(0))),
        [...new Set(o.payments.map((p) => p.method))].join('+'),
      ]
        .map(cell)
        .join(','),
    );
    return [header.join(','), ...rows].join('\n') + '\n';
  }
}
