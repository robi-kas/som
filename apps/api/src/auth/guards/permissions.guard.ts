import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator.js';
import { ORGANIZATION_ADMIN_PERMISSION } from '../../common/utils/permission-policy.js';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user || !user.permissions) throw new ForbiddenException();

    // org.admin bypasses granular permission requirements
    if (user.permissions.includes(ORGANIZATION_ADMIN_PERMISSION)) {
      return true;
    }

    // Default AND logic for permissions
    const hasPermissions = requiredPermissions.every(p => user.permissions.includes(p));
    if (!hasPermissions) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
