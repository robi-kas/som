import { Controller, Post, Get, Body, Param, UseGuards, Headers, HttpCode, Query, BadRequestException } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import {
  CreateDraftOrderDto,
  AddItemsToOrderDto,
  VoidOrderItemDto,
  FireOrderDto,
  ServeItemsDto,
  ApplyDiscountDto,
  TransferTableDto,
} from './dto/orders.dto.js';
import { VoidOrderDto } from './dto/void-order.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import type { OrderResponseDto } from '../common/mappers/response.mapper.js';

/**
 * Sensitive actions (voiding fired items, large discounts, voiding orders) accept an
 * `X-Approval-Token` header: the one-time token a manager creates by entering their PIN.
 */
@Controller('orders')
@UseGuards(AuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @RequirePermissions('order.view')
  findAll(
    @Query('branchId') branchId: string,
    @Query('status') status: string,
    @Query('paymentStatus') paymentStatus: string,
    @Query('limit') limit: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.ordersService.findAll(
      { branchId, status, paymentStatus, limit: limit ? parseInt(limit, 10) : 50 },
      principal,
    );
  }

  @Get(':id/receipts')
  @RequirePermissions('order.view')
  getReceipts(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.ordersService.getOrderReceipts(id, principal);
  }

  @Get(':id')
  @RequirePermissions('order.view')
  getOrder(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.ordersService.getOrder(id, principal);
  }

  @Post()
  @RequirePermissions('order.create')
  createDraftOrder(@Body() dto: CreateDraftOrderDto, @CurrentUser() principal: AuthenticatedPrincipal): Promise<OrderResponseDto> {
    return this.ordersService.createDraftOrder(dto, principal);
  }

  @Post(':id/items')
  @RequirePermissions('order.edit')
  addItemsToOrder(
    @Param('id') id: string,
    @Body() dto: AddItemsToOrderDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('x-offline-mode') offlineMode?: string,
    @Headers('x-device-id') deviceId?: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.addItemsToOrder(id, dto, principal, offlineMode === 'true', deviceId);
  }

  @Post(':id/fire')
  @HttpCode(200)
  @RequirePermissions('order.submit')
  fireOrderToKitchen(@Param('id') id: string, @Body() dto: FireOrderDto, @CurrentUser() principal: AuthenticatedPrincipal): Promise<OrderResponseDto> {
    return this.ordersService.fireOrderToKitchen(id, dto, principal);
  }

  @Post(':id/serve')
  @HttpCode(200)
  @RequirePermissions('order.edit')
  serveItems(@Param('id') id: string, @Body() dto: ServeItemsDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.ordersService.serveItems(id, dto, principal);
  }

  @Post(':id/request-bill')
  @HttpCode(200)
  @RequirePermissions('order.edit')
  requestBill(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.ordersService.requestBill(id, principal);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  @RequirePermissions('order.edit')
  transferTable(@Param('id') id: string, @Body() dto: TransferTableDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.ordersService.transferTable(id, dto, principal);
  }

  @Post(':id/discount')
  @HttpCode(200)
  @RequirePermissions('order.discount')
  applyDiscount(
    @Param('id') id: string,
    @Body() dto: ApplyDiscountDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.ordersService.applyDiscount(id, dto, principal, approvalToken);
  }

  @Post(':id/items/:itemId/void')
  @HttpCode(200)
  @RequirePermissions('order.edit')
  voidOrderItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: VoidOrderItemDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('x-approval-token') approvalToken?: string,
  ) {
    return this.ordersService.voidOrderItem(id, itemId, dto, principal, approvalToken);
  }

  @Post(':id/void')
  @HttpCode(200)
  @RequirePermissions('order.edit')
  voidOrder(
    @Param('id') id: string,
    @Body() dto: VoidOrderDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Headers('x-approval-token') approvalToken?: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.voidOrder(id, dto, principal, idempotencyKey, undefined, approvalToken);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('order.complete')
  completeOrder(
    @Param('id') id: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.completeOrder(id, principal, idempotencyKey);
  }
}
