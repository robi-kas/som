import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthenticatedPrincipal } from '../interfaces/authenticated-request.interface.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return request.user;
  },
);
