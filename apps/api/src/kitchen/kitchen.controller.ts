import { Controller, Post, Body, Param, UseGuards, NotImplementedException } from '@nestjs/common';
import { KitchenService } from './kitchen.service.js';
import { CreateKitchenStationDto } from './dto/create-station.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('kitchen-stations')
@UseGuards(AuthGuard, PermissionsGuard)
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Post()
  @RequirePermissions('kitchen_station.create')
  create(@Body() dto: CreateKitchenStationDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.kitchenService.create(dto, principal);
  }

  @Post(':id/deactivate')
  @RequirePermissions('kitchen_station.deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.kitchenService.deactivate(id, principal);
  }
  
  @Post(':id/activate')
  @RequirePermissions('kitchen_station.update')
  activate() {
    throw new NotImplementedException('Intentionally deferred');
  }
}
