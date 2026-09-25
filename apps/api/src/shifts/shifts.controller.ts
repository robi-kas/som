import { BlockOfflineGuard } from '../sync/guards/block-offline.guard.js';
import { Controller, Post, Get, Body, Headers, UseGuards, Param, HttpCode, Query, BadRequestException } from '@nestjs/common';
import { ShiftsService } from './shifts.service.js';
import { OpenShiftDto, CashMovementDto, CloseShiftDto, ApproveVarianceDto } from './dto/shift.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private readonly shiftsService: ShiftsService) {}

  @Post('open')
  @RequirePermissions('shift.open')
  async openShift(
    @Body() dto: OpenShiftDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shiftsService.openShift(dto, principal, idempotencyKey);
  }

  @Post(':id/cash-movement')
  @RequirePermissions('shift.cash_movement')
  async addCashMovement(
    @Param('id') shiftId: string,
    @Body() dto: CashMovementDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shiftsService.addCashMovement(shiftId, dto, principal, idempotencyKey);
  }

  @Get('current')
  @RequirePermissions('shift.view_own')
  async getCurrentShift(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.shiftsService.getCurrentShift(principal);
  }

  @Post(':id/close')
  @HttpCode(200)
  @RequirePermissions('shift.close')
  @UseGuards(BlockOfflineGuard)
  async closeShift(
    @Param('id') shiftId: string,
    @Body() dto: CloseShiftDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.shiftsService.closeShift(shiftId, dto, principal);
  }

  // No @RequirePermissions: a cashier may call this with a manager's X-Approval-Token.
  @Post(':id/approve-variance')
  @HttpCode(200)
  @UseGuards(BlockOfflineGuard)
  async approveVariance(
    @Param('id') shiftId: string,
    @Body() dto: ApproveVarianceDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.shiftsService.approveVariance(shiftId, dto, principal, approvalToken);
  }

  @Get('pending-variances')
  @RequirePermissions('shift.approve_variance')
  async listPendingVariances(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.shiftsService.listPendingVariances(branchId, principal);
  }

  // Own shift: always allowed. Someone else's: needs shift.view_report (checked in the service).
  @Get(':id/report')
  async getShiftReport(
    @Param('id') shiftId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.shiftsService.getShiftReport(shiftId, principal);
  }
}
