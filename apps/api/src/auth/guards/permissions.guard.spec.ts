import { PermissionsGuard } from './permissions.guard.js';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Reflector } from '@nestjs/core';

describe('PermissionsGuard', () => {
  let permissionsGuard: PermissionsGuard;
  const mockReflector = { getAllAndOverride: vi.fn() };

  beforeEach(() => {
    permissionsGuard = new PermissionsGuard(mockReflector as unknown as Reflector);
    vi.clearAllMocks();
  });

  const createMockContext = (userPermissions?: string[]) => {
    const req = { user: userPermissions ? { permissions: userPermissions } : null };
    return {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: vi.fn(),
      getClass: vi.fn(),
    } as unknown as ExecutionContext;
  };

  it('AUTH-013 Permission guard rejects missing permission', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['users.manage', 'orders.manage']);
    const ctx = createMockContext(['orders.manage']); // Missing users.manage

    expect(() => permissionsGuard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it('Permits if user has all required permissions', () => {
    mockReflector.getAllAndOverride.mockReturnValue(['orders.manage']);
    const ctx = createMockContext(['orders.manage', 'another.perm']);

    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });

  it('Permits if no permissions required', () => {
    mockReflector.getAllAndOverride.mockReturnValue([]);
    const ctx = createMockContext([]);
    expect(permissionsGuard.canActivate(ctx)).toBe(true);
  });
});
