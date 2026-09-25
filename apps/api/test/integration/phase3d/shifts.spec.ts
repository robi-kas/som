import { getIntegrationFixture } from '../fixture.js';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../src/prisma/prisma.service.js';
import { ShiftsService } from '../../../src/shifts/shifts.service.js';
import { AppModule } from '../../../src/app.module.js';
import { ConflictException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';

describe('ShiftsService (Integration)', () => {
  let service: ShiftsService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const fixture = await getIntegrationFixture();
    prisma = fixture.prisma;
    service = fixture.app.get(ShiftsService);
  });

  

  async function getContext() {
    const org = await prisma.organization.create({ data: { name: 'Org', slug: 'org-' + require('crypto').randomUUID() } });
    let branch = await prisma.branch.create({ data: { name: 'Branch', organizationId: org.id } });
    let user = await prisma.user.create({ data: { username: 'user-' + require('crypto').randomUUID(), passwordHash: 'hash', isActive: true, organizationId: branch.organizationId } });
    let emp = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!emp) {
      emp = await prisma.employee.create({ data: { userId: user.id, firstName: 'A', lastName: 'B', role: 'CASHIER' } });
    }
    const principal: AuthenticatedPrincipal = {
      userId: user.id,
      organizationId: branch.organizationId,
      branchIds: [branch.id],
      permissions: ['shift.open', 'shift.cash_movement', 'shift.view_own'],
    };
    return { branch, principal };
  }

  it('SHIFT-DB-001: opening a shift works', async () => {
    const { branch, principal } = await getContext();
    await prisma.cashMovement.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({});
    const result = await service.openShift({ branchId: branch.id, openingFloat: 100 }, principal);
    expect(result.status).toBe('OPEN');
    expect(result.openingFloat).toBe('100');
  });

  it('SHIFT-DB-002: cannot open two concurrent shifts for same branch', async () => {
    const { branch, principal } = await getContext();
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({});

    // Also test direct Prisma insertion (P2002) as requested
    const existing = await prisma.cashierShift.create({
      data: {
        organizationId: principal.organizationId,
        branchId: branch.id,
        cashierId: principal.userId,
        status: 'OPEN',
        openedAt: new Date(),
        openingFloat: 50,
      }
    });

    await expect(
      prisma.cashierShift.create({
        data: {
          organizationId: principal.organizationId,
          branchId: branch.id,
          cashierId: principal.userId, // Same cashier
          status: 'OPEN',
          openedAt: new Date(),
          openingFloat: 50,
        }
      })
    ).rejects.toMatchObject({ code: 'P2002' });
    
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({});

    // Test concurrency race condition
    const results = await Promise.allSettled([
      service.openShift({ branchId: branch.id, openingFloat: 50 }, principal),
      service.openShift({ branchId: branch.id, openingFloat: 50 }, principal),
      service.openShift({ branchId: branch.id, openingFloat: 50 }, principal)
    ]);

    const successes = results.filter(r => r.status === 'fulfilled');
    const failures = results.filter(r => r.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(2);
    expect(failures[0].reason.message).toContain('Cashier already has an open shift');
  });

  it('SHIFT-DB-003: idempotency works on shift open', async () => {
    const { branch, principal } = await getContext();
    await prisma.cashMovement.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({});
    const idempKey = 'shift-open-123';
    const res1 = await service.openShift({ branchId: branch.id, openingFloat: 200 }, principal, idempKey);
    const res2 = await service.openShift({ branchId: branch.id, openingFloat: 200 }, principal, idempKey);
    expect(res1.id).toEqual(res2.id);
  });
});

describe('ShiftsService (Integration) - Cash Movements', () => {
  let service: ShiftsService;
  let prisma: PrismaService;
  let shiftId: string;
  let principal: AuthenticatedPrincipal;

  beforeAll(async () => {
    const fixture = await getIntegrationFixture();
    prisma = fixture.prisma;
    service = fixture.app.get(ShiftsService);
  });

  

  beforeEach(async () => {
    await prisma.cashMovement.deleteMany({});
    await prisma.cashMovement.deleteMany({});
    await prisma.cashierShift.deleteMany({});

    const org = await prisma.organization.create({ data: { name: 'Org', slug: 'org-' + require('crypto').randomUUID() } });
    let branch = await prisma.branch.create({ data: { name: 'Branch', organizationId: org.id } });
    let user = await prisma.user.create({ data: { username: 'user-' + require('crypto').randomUUID(), passwordHash: 'hash', isActive: true, organizationId: branch.organizationId } });
    let emp = await prisma.employee.findUnique({ where: { userId: user.id } });
    if (!emp) {
      emp = await prisma.employee.create({ data: { userId: user.id, firstName: 'A', lastName: 'B', role: 'CASHIER' } });
    }
    principal = {
      userId: user.id,
      organizationId: branch.organizationId,
      branchIds: [branch.id],
      permissions: ['shift.open', 'shift.cash_movement', 'shift.view_own'],
    };

    const shift = await service.openShift({ branchId: branch.id, openingFloat: 100 }, principal);
    shiftId = shift.id;
  });

  it('SHIFT-DB-004: add cash movement (CASH_DEPOSIT)', async () => {
    const movement = await service.addCashMovement(shiftId, { type: 'CASH_DEPOSIT', amount: 50, reason: 'Refill' }, principal);
    expect(movement.type).toBe('CASH_DEPOSIT');
  });

  it('SHIFT-DB-005: add cash movement (CASH_WITHDRAWAL)', async () => {
    const movement = await service.addCashMovement(shiftId, { type: 'CASH_WITHDRAWAL', amount: 30, reason: 'Takeout' }, principal);
    expect(movement.type).toBe('CASH_WITHDRAWAL');
  });

  it('SHIFT-DB-006: unauthorized user cannot add cash movement', async () => {
    const wrongPrincipal: AuthenticatedPrincipal = {
      ...principal,
      userId: '123e4567-e89b-12d3-a456-426614174000',
    };
    await expect(service.addCashMovement(shiftId, { type: 'CASH_DEPOSIT', amount: 50 }, wrongPrincipal)).rejects.toThrow();
  });

  it('SHIFT-DB-007: get current shift', async () => {
    const shift = await service.getCurrentShift(principal);
    expect(shift.id).toBe(shiftId);
  });

  it('SHIFT-DB-008: idempotency works on cash movement', async () => {
    const idempKey = 'cash-move-123';
    const mov1 = await service.addCashMovement(shiftId, { type: 'CASH_DEPOSIT', amount: 50 }, principal, idempKey);
    const mov2 = await service.addCashMovement(shiftId, { type: 'CASH_DEPOSIT', amount: 50 }, principal, idempKey);
    expect(mov1.id).toBe(mov2.id);
  });
});
