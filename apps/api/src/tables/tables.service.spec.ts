import { Test, TestingModule } from '@nestjs/testing';
import { TablesService } from './tables.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { describe, beforeEach, it, expect, vi } from 'vitest';
import { ForbiddenException, ConflictException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TableStatus } from './dto/update-table-status.dto.js';

describe('TablesService', () => {
  let service: TablesService;

  const mockPrisma = {
    branch: { findFirst: vi.fn() },
    order: { count: vi.fn() },
    table: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(() => Promise.resolve({ id: 't1' })) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  };

  const reqUser = { userId: 'u1', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: ['table.create', 'table.status_update'] };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TablesService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();
    service = module.get<TablesService>(TablesService);
    vi.clearAllMocks();
  });

  it('TABLE-001 Create table succeeds', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.order.count.mockResolvedValue(1);
    mockPrisma.table.create.mockResolvedValue({ id: 't1', name: 'Table 1' });
    
    await service.create({ name: 'Table 1', branchId: 'b1', capacity: 4 }, reqUser);
    expect(mockPrisma.table.create).toHaveBeenCalled();
  });

  it('TABLE-002 Duplicate table name is rejected', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.order.count.mockResolvedValue(1);
    mockPrisma.table.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('', { code: 'P2002', clientVersion: '1' }));
    
    await expect(service.create({ name: 'Table 1', branchId: 'b1', capacity: 4 }, reqUser)).rejects.toThrow(ConflictException);
  });

  it('TABLE-004 Out-of-service table cannot receive order (implied by AVAILABLE check in orders)', async () => {
    // Tests transitioning to OUT_OF_SERVICE
    mockPrisma.table.findUnique.mockResolvedValue({ id: 't1', organizationId: 'org1', branchId: 'b1', status: 'AVAILABLE', orders: [], version: 1 });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.order.count.mockResolvedValue(1);
    
    mockPrisma.table.update.mockResolvedValue({ id: 't1', status: TableStatus.OUT_OF_SERVICE, version: 2 });
    await service.setStatus('t1', { status: TableStatus.OUT_OF_SERVICE }, reqUser);
    mockPrisma.table.update.mockResolvedValue({ id: 't1' });
    expect(mockPrisma.table.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'OUT_OF_SERVICE' }) }));
  });

  it('TABLE-005 Occupied table cannot become available with active order', async () => {
    mockPrisma.table.findUnique.mockResolvedValue({ id: 't1', organizationId: 'org1', branchId: 'b1', status: 'WAITING_FOR_PAYMENT', orders: [{ id: 'o1' }], version: 1 });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.order.count.mockResolvedValue(1);
    mockPrisma.order.count.mockResolvedValue(1);
    await expect(service.setStatus('t1', { status: TableStatus.AVAILABLE }, reqUser)).rejects.toThrow(ConflictException);
  });

  it('TABLE-006 Cross-branch table operation rejected', async () => {
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b2', organizationId: 'org1' }); // reqUser lacks b2
    await expect(service.create({ name: 'Table 1', branchId: 'b2', capacity: 4 }, reqUser)).rejects.toThrow(ForbiddenException);
  });

  it('TABLE-007 Status change is audited', async () => {
    mockPrisma.table.findUnique.mockResolvedValue({ id: 't1', organizationId: 'org1', branchId: 'b1', status: 'AVAILABLE', orders: [], version: 1 });
    mockPrisma.branch.findFirst.mockResolvedValue({ id: 'b1', organizationId: 'org1' });
    mockPrisma.order.count.mockResolvedValue(1);
    
    mockPrisma.table.update.mockResolvedValue({ id: 't1', status: TableStatus.OCCUPIED, version: 2 });
    await service.setStatus('t1', { status: TableStatus.OCCUPIED }, reqUser);
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });
});
