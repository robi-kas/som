import { Controller, Post, Get, Patch, Delete, Body, Param, HttpCode, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../auth/guards/auth.guard.js";
import { PermissionsGuard } from "../auth/guards/permissions.guard.js";
import { StaffService } from './staff.service.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { CreateStaffDto, SetStationsDto } from './dto/create-staff.dto.js';

@Controller('staff')
@UseGuards(AuthGuard, PermissionsGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Post()
  @RequirePermissions('user.manage')
  async createStaff(@Body() dto: CreateStaffDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.staffService.createStaff(dto, principal);
  }

  @Get()
  @RequirePermissions('user.manage')
  async getStaff(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.staffService.getStaff(principal);
  }

  @Patch(':id/deactivate')
  @RequirePermissions('user.manage')
  async deactivateStaff(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.staffService.deactivateStaff(id, principal);
  }

  @Patch(':id/stations')
  @RequirePermissions('user.manage')
  async setStations(@Param('id') id: string, @Body() dto: SetStationsDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.staffService.setStations(id, dto.stationIds, principal);
  }

  @Patch(":id/reactivate")
  @RequirePermissions("user.manage")
  async reactivateStaff(@Param("id") id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.staffService.reactivateStaff(id, principal);

  }

  

}
