import { Controller, Post, Get, Body, Param, UseGuards, Headers, Query, BadRequestException } from '@nestjs/common';
import { SyncService } from './sync.service.js';
import { SyncBatchDto } from './dto/sync-event.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('sync')
@UseGuards(AuthGuard, PermissionsGuard)
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('batch')
  @RequirePermissions('sync.submit')
  submitSyncBatch(
    @Headers('x-device-id') deviceId: string,
    @Body() dto: SyncBatchDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    if (!deviceId || !/^[A-Za-z0-9_-]{8,64}$/.test(deviceId)) throw new BadRequestException('x-device-id header is required');
    return this.syncService.submitSyncBatch(deviceId, dto.events, principal);
  }

  @Get('status/:deviceId')
  @RequirePermissions('sync.view')
  getSyncStatus(@Param('deviceId') deviceId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.syncService.getSyncStatus(deviceId, principal);
  }

  @Get('conflicts')
  @RequirePermissions('sync.resolve_conflict')
  listConflicts(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.syncService.listConflicts(branchId, principal);
  }

  @Post('conflicts/:eventId/resolve')
  @RequirePermissions('sync.resolve_conflict')
  resolveConflict(
    @Param('eventId') eventId: string,
    @Body('resolution') resolution: 'ACCEPT_LOCAL' | 'REJECT_LOCAL',
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.syncService.resolveConflict(eventId, resolution, principal);
  }
}
