import { Test, TestingModule } from '@nestjs/testing';
import { KitchenService } from './kitchen.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('KitchenStationsService', () => {
  let service: KitchenService;

  const mockPrisma = {
    branch: { findFirst: vi.fn() },
    kitchenStation: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    product: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  };

  const reqUser = { userId: 'u1', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: ['kitchen_station.create', 'kitchen_station.deactivate'] };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [KitchenService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<KitchenService>(KitchenService);
    vi.clearAllMocks();
  });

  it('KITCHEN-001 Create station succeeds', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.kitchenStation.create.mockResolvedValue({ id: 'k1', name: 'Grill' });
    
    await service.create({ name: 'Grill', branchId: 'b1', displayOrder: 1 }, reqUser);
    expect(mockPrisma.kitchenStation.create).toHaveBeenCalled();
  });

  it('KITCHEN-002 Duplicate station in same branch is rejected', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.kitchenStation.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('', { code: 'P2002', clientVersion: '1' }));
    
    await expect(service.create({ name: 'Grill', branchId: 'b1', displayOrder: 1 }, reqUser)).rejects.toThrow(ConflictException);
  });

  it('KITCHEN-003 Cross-branch station is rejected', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b2', organizationId: 'org1' }); // reqUser lacks b2
    await expect(service.create({ name: 'Grill', branchId: 'b2', displayOrder: 1 }, reqUser)).rejects.toThrow(ForbiddenException);
  });

  it('KITCHEN-004 Station with active products cannot deactivate', async () => {
    mockPrisma.kitchenStation.findUnique.mockResolvedValue({ id: 'k1', branchId: 'b1', organizationId: 'org1' });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.product.count.mockResolvedValue(1);

    await expect(service.deactivate('k1', reqUser)).rejects.toThrow(ConflictException);
  });
});
