import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuthenticatedPrincipal } from '../interfaces/authenticated-request.interface.js';
import { SESSION_COOKIE, hashSessionToken, sessionIdleMs } from '../auth.service.js';
import { readCookie } from '../utils/cookies.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Endpoints a user with a forced password change may still call. */
const ALLOWED_DURING_FORCED_CHANGE = ['/auth/me', '/auth/password', '/auth/logout'];

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedPrincipal }>();

    const { token, viaCookie } = this.extractToken(req);
    if (!token) {
      throw new UnauthorizedException('Missing or malformed authorization header');
    }

    // CSRF defence for cookie sessions: a cross-site form can't set custom headers,
    // so every state-changing browser request must carry X-Requested-With.
    if (viaCookie && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'cafe-web') {
      throw new ForbiddenException('Missing CSRF header');
    }

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashSessionToken(token) },
      include: {
        user: {
          include: {
            userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
            userBranches: true,
          },
        },
      },
    });

    const now = Date.now();
    if (!session || session.revokedAt || session.expiresAt.getTime() <= now || !session.user.isActive) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Automatic logout after inactivity.
    if (session.lastActivityAt.getTime() < now - sessionIdleMs()) {
      await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session timed out');
    }

    if (session.user.forcePasswordChange) {
      const path = (req.originalUrl || req.url || '').split('?')[0];
      if (!ALLOWED_DURING_FORCED_CHANGE.some((p) => path.endsWith(p))) {
        throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: 'Change your password to continue' });
      }
    }

    if (session.lastActivityAt.getTime() < now - 60 * 1000) {
      this.prisma.session
        .updateMany({ where: { id: session.id, revokedAt: null }, data: { lastActivityAt: new Date() } })
        .catch((e) => this.logger.error('Failed to update lastActivityAt', e));
    }

    const permissions = [
      ...new Set(session.user.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code))),
    ];
    const principal: AuthenticatedPrincipal = {
      userId: session.user.id,
      sessionId: session.id,
      organizationId: session.user.organizationId,
      branchIds: session.user.userBranches.map((ub) => ub.branchId),
      permissions,
    };
    req.user = principal;
    return true;
  }

  private extractToken(req: Request): { token?: string; viaCookie: boolean } {
    const header = req.headers.authorization;
    if (header) {
      const parts = header.split(' ');
      if (parts.length !== 2 || parts[0] !== 'Bearer' || !parts[1]) {
        throw new UnauthorizedException('Malformed authorization header');
      }
      return { token: parts[1], viaCookie: false };
    }
    const cookie = readCookie(req, SESSION_COOKIE);
    return { token: cookie, viaCookie: !!cookie };
  }
}
