import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../../auth/interfaces/authenticated-request.interface.js';

export const ORGANIZATION_ADMIN_PERMISSION = 'org.admin';

export function requirePermission(principal: AuthenticatedPrincipal, permission: string) {
  if (!principal || !Array.isArray(principal.permissions)) {
    // Never echo the principal back to the client.
    throw new UnauthorizedException();
  }
  if (!principal.permissions.includes(permission) && !principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION)) {
    throw new ForbiddenException({ code: 'PERMISSION_DENIED', permission, message: `Insufficient permissions: ${permission} required` });
  }
}
