import { AuthGuard } from './auth.guard.js';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('AuthGuard', () => {
  let authGuard: AuthGuard;
  const mockPrisma = {
    session: { findUnique: vi.fn() }
  };

  beforeEach(() => {
    authGuard = new AuthGuard(mockPrisma as any);
    vi.clearAllMocks();
  });

  const createMockContext = (authHeader?: string) => {
    const req = { headers: { authorization: authHeader }, user: null };
    return {
      switchToHttp: () => ({ getRequest: () => req })
    } as unknown as ExecutionContext;
  };

  it('AUTH-006 Expired session rejected', async () => {
    const ctx = createMockContext('Bearer some-token');
    // Mock an expired session
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1',
      expiresAt: new Date(Date.now() - 10000), // Past
      revokedAt: null,
      user: { isActive: true }
    });

    await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('AUTH-007 Revoked session rejected', async () => {
    const ctx = createMockContext('Bearer some-token');
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 's1',
      expiresAt: new Date(Date.now() + 10000), // Future
      revokedAt: new Date(), // Revoked
      user: { isActive: true }
    });

    await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });

  it('AUTH-014 Auth guard rejects missing auth headers', async () => {
    const ctx = createMockContext(undefined);
    await expect(authGuard.canActivate(ctx)).rejects.toThrow(UnauthorizedException);
  });
});
