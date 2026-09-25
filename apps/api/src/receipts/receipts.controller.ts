import { Controller, Get, Post, Param, Body, UseGuards, HttpCode, Query, BadRequestException } from '@nestjs/common';
import { ReceiptsService } from './receipts.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { ReprintReceiptDto } from './dto/receipt.dto.js';

@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class ReceiptsController {
  constructor(private readonly receiptsService: ReceiptsService) {}

  @Get('receipts')
  @RequirePermissions('receipt.view')
  listReceipts(@Query('branchId') branchId: string, @Query('from') from: string, @Query('to') to: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId || !from || !to) throw new BadRequestException('branchId, from and to are required');
    return this.receiptsService.listReceipts({ branchId, from: new Date(from), to: new Date(to) }, principal);
  }

  @Get('receipts/:id/preview')
  @RequirePermissions('receipt.view')
  previewReceipt(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.receiptsService.previewReceipt(id, principal);
  }

  @Get('receipts/:id')
  @RequirePermissions('receipt.view')
  getReceipt(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.receiptsService.getReceipt(id, principal);
  }

  @Post('receipts/:id/reprint')
  @HttpCode(200)
  @RequirePermissions('receipt.reprint')
  reprintReceipt(@Param('id') id: string, @Body() dto: ReprintReceiptDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.receiptsService.reprintReceipt(id, dto.reason, principal);
  }

  /** Prints the (non-final) bill for the table. */
  @Post('orders/:id/print-bill')
  @HttpCode(200)
  @RequirePermissions('order.view')
  printBill(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.receiptsService.printBill(id, principal);
  }
}
