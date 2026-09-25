import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { ApprovalsService } from './approvals.service.js';
import { CreateApprovalDto, SetPinDto } from './dto/approval.dto.js';

@Controller()
@UseGuards(AuthGuard)
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Post('approvals')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  create(@Body() dto: CreateApprovalDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.approvals.createApproval(dto, principal);
  }

  @Post('auth/pin')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  setPin(@Body() dto: SetPinDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.approvals.setOwnPin(dto, principal);
  }
}
