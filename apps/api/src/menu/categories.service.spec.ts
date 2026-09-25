import { Test, TestingModule } from '@nestjs/testing';
import { CategoriesService } from './categories.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ForbiddenException } from '@nestjs/common';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ORGANIZATION_ADMIN_PERMISSION } from '../common/utils/permission-policy.js';

describe('CategoriesService', () => {
  let service: CategoriesService;
  const mockPrisma = {
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
    category: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    product: { count: vi.fn() },
    auditLog: { create: vi.fn() },
    branch: { findFirst: vi.fn() }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoriesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<CategoriesService>(CategoriesService);
  });

  it('CATEGORY-001 category.create denied if permissions missing', async () => {
    const reqUser = { userId: 'u1', organizationId: 'o1', branchIds: ['b1'], permissions: [] };
    await expect(service.create({ name: 'Drinks', branchId: 'b1' }, reqUser)).rejects.toThrow(ForbiddenException);
  });

  it('CATEGORY-002 category.create allowed if org.admin bypass', async () => {
    const reqUser = { userId: 'u1', organizationId: 'o1', branchIds: ['b1'], permissions: [ORGANIZATION_ADMIN_PERMISSION] };
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'o1' });
    mockPrisma.category.create.mockResolvedValue({ id: 'c1' });
    await expect(service.create({ name: 'Drinks', branchId: 'b1' }, reqUser)).resolves.toBeDefined();
  });
});
