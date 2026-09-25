import { Controller, Get, Post, Body, Param, Query, UseGuards, NotImplementedException, BadRequestException } from '@nestjs/common';
import { CategoriesService } from './categories.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('categories')
@UseGuards(AuthGuard, PermissionsGuard)
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}
  @Get()
  @RequirePermissions('category.view')
  findAll(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.categoriesService.findAll(branchId, principal);
  }


  @Post()
  @RequirePermissions('category.create')
  create(@Body() dto: CreateCategoryDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.categoriesService.create(dto, principal);
  }

  @Post(':id/deactivate')
  @RequirePermissions('category.deactivate')
  deactivate(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.categoriesService.deactivate(id, principal);
  }
  
  @Post(':id/activate')
  @RequirePermissions('category.update')
  activate(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.categoriesService.activate(id, principal);
  }
}
