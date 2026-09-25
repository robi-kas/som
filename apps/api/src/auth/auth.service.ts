import { Injectable, UnauthorizedException, OnModuleInit, Logger, BadRequestException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from './interfaces/authenticated-request.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';
import * as bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { LoginDto, ChangePasswordDto } from './dto/login.dto.js';
import type { LoginContext } from './interfaces/login-context.interface.js';
import { enforcePasswordPolicy } from './utils/password-policy.js';

export const SESSION_COOKIE = 'cafe_session';
const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** Absolute session length: one long shift. */
export function sessionTtlMs() {
  return Number(process.env.SESSION_TTL_HOURS ?? 16) * 60 * 60 * 1000;
}
/** Automatic logout after this much inactivity. */
export function sessionIdleMs() {
  return Number(process.env.SESSION_IDLE_MINUTES ?? 240) * 60 * 1000;
}

export function hashSessionToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService implements OnModuleInit {
  private dummyHash!: string;
  private readonly logger = new Logger(AuthService.name);

  constructor(private prisma: PrismaService) {}

  async onModuleInit() {
    this.dummyHash = await bcrypt.hash('dummy_secret_avoid_timing_attacks', 10);
  }

  async getMe(principal: AuthenticatedPrincipal) {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      include: { employee: true, organization: true, stations: { include: { station: true } } },
    });
    if (!user) throw new UnauthorizedException('User not found');
    const userRoles = await this.prisma.userRole.findMany({ where: { userId: principal.userId }, include: { role: true } });
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: principal.branchIds } },
      include: { config: true },
    });
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.employee ? `${user.employee.firstName} ${user.employee.lastName}`.trim() : user.username,
        forcePasswordChange: user.forcePasswordChange,
        hasPin: !!user.pinHash,
      },
      organization: { id: user.organization.id, name: user.organization.name, logoUrl: user.organization.logoReference },
      branches: branches.map((b) => ({
        id: b.id,
        name: b.name,
        currency: b.config?.currency ?? b.currency,
        ticketWarnMinutes: b.config?.ticketWarnMinutes ?? 8,
        ticketLateMinutes: b.config?.ticketLateMinutes ?? 12,
        waiterPayments: b.config?.waiterPayments ?? true,
        waiterPhotoRequired: b.config?.waiterPhotoRequired ?? true,
      })),
      permissions: principal.permissions,
      roleNames: userRoles.map((ur) => ur.role.name),
      // Prep stations this person works at; their kitchen screen opens on these.
      stations: user.stations.filter((us) => us.station.isActive).map((us) => ({ id: us.station.id, name: us.station.name, branchId: us.station.branchId })),
    };
  }

  async login(dto: LoginDto, ctx: LoginContext = {}) {
    const org = await this.prisma.organization.findUnique({ where: { slug: dto.organizationSlug } });

    const user = org
      ? await this.prisma.user.findUnique({
          where: { organizationId_username: { organizationId: org.id, username: dto.username } },
        })
      : null;

    // Always run bcrypt, even for unknown users, so response time doesn't reveal which usernames exist.
    const isMatch = await bcrypt.compare(dto.password, user ? user.passwordHash : this.dummyHash);
    const isLocked = !!user?.lockedUntil && user.lockedUntil > new Date();

    if (!user || !isMatch || !user.isActive || isLocked) {
      const reason = !user
        ? 'UNKNOWN_USERNAME'
        : isLocked
          ? 'ACCOUNT_LOCKED'
          : !isMatch
            ? 'INVALID_PASSWORD'
            : 'ACCOUNT_DISABLED';

      if (user && !isMatch && !isLocked) {
        const failures = user.failedLoginCount + 1;
        await this.prisma.user.update({
          where: { id: user.id },
          data:
            failures >= MAX_FAILED_LOGINS
              ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) }
              : { failedLoginCount: failures },
        });
      }

      try {
        await this.prisma.securityEvent.create({
          data: {
            organizationId: org?.id,
            actorUserId: user?.id || null,
            usernameAttempted: dto.username,
            eventType: 'LOGIN_FAILED',
            reason,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      } catch (err) {
        this.logger.error('Unable to write login security event', err);
      }
      throw new UnauthorizedException('Invalid credentials');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionTtlMs());

    const session = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
      const created = await tx.session.create({
        data: { userId: user.id, tokenHash: hashSessionToken(token), expiresAt, deviceId: ctx.deviceId },
      });
      await tx.auditLog.create({
        data: { actorId: user.id, action: 'LOGIN_SUCCESS', entityType: 'SESSION', entityId: created.id },
      });
      return created;
    });

    return { token, expiresAt: session.expiresAt, forcePasswordChange: user.forcePasswordChange };
  }

  async changePassword(dto: ChangePasswordDto, principal: AuthenticatedPrincipal) {
    enforcePasswordPolicy(dto.newPassword);
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('New password must be different');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is wrong');
    }
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, passwordChangedAt: new Date(), forcePasswordChange: false },
      });
      // Sign out every other device; keep the one that just changed the password.
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: principal.sessionId } },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: { actorId: user.id, action: 'PASSWORD_CHANGED', entityType: 'USER', entityId: user.id },
      });
    });
    return { success: true };
  }

  async logoutSession(sessionId: string, userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count > 0) {
        await tx.auditLog.create({ data: { actorId: userId, action: 'LOGOUT', entityType: 'SESSION', entityId: sessionId } });
      }
    });
  }

  async logoutAll(userId: string) {
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (result.count > 0) {
        await tx.auditLog.create({ data: { actorId: userId, action: 'LOGOUT_ALL', entityType: 'USER', entityId: userId } });
      }
    });
  }
}
