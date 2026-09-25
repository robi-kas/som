import { Controller, Get, Post, Param, Query, UseGuards } from '@nestjs/common';
import { KitchenService } from './kitchen.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('kitchen')
@UseGuards(AuthGuard, PermissionsGuard)
export class KdsController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Get('tickets')
  @RequirePermissions('kds.view')
  getTickets(
    @Query('branchId') branchId: string,
    @Query('stationId') stationId: string | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal
  ) {
    return this.kitchenService.getTickets(branchId, stationId, principal);
  }

  @Post('tickets/:id/acknowledge')
  @RequirePermissions('kds.update')
  acknowledgeTicket(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.kitchenService.acknowledgeTicket(id, principal);
  }

  @Post('tickets/:id/ready')
  @RequirePermissions('kds.update')
  readyTicket(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.kitchenService.readyTicket(id, principal);
  }

  @Post('tickets/:id/recall')
  @RequirePermissions('kds.update')
  recallTicket(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.kitchenService.recallTicket(id, principal);
  }

  @Get('tickets/recent')
  @RequirePermissions('kds.view')
  getRecentlyBumped(
    @Query('branchId') branchId: string,
    @Query('stationId') stationId: string | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.kitchenService.getRecentlyBumped(branchId, stationId, principal);
  }

  @Get('stations')
  @RequirePermissions('kds.view')
  getStations(
    @Query('branchId') branchId: string,
    @CurrentUser() principal: AuthenticatedPrincipal
  ) {
    return this.kitchenService.getStations(branchId, principal);
  }
}
