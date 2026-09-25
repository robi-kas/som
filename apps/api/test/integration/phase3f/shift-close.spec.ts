import { IntegrationTestFixture, getIntegrationFixture } from '../fixture.js';
import { ShiftsService } from '../../../src/shifts/shifts.service.js';
import { AuthenticatedPrincipal } from '../../../src/auth/interfaces/authenticated-request.interface.js';
import { describe, beforeAll, afterAll, beforeEach, it, expect } from 'vitest';
import * as crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { ForbiddenException, ConflictException } from '@nestjs/common';

describe('Phase 3F Shift Close Integration', () => {
  let fixture: IntegrationTestFixture;
  let service: ShiftsService;
  let orgId: string;
  let branchId: string;
  let principal: AuthenticatedPrincipal;
  let userId: string;

  beforeAll(async () => {
    fixture = await getIntegrationFixture();
    service = fixture.app.get(ShiftsService);
  });

  afterAll(async () => {
    await fixture.app.close();
  });

  beforeEach(async () => {
    const org = await fixture.prisma.organization.create({
      data: { name: `org-${crypto.randomBytes(4).toString('hex')}`, slug: `o-${crypto.randomBytes(4).toString('hex')}` }
    });
    const branch = await fixture.prisma.branch.create({
      data: { organizationId: org.id, name: 'B1' }
    });
    await fixture.prisma.branchConfiguration.create({
      data: { branchId: branch.id, currency: 'USD', varianceTolerance: 5 }
    });

    const user = await fixture.prisma.user.create({
      data: { organizationId: org.id, username: `u1-${crypto.randomBytes(4).toString('hex')}`, passwordHash: 'dummy' }
    });
    orgId = org.id;
    branchId = branch.id;
    userId = user.id;

    principal = {
      userId,
      organizationId: orgId,
      branchIds: [branchId],
      permissions: ['shift.open', 'shift.close', 'shift.approve_variance', 'shift.view_report']
    };
  });

  it('SHIFT-CLOSE-INT-001: Auto-closes shift if variance within tolerance', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    const res = await service.closeShift(shift.id, { cashCounts: [{ value: 100, count: 1 }] }, principal);
    expect(res.shift.status).toBe('CLOSED');
    expect(res.reconciliation.status).toBe('APPROVED');
    expect(res.reconciliation.variance).toBe(0);
  });

  it('SHIFT-CLOSE-INT-002: Sets status to CLOSING and PENDING if variance exceeds tolerance', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    const res = await service.closeShift(shift.id, { cashCounts: [{ value: 150, count: 1 }] }, principal);
    expect(res.shift.status).toBe('CLOSING');
    expect(res.reconciliation.status).toBe('PENDING');
    expect(res.reconciliation.variance).toBe(50);
  });

  it('SHIFT-CLOSE-INT-003: Approve variance closes shift and approves reconciliation', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });
    await service.closeShift(shift.id, { cashCounts: [{ value: 150, count: 1 }] }, principal);

    const res = await service.approveVariance(shift.id, { reason: 'Found it' }, principal);
    expect(res.status).toBe('CLOSED');

    const recon = await fixture.prisma.shiftReconciliation.findUnique({ where: { shiftId: shift.id } });
    expect(recon?.status).toBe('APPROVED');
    expect(recon?.notes).toBe('Found it');
  });

  it('SHIFT-CLOSE-INT-004: Rejects closeShift if shift is already CLOSED', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'CLOSED', openingFloat: 100 }
    });
    await expect(service.closeShift(shift.id, { cashCounts: [{ value: 100, count: 1 }] }, principal)).rejects.toThrow(ConflictException);
  });

  it('SHIFT-CLOSE-INT-005: Correctly aggregates cash movements', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });

    await fixture.prisma.cashMovement.createMany({
      data: [
        { shiftId: shift.id, type: 'CASH_SALE', amount: 50, userId },
        { shiftId: shift.id, type: 'CASH_REFUND', amount: 10, userId },
        { shiftId: shift.id, type: 'CASH_DEPOSIT', amount: 20, userId },
        { shiftId: shift.id, type: 'CASH_WITHDRAWAL', amount: 30, userId }
      ]
    });

    const res = await service.closeShift(shift.id, { cashCounts: [{ value: 130, count: 1 }] }, principal);
    expect(res.reconciliation.expectedCash).toBe(130);
    expect(res.reconciliation.variance).toBe(0);
    expect(res.reconciliation.cashSales).toBe(50);
    expect(res.reconciliation.cashRefunds).toBe(10);
    expect(res.reconciliation.cashDeposits).toBe(20);
    expect(res.reconciliation.cashWithdrawals).toBe(30);
  });

  it('SHIFT-CLOSE-INT-006: Rejects approveVariance without correct permissions', async () => {
    const shift = await fixture.prisma.cashierShift.create({
      data: { organizationId: orgId, branchId, cashierId: userId, status: 'OPEN', openingFloat: 100 }
    });
    await service.closeShift(shift.id, { cashCounts: [{ value: 150, count: 1 }] }, principal);

    const badPrincipal = { ...principal, permissions: [] };
    await expect(service.approveVariance(shift.id, { reason: 'Found it' }, badPrincipal)).rejects.toThrow(ForbiddenException);
  });
});
