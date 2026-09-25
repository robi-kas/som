import { BadRequestException, ForbiddenException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { hasPermission } from '../common/utils/approval-policy.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto.js';

@Controller('payment-methods')
@UseGuards(AuthGuard, PermissionsGuard)
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  // Cashiers (payment.view) and waiters recording a transfer (payment.report) both need the list.
  @Get()
  list(@Query('branchId') branchId: string, @Query('all') all: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    if (!hasPermission(principal, 'payment.view') && !hasPermission(principal, 'payment.report')) throw new ForbiddenException('Insufficient permissions');
    return this.methods.list(branchId, principal, all === 'true');
  }

  @Post()
  @RequirePermissions('settings.manage')
  create(@Body() dto: CreatePaymentMethodDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.methods.create(dto, principal);
  }

  @Patch(':id')
  @RequirePermissions('settings.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.methods.update(id, dto, principal);
  }
}
