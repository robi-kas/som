import { Test, TestingModule } from '@nestjs/testing';
import { ProductsService } from './products.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

describe('ProductsService', () => {
  let service: ProductsService;

  const mockPrisma = {
    branch: { findFirst: vi.fn() },
    category: { findUnique: vi.fn(), findFirst: vi.fn() },
    kitchenStation: { findUnique: vi.fn() },
    product: { create: vi.fn((args) => Promise.resolve({ id: 'p1', sellingPrice: args?.data?.sellingPrice || new Prisma.Decimal('0') })), findUnique: vi.fn(), update: vi.fn(() => Promise.resolve({ id: 'p1', sellingPrice: new Prisma.Decimal('50') })) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  };

  const reqUser = { userId: 'u1', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: ['product.create', 'product.price_update'] };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<ProductsService>(ProductsService);
    vi.clearAllMocks();
  });

  it('PRODUCT-001 Exact decimal price is preserved', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.category.findFirst.mockResolvedValue({ id: 'c1', branchId: 'b1', isActive: true });
    mockPrisma.product.create.mockResolvedValue({ id: 'p1', sellingPrice: new Prisma.Decimal('45.50') });

    await service.create({ name: 'Latte', branchId: 'b1', categoryId: 'c1', price: '45.50' }, reqUser);
    
    const createCall = mockPrisma.product.create.mock.calls[0][0];
    expect(createCall.data.sellingPrice).toBeInstanceOf(Prisma.Decimal);
    expect(createCall.data.sellingPrice.toString()).toBe('45.5');
  });

  it('PRODUCT-003 Negative price is rejected', async () => {
    await expect(service.create({ name: 'Latte', branchId: 'b1', categoryId: 'c1', price: '-5.00' }, reqUser)).rejects.toThrow(BadRequestException);
  });

  it('PRODUCT-004 Cross-branch category is rejected', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.category.findFirst.mockResolvedValue(null);
    
    await expect(service.create({ name: 'Latte', branchId: 'b1', categoryId: 'c1', price: '45.50' }, reqUser)).rejects.toThrow(BadRequestException);
  });

  it('PRODUCT-007 Price change creates audit event', async () => {
    mockPrisma.product.findUnique.mockResolvedValue({ id: 'p1', organizationId: 'org1', branchId: 'b1', status: 'AVAILABLE', sellingPrice: new Prisma.Decimal('45.50') });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    
    await service.changePrice('p1', { newPrice: '50.00', reason: 'Inflation' }, reqUser);
    
    expect(mockPrisma.product.update).toHaveBeenCalledWith(expect.objectContaining({ data: { sellingPrice: expect.any(Prisma.Decimal), version: { increment: 1 } } }));
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PRODUCT_PRICE_CHANGED' })
    }));
  });
});
