import { BlockOfflineGuard } from '../sync/guards/block-offline.guard.js';
import type { ProductStatus } from "./products.service.js";
import { Controller, Get, Post, Patch, Body, Param, Query, UseGuards, NotImplementedException, BadRequestException, UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { UpdateProductDto } from './dto/update-product.dto.js';
import { SetProductStatusDto } from './dto/set-product-status.dto.js';
import { ChangeProductPriceDto } from './dto/change-product-price.dto.js';
import { ModifierDto } from './dto/modifier.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('products')
@UseGuards(AuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}
  @Get()
  @RequirePermissions('product.view')
  findAll(
    @Query('branchId') branchId: string,
    @Query('categoryId') categoryId: string,
    @Query('includeInactive') includeInactive: string,
    @CurrentUser() principal: AuthenticatedPrincipal
  ) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.productsService.findAll(branchId, categoryId, includeInactive === 'true', principal);
  }


  @Post()
  @RequirePermissions('product.create')
  create(@Body() dto: CreateProductDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.create(dto, principal);
  }

  
  @Patch(':id')
  @RequirePermissions('product.update')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.updateProduct(id, dto, principal);
  }

  @Post(':id/change-price')
  @RequirePermissions('product.price_update')
  @UseGuards(BlockOfflineGuard)
  changePrice(@Param('id') id: string, @Body() dto: ChangeProductPriceDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.changePrice(id, dto, principal);
  }

  @Post(':id/set-status')
  @RequirePermissions('product.status_update')
  setStatus(@Param('id') id: string, @Body() dto: SetProductStatusDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.setStatus(id, dto.status as ProductStatus, principal);
  }

  @Post(':id/remove')
  @RequirePermissions('product.update')
  remove(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.removeProduct(id, principal);
  }

  @Post(':id/restore')
  @RequirePermissions('product.update')
  restore(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.restoreProduct(id, principal);
  }

  @Post(':id/deactivate')
  @RequirePermissions('product.update')
  deactivate(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.deactivateProduct(id, principal);
  }

  @Get(':id/modifiers')
  @RequirePermissions('product.view')
  listModifiers(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.listModifiers(id, principal);
  }

  @Post(':id/modifiers')
  @RequirePermissions('product.update')
  createModifier(@Param('id') id: string, @Body() dto: ModifierDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.productsService.upsertModifier(id, null, dto, principal);
  }

  @Patch(':id/modifiers/:modifierId')
  @RequirePermissions('product.update')
  updateModifier(
    @Param('id') id: string,
    @Param('modifierId') modifierId: string,
    @Body() dto: ModifierDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.productsService.upsertModifier(id, modifierId, dto, principal);
  }

  @Post(':id/image')
  @RequirePermissions('product.update')
  @UseInterceptors(FileInterceptor('file'))
  uploadImage(
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }),
          new FileTypeValidator({ fileType: /image\/(png|jpeg|webp)/ }),
        ],
      }),
    ) file: Express.Multer.File,
    @CurrentUser() principal: AuthenticatedPrincipal
  ) {
    return this.productsService.uploadImage(id, file, principal);
  }
}
