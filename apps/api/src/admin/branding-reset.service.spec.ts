import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as bcrypt from 'bcrypt';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BrandingResetService } from './branding-reset.service.js';
import { createPrismaMock, type PrismaMock } from '../../test/helpers/prisma-mock.js';

describe('Data reset guards', () => {
  let prisma: PrismaMock;
  let service: BrandingResetService;
  const owner = { userId: 'owner', sessionId: 's', organizationId: 'org1', branchIds: ['b1'], permissions: ['org.admin'] };
  const manager = { ...owner, userId: 'm', permissions: ['settings.manage'] };
  let hash: string;

  beforeEach(async () => {
    hash = hash ?? (await bcrypt.hash('right-password', 4));
    prisma = createPrismaMock();
    prisma.organization.findUniqueOrThrow.mockResolvedValue({ id: 'org1', name: 'New Chapter' });
    prisma.user.findUniqueOrThrow.mockResolvedValue({ id: 'owner', passwordHash: hash });
    prisma.branch.findMany.mockResolvedValue([{ id: 'b1' }]);
    prisma.user.findMany.mockResolvedValue([{ id: 'owner' }, { id: 'waiter' }]);
    for (const m of ['printerJob', 'orderItemStatusHistory', 'refundItem', 'refund', 'receipt', 'payment', 'paymentEvidence', 'orderItemModifier', 'orderItem', 'kitchenTicket', 'voidRecord', 'order', 'approvalRequest', 'approvalGrant', 'idempotencyKey', 'cashCount', 'cashMovement', 'shiftReconciliation', 'cashierShift', 'syncEvent', 'branchCounter']) {
      prisma[m].deleteMany.mockResolvedValue({ count: 1 });
    }
    service = new BrandingResetService(prisma as never);
  });
  afterEach(() => {
    delete process.env.ALLOW_DATA_RESET;
  });

  const good = { scope: 'SALES' as const, confirmPhrase: 'DELETE New Chapter', password: 'right-password' };

  it('only the owner can reset', async () => {
    await expect(service.reset(good, manager)).rejects.toThrow(ForbiddenException);
  });

  it('is switched off when the server says so (live installs)', async () => {
    process.env.ALLOW_DATA_RESET = 'false';
    await expect(service.reset(good, owner)).rejects.toMatchObject({ response: { code: 'RESET_DISABLED' } });
  });

  it('needs the exact phrase', async () => {
    await expect(service.reset({ ...good, confirmPhrase: 'delete new chapter' }, owner)).rejects.toThrow(BadRequestException);
  });

  it('needs the password', async () => {
    await expect(service.reset({ ...good, password: 'guess' }, owner)).rejects.toThrow(UnauthorizedException);
  });

  it('clears sales but keeps the menu, and logs who did it', async () => {
    const res = await service.reset(good, owner);
    expect(res.removed.orders).toBe(1);
    expect(prisma.order.deleteMany).toHaveBeenCalledWith({ where: { organizationId: 'org1' } });
    expect(prisma.product.deleteMany).not.toHaveBeenCalled();
    expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'DATA_RESET_SALES', actorId: 'owner' }) }));
  });

  it('a full reset removes staff but never the owner doing it', async () => {
    for (const m of ['productModifier', 'product', 'category', 'printer', 'printAgent', 'userStation', 'kitchenStation', 'table', 'paymentMethod', 'user']) {
      prisma[m].deleteMany.mockResolvedValue({ count: 1 });
    }
    await service.reset({ ...good, scope: 'EVERYTHING' }, owner);
    expect(prisma.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['waiter'] } } });
  });
});
