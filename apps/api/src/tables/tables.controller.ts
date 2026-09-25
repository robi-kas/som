import { Controller, Get, Post, Body, Param, UseGuards, NotImplementedException, Query } from '@nestjs/common';
import { TablesService } from './tables.service.js';
import { CreateTableDto } from './dto/create-table.dto.js';
import { UpdateTableStatusDto } from './dto/update-table-status.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('tables')
@UseGuards(AuthGuard, PermissionsGuard)
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}
  @Get()
  @RequirePermissions('table.view')
  findAll(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('branchId') branchId?: string,
    @Query('includeInactive') includeInactive?: string,
  ) {
    return this.tablesService.findAll(principal, branchId, includeInactive === 'true');
  }

  @Get(':id')
  @RequirePermissions('table.view')
  findOne(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.tablesService.findOne(id, principal);
  }


  @Post()
  @RequirePermissions('table.create')
  create(@Body() dto: CreateTableDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.tablesService.create(dto, principal);
  }

  @Post(':id/set-status')
  @RequirePermissions('table.status_update')
  setStatus(@Param('id') id: string, @Body() dto: UpdateTableStatusDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.tablesService.setStatus(id, dto, principal);
  }

  @Post(':id/deactivate')
  @RequirePermissions('table.update')
  deactivate(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.tablesService.setActive(id, false, principal);
  }

  @Post(':id/activate')
  @RequirePermissions('table.update')
  activate(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.tablesService.setActive(id, true, principal);
  }
}
