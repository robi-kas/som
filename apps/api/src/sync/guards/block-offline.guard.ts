import { Injectable, CanActivate, ExecutionContext, ConflictException } from '@nestjs/common';

@Injectable()
export class BlockOfflineGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    if (request.headers['x-offline-mode'] === 'true') {
      throw new ConflictException('OFFLINE_NOT_ALLOWED_FOR_OPERATION');
    }
    return true;
  }
}
