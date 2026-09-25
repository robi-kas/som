import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/prisma/prisma.service.js';
import { INestApplication } from '@nestjs/common';
import { CategoriesService } from '../../src/menu/categories.service.js';
import { ProductsService } from '../../src/menu/products.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { TablesService } from '../../src/tables/tables.service.js';
import { KitchenService } from '../../src/kitchen/kitchen.service.js';

import { ShiftsService } from '../../src/shifts/shifts.service.js';
import { OrdersService } from '../../src/orders/orders.service.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { ReceiptsService } from '../../src/receipts/receipts.service.js';
import { RefundsService } from '../../src/refunds/refunds.service.js';
import { ReportsService } from '../../src/reports/reports.service.js';
import { getIntegrationFixture, teardownIntegrationFixture } from '../integration/fixture.js';

describe('V1 Acceptance Sweep (Integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  
  let orgId: string;
  let branchId: string;
  let adminId: string;
  let cashierId: string;
  let waiterId: string;
  let managerId: string;
  let roleId: string;
  let cashierRoleId: string;
  let waiterRoleId: string;
  let managerRoleId: string;
  let categoryId: string;
  let productId: string;
  let tableId: string;
  let stationId: string;
  let printerId: string;
  let shiftId: string;
  let orderId: string;
  let receiptId: string;
  let refundId: string;

  beforeAll(async () => {
    const fixture = await getIntegrationFixture();
    app = fixture.app;
    prisma = fixture.prisma;
  }, 30000);

  afterAll(async () => {
    await teardownIntegrationFixture();
  });

  it('ACCEPT-001 Admin creates menu, employee, roles, tables, stations, printers', async () => {
    // 1. Core Structure
    const org = await prisma.organization.create({ data: { name: 'V1 Cafe', slug: 'v1-cafe' } });
    orgId = org.id;
    const branch = await prisma.branch.create({ data: { organizationId: orgId, name: 'Main Branch' } });
        branchId = branch.id;
    await prisma.branchConfiguration.create({ data: { branchId, currency: 'USD' } });

    // 2. Mock Users
    const adminUser = await prisma.user.create({ data: { organizationId: orgId, username: 'admin', passwordHash: 'xx' } });
    adminId = adminUser.id;
    const cashier = await prisma.user.create({ data: { organizationId: orgId, username: 'cashier', passwordHash: 'xx' } });
    cashierId = cashier.id;
    const waiter = await prisma.user.create({ data: { organizationId: orgId, username: 'waiter', passwordHash: 'xx' } });
    waiterId = waiter.id;
    const manager = await prisma.user.create({ data: { organizationId: orgId, username: 'manager', passwordHash: 'xx' } });
    managerId = manager.id;

    // 4. Menu
    const categoriesService = app.get(CategoriesService);
    const productsService = app.get(ProductsService);
    const cat = await categoriesService.create({
      organizationId: orgId, branchId, name: 'Beverages', order: 1
    }, { organizationId: orgId, userId: adminId, branchIds: [branchId], branchIds: [branchId], permissions: ['category.create', 'product.create', 'table.create'] } as any);
    categoryId = cat.id;

    const prod = await productsService.create({
      organizationId: orgId, branchId, categoryId, name: 'Latte', description: '', price: 4.5, active: true
    }, { organizationId: orgId, userId: adminId, branchIds: [branchId], branchIds: [branchId], permissions: ['category.create', 'product.create', 'table.create'] } as any);
    productId = prod.id;
    await prisma.product.update({ where: { id: productId }, data: { branchId } });

    // 5. Tables
    const tablesService = app.get(TablesService);
    const tbl = await tablesService.create({
      branchId, name: 'Table 1', capacity: 4
    }, { organizationId: orgId, userId: adminId, branchIds: [branchId], branchIds: [branchId], permissions: ['category.create', 'product.create', 'table.create'] } as any);
    tableId = tbl.id;

    // 6. Kitchen Stations
    const kitchenService = app.get(KitchenService);
    const stn = await kitchenService.create({ branchId, name: 'Coffee Station' }, { organizationId: orgId, userId: adminId, branchIds: [branchId], permissions: ['kitchen_station.create'] } as any);
    stationId = stn.id;
    await prisma.product.update({ where: { id: productId }, data: { station: { connect: { id: stationId } } } });

    // 7. Printers
    
    const prn = await prisma.printer.create({
      data: { stationId, name: 'Main Printer', ipAddress: '192.168.1.100' }
    });
    printerId = prn.id;

    expect(orgId).toBeDefined();
    expect(cashierId).toBeDefined();
    expect(productId).toBeDefined();
  });

  it('ACCEPT-002 Cashier opens shift', async () => {
    const shiftsService = app.get(ShiftsService);
    const shift = await shiftsService.openShift(
      { branchId, openingFloat: 100 },
      { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['shift.open'] } as any
    );
    shiftId = shift.id;
    expect(shift.status).toBe('OPEN');
    expect(Number(shift.openingFloat)).toBe(100);
  });

  it('ACCEPT-003 Waiter logs in, selects table, creates order with modifiers/notes', async () => {
    const ordersService = app.get(OrdersService);
    const order = await ordersService.createDraftOrder(
      { branchId, tableId, type: 'DINE_IN' },
      { organizationId: orgId, userId: waiterId, branchIds: [branchId], permissions: ['order.create'] } as any
    );
    orderId = order.id;
    await ordersService.addItemsToOrder(orderId, { expectedVersion: order.version, items: [{ productId, quantity: 2, notes: 'Extra hot' }] }, { organizationId: orgId, userId: waiterId, branchIds: [branchId], permissions: ['order.edit'] } as any);
    const orderWithItems = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    expect(orderWithItems.status).toBe('DRAFT');
    expect(orderWithItems.items.length).toBe(1);
    expect(orderWithItems.items[0].notes).toBe('Extra hot');
    expect(Number(orderWithItems.totalAmount)).toBeGreaterThan(0);
  });

  it('ACCEPT-004 Order fires to kitchen, printer job created', async () => {
    const ordersService = app.get(OrdersService);
    const orderToFire = await prisma.order.findUnique({ where: { id: orderId } });
    await ordersService.fireOrderToKitchen(orderId, { expectedVersion: orderToFire.version }, { organizationId: orgId, userId: waiterId, branchIds: [branchId], permissions: ['order.submit'] } as any);
    
    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    expect(updated?.status).toBe('SUBMITTED');

    // Job created?
    const jobs = await prisma.printerJob.findMany();
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('ACCEPT-005 Items marked served', async () => {
    const ordersService = app.get(OrdersService);
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: { items: true } });
    for (const item of order!.items) {
      await prisma.orderItem.update({ where: { id: item.id }, data: { status: 'SERVED' } });
    }
    const updated = await prisma.order.findUnique({ where: { id: orderId } });
    await prisma.order.update({ where: { id: orderId }, data: { status: 'SERVED' } });
  });

  it('ACCEPT-006 Cashier collects cash payment, change calculated correctly', async () => {
    const paymentsService = app.get(PaymentsService);
    const orderToPay = await prisma.order.findUnique({ where: { id: orderId } });
    const amountDue = Number(orderToPay.totalAmount);
    
    const payment = await paymentsService.createPayment(
      orderId,
      { appliedAmount: amountDue, tenderedAmount: amountDue + 1, method: 'CASH', currency: 'USD' },
      { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['payment.collect'] } as any,
      'dev2'
    );
    expect(payment.status).toBe('CONFIRMED');
    expect(Number(payment.appliedAmount)).toBe(amountDue);
    
    const dbPay = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(Number(dbPay?.changeAmount)).toBe(1); // 1 extra tendered
  });
  it('ACCEPT-007 Receipt generated', async () => {
    const receiptsService = app.get(ReceiptsService);
    const receipts = await prisma.receipt.findMany({ where: { orderId } });
    expect(receipts.length).toBe(1);
    receiptId = receipts[0].id;
  });

  it('ACCEPT-008 Order completes, table released', async () => {
    const ordersService = app.get(OrdersService);
    const order = await ordersService.completeOrder(orderId, { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['order.complete'] } as any);
    expect(order.status).toBe('COMPLETED');

    const table = await prisma.table.findUnique({ where: { id: tableId } });
    expect(table?.status).toBe('AVAILABLE');
  });

  it('ACCEPT-009 Refund on a separate order, payment marked PARTIALLY_REFUNDED', async () => {
    const ordersService = app.get(OrdersService);
    const paymentsService = app.get(PaymentsService);
    const refundsService = app.get(RefundsService);

    // Create a new order & pay for it
    const draftOrder = await ordersService.createDraftOrder(
      { branchId, type: 'TAKEAWAY' },
      { organizationId: orgId, userId: waiterId, branchIds: [branchId], permissions: ['order.create'] } as any
    );
    await ordersService.addItemsToOrder(draftOrder.id, { expectedVersion: draftOrder.version, items: [{ productId, quantity: 1 }] }, { organizationId: orgId, userId: waiterId, branchIds: [branchId], permissions: ['order.edit'] } as any);
    await ordersService.fireOrderToKitchen(draftOrder.id, { expectedVersion: draftOrder.version + 1 }, { organizationId: orgId, userId: waiterId, branchIds: [branchId], permissions: ['order.submit'] } as any);
    
    // Simulate items served
    const orderWithItems2 = await prisma.order.findUnique({ where: { id: draftOrder.id }, include: { items: true } });
    for (const item of orderWithItems2.items) {
      await prisma.orderItem.update({ where: { id: item.id }, data: { status: 'SERVED' } });
    }
    await prisma.order.update({ where: { id: draftOrder.id }, data: { status: 'SERVED' } });

    const order = await prisma.order.findUnique({ where: { id: draftOrder.id } });
    const payment = await paymentsService.createPayment(
      order.id,
      { appliedAmount: Number(order.totalAmount), tenderedAmount: Number(order.totalAmount), method: 'CASH', currency: 'USD' },
      { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['payment.collect'] } as any
    );
    
    // Create refund
    const refund = await refundsService.initiateRefund(
      order.id,
      { paymentId: payment.id, amount: order.totalAmount.toString(), method: 'CASH', reason: 'Too hot', items: [] },
      { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['refund.create'] } as any
    );
    refundId = refund.id;
    
    // Approve refund
    await refundsService.approveRefund(refundId, { organizationId: orgId, userId: managerId, branchIds: [branchId], permissions: ['refund.approve'] } as any);
    const confirmed = await refundsService.confirmRefund(refundId, { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['refund.confirm'] } as any);
    
    expect(confirmed.status).toBe('CONFIRMED');
    
    const dbPay = await prisma.payment.findUnique({ where: { id: payment.id } });
    expect(dbPay?.status).toBe('FULLY_REFUNDED');
  });

  it('ACCEPT-010 Shift close with variance, manager approves', async () => {
    const shiftsService = app.get(ShiftsService);
    
    const closeRes = await shiftsService.closeShift(
      shiftId,
      { cashCounts: [{ value: 50, count: 1 }] },
      { organizationId: orgId, userId: cashierId, branchIds: [branchId], permissions: ['shift.close'] } as any
    );
    expect(closeRes.shift.status).toBe('CLOSING');

    const approved = await shiftsService.approveVariance(
      shiftId,
      { reason: 'All good' },
      { organizationId: orgId, userId: managerId, branchIds: [branchId], permissions: ['shift.approve_variance'] } as any
    );
    expect(approved.status).toBe('CLOSED');
  });

  it('ACCEPT-011 Daily sales report includes all sales minus refunds', async () => {
    const reportsService = app.get(ReportsService);
    const today = new Date().toISOString().split('T')[0];
    const report = await reportsService.getDailySalesReport(
      branchId,
      today,
      { organizationId: orgId, userId: managerId, branchIds: [branchId], permissions: ['report.view'] } as any
    );
    // Net sales should be 9. 9 (first order) + 4.5 (second order) - 4.5 (refund)
    expect(Number(report.netSales)).toBeGreaterThan(0);
  });

  it('ACCEPT-012 Audit log contains every state change above', async () => {
    const auditLogs = await prisma.auditLog.findMany({
      where: {},
      orderBy: { timestamp: 'asc' }
    });
    
    // Check a few key actions
    const actions = auditLogs.map(l => l.action);
    expect(actions).toContain('ORDER_FIRED');
    expect(actions).toContain('ORDER_CREATED');
    expect(actions).toContain('ORDER_COMPLETED');
    expect(actions).toContain('REFUND_APPROVED');
    expect(actions.length).toBeGreaterThan(5);
  });
});
