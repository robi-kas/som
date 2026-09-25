import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { describe, beforeEach, it, expect, vi } from 'vitest';

describe('UsersService', () => {
  let usersService: UsersService;

  const mockPrisma = {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    branch: { findMany: vi.fn() },
    role: { findMany: vi.fn() },
    session: { updateMany: vi.fn() },
    userRole: { findMany: vi.fn().mockResolvedValue([]) },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  };

  const reqUser = { userId: 'admin', sessionId: 's1', organizationId: 'org1', branchIds: ['b1'], permissions: ['user.manage'] };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    usersService = module.get<UsersService>(UsersService);
    vi.clearAllMocks();
  });

  it('USER-001 Create user & USER-003 Password is never returned', async () => {
    mockPrisma.branch.findMany.mockResolvedValue([{ id: 'b1', organizationId: 'org1' }]);
    mockPrisma.role.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({ id: 'u1', username: 'newuser', isActive: true, organizationId: 'org1' });
    
    const result = await usersService.createUser({ username: 'newuser', password: 'password_123456', branchIds: ['b1'], roleIds: [] }, reqUser);
    
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('username');
    expect(result).not.toHaveProperty('passwordHash');
    expect(mockPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('USER-007 Unauthorized branch/org access rejected & USER-009 Unknown user ID returns not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', organizationId: 'org2', userBranches: [{ branchId: 'b2' }] });
    await expect(usersService.disableUser('u2', reqUser)).rejects.toThrow(NotFoundException);
    
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(usersService.disableUser('unknown', reqUser)).rejects.toThrow(NotFoundException);
  });

  it('USER-004 Disable user revokes sessions', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', organizationId: 'org1', userBranches: [{ branchId: 'b1' }] });
    
    await usersService.disableUser('u2', reqUser);
    
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } }));
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }));
  });

  it('USER-006 Reset password revokes sessions', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', organizationId: 'org1', userBranches: [{ branchId: 'b1' }] });
    
    await usersService.resetPassword('u2', 'new_secure_password', reqUser);
    
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ passwordChangedAt: expect.any(Date) }) }));
    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) }));
  });

  it('USER-010 A manager cannot reset the password of someone with more access (e.g. the owner)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'owner', organizationId: 'org1', userBranches: [{ branchId: 'b1' }] });
    mockPrisma.userRole.findMany.mockResolvedValueOnce([
      { role: { rolePermissions: [{ permission: { code: 'org.admin' } }, { permission: { code: 'user.manage' } }] } },
    ]);

    await expect(usersService.resetPassword('owner', 'a-new-long-password', reqUser)).rejects.toThrow(ForbiddenException);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('USER-011 A reset password must be changed at next sign-in', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u2', organizationId: 'org1', userBranches: [{ branchId: 'b1' }] });
    await usersService.resetPassword('u2', 'new_secure_password', reqUser);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ forcePasswordChange: true }) }));
  });

  it('USER-008 Self-modification policy enforced', async () => {
    await expect(usersService.disableUser('admin', reqUser)).rejects.toThrow(ForbiddenException);
  });
});
