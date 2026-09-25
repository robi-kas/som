import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEFAULT_PAYMENT_METHODS } from '../src/payments/default-methods.js';
const prisma = new PrismaClient();

/**
 * Seeds permissions, the five standard roles, and (outside production) a demo cafe.
 *
 *   SEED_ADMIN_PASSWORD   password for the "admin" user (required in production)
 *   SEED_DEMO=false       skip the demo menu, tables and staff
 */
async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  const withDemo = process.env.SEED_DEMO ? process.env.SEED_DEMO === 'true' : !isProd;

  const permissions = [
    'org.admin',
    'order.view', 'order.create', 'order.edit', 'order.submit', 'order.complete',
    'order.void', 'order.void_item', 'order.discount', 'order.discount_large',
    'table.view', 'table.create', 'table.update', 'table.status_update',
    'category.view', 'category.create', 'category.update', 'category.deactivate',
    'product.view', 'product.create', 'product.update', 'product.price_update', 'product.status_update',
    'payment.collect', 'payment.confirm', 'payment.view', 'payment.report',
    'refund.create', 'refund.approve', 'refund.view', 'refund.confirm',
    'shift.open', 'shift.close', 'shift.cash_movement', 'shift.view_own', 'shift.approve_variance', 'shift.view_report',
    'receipt.view', 'receipt.reprint',
    'kds.view', 'kds.update',
    'kitchen_station.create', 'kitchen_station.update', 'kitchen_station.deactivate',
    'printer.view', 'printer.retry', 'printer.reprint', 'printer.manage',
    'report.view', 'report.view_financial',
    'sync.submit', 'sync.view', 'sync.resolve_conflict',
    'user.manage',
    'settings.manage',
  ];

  for (const code of permissions) {
    await prisma.permission.upsert({
      where: { code },
      update: {},
      create: { code, description: code + ' permission' },
    });
  }

  const org = await prisma.organization.upsert({
    where: { slug: 'default' },
    update: {},
    create: { id: 'org-default', name: 'Default Cafe', slug: 'default' }
  });

  const branch = await prisma.branch.upsert({
    where: { id: 'branch-default' },
    update: {},
    create: { id: 'branch-default', name: 'Main Branch', organizationId: org.id }
  });

  await prisma.branchConfiguration.upsert({
    where: { branchId: branch.id },
    update: {},
    create: {
      branchId: branch.id,
      currency: 'ETB',
      taxRate: '15.00', // Ethiopian VAT
      isTaxInclusive: false,
      serviceChargeRate: '10.00',
      roundingMode: 'HALF_UP',
      varianceTolerance: '5.00',
      largeDiscountPercent: '10.00',
      cashierRefundLimit: '500.00',
    },
  });

  // Payment methods (Telebirr, CBE Birr, bank apps…). Existing rows are left as the owner set them.
  await prisma.paymentMethod.createMany({
    data: DEFAULT_PAYMENT_METHODS.map((d, i) => ({ ...d, branchId: branch.id, displayOrder: i + 1 })),
    skipDuplicates: true,
  });

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? (isProd ? null : 'admin123');
  if (!adminPassword) throw new Error('Set SEED_ADMIN_PASSWORD to seed a production database');
  const existingAdmin = await prisma.user.findUnique({
    where: { organizationId_username: { organizationId: org.id, username: 'admin' } },
  });
  const password = await bcrypt.hash(adminPassword, 12);
  const user = existingAdmin
    ? existingAdmin
    : await prisma.user.create({
        data: {
          organizationId: org.id,
          username: 'admin',
          passwordHash: password,
          isActive: true,
          // Must be replaced on first login in production.
          forcePasswordChange: isProd,
        },
      });
  await prisma.employee.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, firstName: 'Cafe', lastName: 'Admin', role: 'Admin' },
  });

  // --- DEMO DATA START ---
  if (withDemo) {
  const categories = [
    { name: 'Coffee', displayOrder: 1 },
    { name: 'Tea', displayOrder: 2 },
    { name: 'Juice & cold', displayOrder: 3 },
    { name: 'Food', displayOrder: 4 },
    { name: 'Desserts', displayOrder: 5 },
  ];
  const createdCategories: Record<string, string> = {};
  for (const cat of categories) {
    const c = await prisma.category.upsert({
      where: { branchId_name: { branchId: branch.id, name: cat.name } },
      update: { displayOrder: cat.displayOrder },
      create: { name: cat.name, displayOrder: cat.displayOrder, branchId: branch.id, organizationId: org.id }
    });
    createdCategories[cat.name] = c.id;
  }

  const stations = [
    // Each station gets its own screen and printer: hot drinks never wait behind burgers.
    { name: 'Coffee', displayOrder: 1 },
    { name: 'Juice', displayOrder: 2 },
    { name: 'Kitchen', displayOrder: 3 },
  ];
  const createdStations: Record<string, string> = {};
  for (const st of stations) {
    const s = await prisma.kitchenStation.upsert({
      where: { branchId_name: { branchId: branch.id, name: st.name } },
      update: { displayOrder: st.displayOrder },
      create: { name: st.name, displayOrder: st.displayOrder, branchId: branch.id, organizationId: org.id }
    });
    createdStations[st.name] = s.id;
  }

  const productsData = [
    { category: 'Coffee', station: 'Coffee', name: 'Buna (jebena)', price: '40' },
    { category: 'Coffee', station: 'Coffee', name: 'Macchiato', price: '55' },
    { category: 'Coffee', station: 'Coffee', name: 'Americano', price: '50' },
    { category: 'Coffee', station: 'Coffee', name: 'Latte', price: '65' },
    { category: 'Coffee', station: 'Coffee', name: 'Cappuccino', price: '60' },
    { category: 'Tea', station: 'Coffee', name: 'Shai (black tea)', price: '30' },
    { category: 'Tea', station: 'Coffee', name: 'Spris (tea + coffee)', price: '45' },
    { category: 'Tea', station: 'Coffee', name: 'Green Tea', price: '35' },
    { category: 'Juice & cold', station: 'Juice', name: 'Avocado juice', price: '90' },
    { category: 'Juice & cold', station: 'Juice', name: 'Mango juice', price: '80' },
    { category: 'Juice & cold', station: 'Juice', name: 'Spris juice (layered)', price: '95' },
    { category: 'Juice & cold', station: 'Juice', name: 'Soft drink', price: '40' },
    { category: 'Juice & cold', station: 'Juice', name: 'Water 0.5L', price: '20' },
    { category: 'Food', station: 'Kitchen', name: 'Club Sandwich', price: '180' },
    { category: 'Food', station: 'Kitchen', name: 'Cheeseburger', price: '200' },
    { category: 'Food', station: 'Kitchen', name: 'Fries', price: '90' },
    { category: 'Food', station: 'Kitchen', name: 'Caesar Salad', price: '150' },
    { category: 'Desserts', station: 'Kitchen', name: 'Cheesecake', price: '110' },
    { category: 'Desserts', station: 'Kitchen', name: 'Chocolate Brownie', price: '95' },
  ];

  // Older seeds put drinks on a "Bar" station; move anything left there to Coffee.
  const oldBar = await prisma.kitchenStation.findFirst({ where: { branchId: branch.id, name: 'Bar' } });
  if (oldBar) {
    await prisma.product.updateMany({ where: { preparationStationId: oldBar.id }, data: { preparationStationId: createdStations['Coffee'] } });
    await prisma.kitchenStation.update({ where: { id: oldBar.id }, data: { isActive: false } });
  }

  for (const p of productsData) {
    const catId = createdCategories[p.category];
    const statId = createdStations[p.station];
    let prod = await prisma.product.findFirst({ where: { branchId: branch.id, name: p.name } });
    if (prod) {
      await prisma.product.update({
        where: { id: prod.id },
        data: { sellingPrice: p.price, categoryId: catId, preparationStationId: statId }
      });
    } else {
      await prisma.product.create({
        data: { name: p.name, sellingPrice: p.price, categoryId: catId, preparationStationId: statId, branchId: branch.id, organizationId: org.id }
      });
    }
  }

  for (let i = 1; i <= 8; i++) {
    const tName = `T${i}`;
    const cap = i % 2 === 1 ? 2 : 4;
    await prisma.table.upsert({
      where: { branchId_name: { branchId: branch.id, name: tName } },
      update: { capacity: cap, status: 'AVAILABLE' },
      create: { name: tName, capacity: cap, branchId: branch.id, organizationId: org.id, status: 'AVAILABLE' }
    });
  }

  const addOns: Record<string, { name: string; price: string }[]> = {
    Macchiato: [{ name: 'Extra shot', price: '20' }, { name: 'Oat milk', price: '15' }],
    Latte: [{ name: 'Extra shot', price: '20' }, { name: 'Oat milk', price: '15' }, { name: 'Caramel', price: '10' }],
    Cappuccino: [{ name: 'Extra shot', price: '20' }, { name: 'Cinnamon', price: '0' }],
    Cheeseburger: [{ name: 'No onions', price: '0' }, { name: 'Extra cheese', price: '25' }, { name: 'Add egg', price: '20' }],
    'Club Sandwich': [{ name: 'No mayo', price: '0' }, { name: 'Add fries', price: '60' }],
    Fries: [{ name: 'Extra ketchup', price: '0' }],
  };
  for (const [productName, mods] of Object.entries(addOns)) {
    const prod = await prisma.product.findFirst({ where: { branchId: branch.id, name: productName } });
    if (!prod) continue;
    for (const [i, m] of mods.entries()) {
      const exists = await prisma.productModifier.findFirst({ where: { productId: prod.id, name: m.name } });
      if (!exists) {
        await prisma.productModifier.create({
          data: { organizationId: org.id, productId: prod.id, name: m.name, priceDelta: m.price, displayOrder: i },
        });
      }
    }
  }
  }
  // --- DEMO DATA END ---

  // Waiters take orders and serve; anything after the kitchen has started needs a manager PIN.
  const waiterPerms = ['order.create', 'order.edit', 'order.submit', 'order.view', 'table.view', 'category.view', 'product.view', 'sync.submit', 'sync.view', 'payment.report'];
  // Cashiers take money. Verifying digital payments (payment.confirm) is a manager job: four eyes.
  const cashierPerms = [
    'order.view', 'order.edit', 'order.submit', 'order.discount', 'order.complete', 'table.view', 'category.view', 'product.view',
    'payment.collect', 'payment.confirm', 'payment.view', 'payment.report', 'shift.open', 'shift.close', 'shift.cash_movement', 'shift.view_own',
    'receipt.view', 'receipt.reprint', 'refund.create', 'refund.confirm', 'refund.view', 'printer.view', 'printer.retry',
  ];
  // Station staff (chef, barista, juice): their screen, and marking their own items out of stock.
  const kitchenPerms = ['kds.view', 'kds.update', 'product.view', 'product.status_update', 'printer.view', 'printer.retry'];
  // Counter: small coffee shops where one person takes the order and the money.
  const counterPerms = [...new Set([...waiterPerms, ...cashierPerms])];
  // Supervisor: runs the floor during a shift. Approves voids/discounts on the spot, but no money reports or staff admin.
  const supervisorPerms = [...new Set([
    ...waiterPerms, 'kds.view', 'product.status_update', 'table.status_update',
    'order.void', 'order.void_item', 'order.discount', 'order.discount_large', 'order.complete',
    'printer.view', 'printer.retry', 'printer.reprint', 'receipt.view', 'receipt.reprint', 'sync.resolve_conflict', 'report.view',
  ])];
  const managerPerms = [...new Set([
    ...waiterPerms, ...cashierPerms, ...kitchenPerms,
    'order.void', 'order.void_item', 'order.discount_large', 'order.complete',
    'payment.confirm', 'refund.approve', 'shift.approve_variance', 'shift.view_report',
    'report.view', 'report.view_financial',
    'product.create', 'product.update', 'product.price_update',
    'category.create', 'category.update', 'category.deactivate',
    'table.create', 'table.update', 'table.status_update',
    'kitchen_station.create', 'kitchen_station.update', 'kitchen_station.deactivate',
    'printer.reprint', 'printer.manage', 'sync.resolve_conflict', 'user.manage',
  ])];

  const rolesToSeed = [
    { id: 'role-waiter', name: 'Waiter', perms: waiterPerms },
    { id: 'role-counter', name: 'Counter', perms: counterPerms },
    { id: 'role-cashier', name: 'Cashier', perms: cashierPerms },
    { id: 'role-kitchen', name: 'Chef', perms: kitchenPerms },
    { id: 'role-barista', name: 'Barista', perms: kitchenPerms },
    { id: 'role-juice', name: 'Juice bar', perms: kitchenPerms },
    { id: 'role-supervisor', name: 'Supervisor', perms: supervisorPerms },
    { id: 'role-manager', name: 'Manager', perms: managerPerms },
    { id: 'role-admin', name: 'Admin', perms: permissions },
  ];

  for (const roleDef of rolesToSeed) {
    const r = await prisma.role.upsert({
      where: { id: roleDef.id },
      update: { name: roleDef.name },
      create: { id: roleDef.id, name: roleDef.name, organizationId: org.id }
    });

    // Keep role definitions exact on re-seed: remove permissions a role no longer has.
    await prisma.rolePermission.deleteMany({
      where: { roleId: r.id, permission: { code: { notIn: roleDef.perms } } },
    });
    for (const p of roleDef.perms) {
      const permObj = await prisma.permission.findUnique({ where: { code: p } });
      if (permObj) {
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: r.id, permissionId: permObj.id } },
          update: {},
          create: { roleId: r.id, permissionId: permObj.id }
        });
      }
    }
  }

  const adminRole = await prisma.role.findFirst({ where: { name: 'Admin', organizationId: org.id } });
  if (adminRole) {
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: adminRole.id } },
      update: {},
      create: { userId: user.id, roleId: adminRole.id }
    });
  }

  await prisma.userBranch.upsert({
    where: { userId_branchId: { userId: user.id, branchId: branch.id } },
    update: {},
    create: { userId: user.id, branchId: branch.id }
  });

  if (withDemo) {
    // One person per role so every screen can be tried. Dev only.
    const demoPassword = await bcrypt.hash('cafe-demo-1234', 10);
    const managerPin = await bcrypt.hash('2468', 10);
    const staff = [
      { username: 'hana', first: 'Hana', last: 'Tesfaye', role: 'Waiter' },
      { username: 'dawit', first: 'Dawit', last: 'Bekele', role: 'Waiter' },
      { username: 'sara', first: 'Sara', last: 'Alemu', role: 'Cashier' },
      { username: 'abebe', first: 'Abebe', last: 'Kebede', role: 'kitchen', station: 'Kitchen' },
      { username: 'liya', first: 'Liya', last: 'Girma', role: 'barista', station: 'Coffee' },
      { username: 'yonas', first: 'Yonas', last: 'Tadesse', role: 'juice', station: 'Juice' },
      { username: 'selam', first: 'Selam', last: 'Worku', role: 'supervisor' },
      { username: 'meron', first: 'Meron', last: 'Haile', role: 'Manager' },
    ] as { username: string; first: string; last: string; role: string; station?: string }[];
    for (const st of staff) {
      const u = await prisma.user.upsert({
        where: { organizationId_username: { organizationId: org.id, username: st.username } },
        update: {},
        create: {
          organizationId: org.id,
          username: st.username,
          passwordHash: demoPassword,
          pinHash: st.role === 'Manager' || st.role === 'supervisor' ? managerPin : null,
        },
      });
      await prisma.employee.upsert({
        where: { userId: u.id },
        update: {},
        create: { userId: u.id, firstName: st.first, lastName: st.last, role: st.role },
      });
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: u.id, roleId: 'role-' + st.role.toLowerCase() } },
        update: {},
        create: { userId: u.id, roleId: 'role-' + st.role.toLowerCase() },
      });
      await prisma.userBranch.upsert({
        where: { userId_branchId: { userId: u.id, branchId: branch.id } },
        update: {},
        create: { userId: u.id, branchId: branch.id },
      });
      if (st.station) {
        const station = await prisma.kitchenStation.findFirst({ where: { branchId: branch.id, name: st.station } });
        if (station) {
          await prisma.userStation.upsert({
            where: { userId_stationId: { userId: u.id, stationId: station.id } },
            update: {},
            create: { userId: u.id, stationId: station.id },
          });
        }
      }
    }
    console.log('Demo staff (password cafe-demo-1234): hana, dawit (waiters), sara (cashier), abebe (chef), liya (barista), yonas (juice), selam (supervisor, PIN 2468), meron (manager, PIN 2468)');
  }

  console.log('Seed complete.');
  console.log('  Organization: default');
  console.log('  Username:     admin');
  console.log(process.env.SEED_ADMIN_PASSWORD ? '  Password:     (from SEED_ADMIN_PASSWORD)' : existingAdmin ? '  Password:     (unchanged)' : '  Password:     admin123  (dev only — change it)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
