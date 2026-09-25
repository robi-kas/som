import { BlockOfflineGuard } from '../sync/guards/block-offline.guard.js';
import { Controller, Post, Get, Param, Body, Headers, UseGuards, HttpCode, Query, BadRequestException } from '@nestjs/common';
import { RefundsService } from './refunds.service.js';
import { InitiateRefundDto } from './dto/refund.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class RefundsController {
  constructor(private readonly refundsService: RefundsService) {}

  @Post('orders/:orderId/refunds')
  @RequirePermissions('refund.create')
  @UseGuards(BlockOfflineGuard)
  async initiateRefund(
    @Param('orderId') orderId: string,
    @Body() dto: InitiateRefundDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.refundsService.initiateRefund(orderId, dto, principal, idempotencyKey, approvalToken);
  }

  @Post('refunds/:refundId/approve')
  @HttpCode(200)
  // A cashier may call this too; the service then asks for a manager's PIN (X-Approval-Token).
  @UseGuards(BlockOfflineGuard)
  async approveRefund(
    @Param('refundId') refundId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.refundsService.approveRefund(refundId, principal, undefined, approvalToken);
  }

  @Post('refunds/:refundId/confirm')
  @HttpCode(200)
  @RequirePermissions('refund.confirm')
  @UseGuards(BlockOfflineGuard)
  async confirmRefund(
    @Param('refundId') refundId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.refundsService.confirmRefund(refundId, principal, idempotencyKey);
  }

  @Get('refunds/pending')
  @RequirePermissions('refund.approve')
  async listPending(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.refundsService.listPending(branchId, principal);
  }

  @Get('refunds/:refundId')
  @RequirePermissions('refund.view')
  async getRefund(
    @Param('refundId') refundId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.refundsService.getRefund(refundId, principal);
  }

  @Get('orders/:orderId/refunds')
  @RequirePermissions('refund.view')
  async listRefundsByOrder(
    @Param('orderId') orderId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.refundsService.listRefundsByOrder(orderId, principal);
  }
}
