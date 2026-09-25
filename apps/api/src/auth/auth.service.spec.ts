import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { describe, beforeEach, it, expect, vi } from 'vitest';

describe('AuthService', () => {
  let authService: AuthService;

  const mockPrisma = {
    organization: { findUnique: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    session: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
    securityEvent: { create: vi.fn() },
    $transaction: vi.fn(async (cb) => cb(mockPrisma)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuthService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    await authService.onModuleInit();
    vi.clearAllMocks();
  });

  it('AUTH-001 Valid active-user login & AUTH-012 Successful login and audit are atomic', async () => {
    const pass = 'correct_horse';
    const hash = await bcrypt.hash(pass, 10);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: hash, isActive: true });
    mockPrisma.session.create.mockResolvedValue({ id: 's1', expiresAt: new Date() });

    const result = await authService.login({ organizationSlug: 'org1', username: 'john', password: pass });
    
    expect(result).toHaveProperty('token');
    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(mockPrisma.session.create).toHaveBeenCalled();
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'LOGIN_SUCCESS', entityType: 'SESSION' }) })
    );
  });

  it('AUTH-002 Wrong password logs security event and throws generic error', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: 'hash', isActive: true });

    await expect(authService.login({ organizationSlug: 'org1', username: 'john', password: 'wrong' })).rejects.toThrow(UnauthorizedException);
    
    expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'LOGIN_FAILED', reason: 'INVALID_PASSWORD' }) })
    );
  });

  it('AUTH-003 Unknown username throws generic error and logs securely without exposing DB error', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(authService.login({ organizationSlug: 'org1', username: 'unknown', password: 'pwd' })).rejects.toThrow(UnauthorizedException);
    
    expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'LOGIN_FAILED', reason: 'UNKNOWN_USERNAME' }) })
    );
  });

  it('AUTH-004 Disabled account is rejected securely', async () => {
    const pass = 'correct_horse';
    const hash = await bcrypt.hash(pass, 10);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: hash, isActive: false });

    await expect(authService.login({ organizationSlug: 'org1', username: 'john', password: pass })).rejects.toThrow(UnauthorizedException);
    
    expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType: 'LOGIN_FAILED', reason: 'ACCOUNT_DISABLED' }) })
    );
  });

  it('AUTH-005 Session token is not stored raw in the database', async () => {
    const pass = 'correct_horse';
    const hash = await bcrypt.hash(pass, 10);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: hash, isActive: true });
    mockPrisma.session.create.mockResolvedValue({ id: 's1', expiresAt: new Date() });

    const result = await authService.login({ organizationSlug: 'org1', username: 'john', password: pass });
    
    const createCall = mockPrisma.session.create.mock.calls[0][0];
    expect(createCall.data.tokenHash).not.toBe(result.token);
    expect(createCall.data.tokenHash.length).toBe(64); 
  });

  it('AUTH-010 Five wrong passwords lock the account for 15 minutes', async () => {
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: 'hash', isActive: true, failedLoginCount: 4, lockedUntil: null });

    await expect(authService.login({ organizationSlug: 'org1', username: 'john', password: 'wrong' })).rejects.toThrow(UnauthorizedException);

    const update = mockPrisma.user.update.mock.calls[0][0];
    expect(update.data.lockedUntil).toBeInstanceOf(Date);
    expect(update.data.lockedUntil.getTime()).toBeGreaterThan(Date.now() + 14 * 60 * 1000);
  });

  it('AUTH-011 A locked account is refused even with the right password', async () => {
    const pass = 'correct_horse';
    const hash = await bcrypt.hash(pass, 10);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: hash, isActive: true, failedLoginCount: 0, lockedUntil: new Date(Date.now() + 60_000) });

    await expect(authService.login({ organizationSlug: 'org1', username: 'john', password: pass })).rejects.toThrow(UnauthorizedException);
    expect(mockPrisma.session.create).not.toHaveBeenCalled();
    expect(mockPrisma.securityEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason: 'ACCOUNT_LOCKED' }) }));
  });

  it('AUTH-013 Successful login resets the failure counter and reports a forced password change', async () => {
    const pass = 'correct_horse';
    const hash = await bcrypt.hash(pass, 10);
    mockPrisma.organization.findUnique.mockResolvedValue({ id: 'org1', slug: 'org1' });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'u1', username: 'john', passwordHash: hash, isActive: true, failedLoginCount: 3, forcePasswordChange: true });
    mockPrisma.session.create.mockResolvedValue({ id: 's1', expiresAt: new Date() });

    const result = await authService.login({ organizationSlug: 'org1', username: 'john', password: pass });

    expect(result.forcePasswordChange).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { failedLoginCount: 0, lockedUntil: null } }));
  });

  it('AUTH-008 Logout invalidates session via atomic update and audit', async () => {
    mockPrisma.session.updateMany.mockResolvedValue({ count: 1 });

    await authService.logoutSession('s1', 'u1');

    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: expect.any(Date) }) })
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'LOGOUT', entityType: 'SESSION' }) })
    );
  });

  it('AUTH-009 Logout-all invalidates all user sessions', async () => {
    mockPrisma.session.updateMany.mockResolvedValue({ count: 2 });
    
    await authService.logoutAll('u1');

    expect(mockPrisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'u1', revokedAt: null }),
        data: expect.objectContaining({ revokedAt: expect.any(Date) })
      })
    );
    expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'LOGOUT_ALL', entityType: 'USER' }) })
    );
  });
});
