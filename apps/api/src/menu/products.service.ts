import * as fs from 'fs';
import * as path from 'path';
import { Injectable, ConflictException, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { EventsService } from '../events/events.service.js';
import { parseMoney } from '../common/money/pricing.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateProductDto } from './dto/create-product.dto.js';
import { ChangeProductPriceDto } from './dto/change-product-price.dto.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { toProductResponse } from '../common/mappers/response.mapper.js';
import { Prisma } from '@prisma/client';
import { PRODUCT_UPLOAD_DIR } from '../uploads/uploads.controller.js';

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

export type ProductStatus = 'AVAILABLE' | 'OUT_OF_STOCK' | 'INACTIVE';

const allowedProductTransitions: Record<ProductStatus, ProductStatus[]> = {
  AVAILABLE: ["OUT_OF_STOCK", "INACTIVE"],
  OUT_OF_STOCK: ["AVAILABLE", "INACTIVE"],
  INACTIVE: ["AVAILABLE"],
};

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    @Optional() private readonly events?: EventsService,
  ) {}

  /** Tells every waiter phone and the cashier to refresh the menu (e.g. an item just ran out). */
  private emitMenu(product: { organizationId: string; branchId: string; id: string }) {
    this.events?.emit({ type: 'menu.updated', organizationId: product.organizationId, branchId: product.branchId, entityId: product.id });
  }
  async findAll(branchId: string, categoryId: string | undefined, includeInactive: boolean, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.view');
    await assertBranchAccess(this.prisma, principal, branchId);

    const products = await this.prisma.product.findMany({
      where: {
        organizationId: principal.organizationId,
        branchId,
        ...(categoryId ? { categoryId } : {}),
        ...(includeInactive ? {} : { isActive: true, status: { not: 'INACTIVE' } }),
      },
      include: {
        category: true,
        modifiers: { where: { isActive: true }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] },
      },
      orderBy: [{ category: { displayOrder: 'asc' } }, { name: 'asc' }],
    });

    return products.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      sellingPrice: p.sellingPrice.toString(),
      status: p.status,
      categoryId: p.categoryId,
      category: p.category ? { name: p.category.name } : undefined,
      isActive: p.isActive,
      preparationStationId: p.preparationStationId,
      imageReference: p.imageReference,
      version: p.version,
      modifiers: p.modifiers.map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta.toString() })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Add-ons ("Extra shot +20", "No onions")
  // ---------------------------------------------------------------------------

  private async loadProductForWrite(id: string, principal: AuthenticatedPrincipal) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) throw new NotFoundException('Product not found');
    await assertBranchAccess(this.prisma, principal, product.branchId);
    return product;
  }

  async listModifiers(productId: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.view');
    await this.loadProductForWrite(productId, principal);
    const mods = await this.prisma.productModifier.findMany({
      where: { productId },
      orderBy: [{ isActive: 'desc' }, { displayOrder: 'asc' }, { name: 'asc' }],
    });
    return mods.map((m) => ({ id: m.id, name: m.name, priceDelta: m.priceDelta.toString(), isActive: m.isActive, displayOrder: m.displayOrder }));
  }

  async upsertModifier(
    productId: string,
    modifierId: string | null,
    dto: { name?: string; priceDelta?: string; isActive?: boolean; displayOrder?: number },
    principal: AuthenticatedPrincipal,
  ) {
    requirePermission(principal, 'product.update');
    const product = await this.loadProductForWrite(productId, principal);
    let priceDelta: Prisma.Decimal | undefined;
    if (dto.priceDelta !== undefined) {
      try {
        priceDelta = parseMoney(dto.priceDelta);
      } catch {
        throw new BadRequestException('Add-on price must be an amount like 0, 15 or 20.50');
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      let mod;
      if (modifierId) {
        const existing = await tx.productModifier.findUnique({ where: { id: modifierId } });
        if (!existing || existing.productId !== productId) throw new NotFoundException('Add-on not found');
        mod = await tx.productModifier.update({
          where: { id: modifierId },
          data: { name: dto.name?.trim(), priceDelta, isActive: dto.isActive, displayOrder: dto.displayOrder },
        });
      } else {
        if (!dto.name?.trim()) throw new BadRequestException('Name is required');
        mod = await tx.productModifier.create({
          data: {
            organizationId: principal.organizationId,
            productId,
            name: dto.name.trim(),
            priceDelta: priceDelta ?? new Prisma.Decimal(0),
            displayOrder: dto.displayOrder ?? 0,
          },
        });
      }
      await recordAudit(tx, {
        actorId: principal.userId,
        action: modifierId ? 'PRODUCT_MODIFIER_UPDATED' : 'PRODUCT_MODIFIER_CREATED',
        entityType: 'ProductModifier',
        entityId: mod.id,
        afterState: { productId, name: mod.name, priceDelta: mod.priceDelta.toString(), isActive: mod.isActive },
      });
      return mod;
    });
    this.emitMenu(product);
    return { id: result.id, name: result.name, priceDelta: result.priceDelta.toString(), isActive: result.isActive, displayOrder: result.displayOrder };
  }

  async create(dto: CreateProductDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.create');
    
    let price: Prisma.Decimal;
    try {
      price = new Prisma.Decimal(dto.price);
    } catch {
      throw new BadRequestException("Invalid product price");
    }

    if (price.isNegative()) {
      throw new BadRequestException("Price cannot be negative");
    }

    await assertBranchAccess(this.prisma, principal, dto.branchId);
    
    const category = await this.prisma.category.findFirst({
      where: { 
        id: dto.categoryId,
        organizationId: principal.organizationId,
        branchId: dto.branchId,
        isActive: true
      }
    });

    if (!category) {
      throw new BadRequestException("Invalid or inactive category in the specified branch");
    }

    if (dto.preparationStationId) {
      const station = await this.prisma.kitchenStation.findFirst({ 
        where: { 
          id: dto.preparationStationId,
          organizationId: principal.organizationId,
          branchId: dto.branchId,
          isActive: true
        }
      });
      if (!station) {
        throw new BadRequestException("Invalid or inactive kitchen station in the specified branch");
      }
    }

    const normalizedName = dto.name.trim();

    const result = await this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          organizationId: principal.organizationId,
          branchId: dto.branchId,
          categoryId: dto.categoryId,
          preparationStationId: dto.preparationStationId ?? null,
          name: normalizedName,
          description: dto.description ?? null,
          sellingPrice: price,
          status: "AVAILABLE",
          version: 1
        }
      });

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'CREATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: product.id,
        afterState: {
          name: normalizedName,
          sellingPrice: price.toString(),
          branchId: dto.branchId
        }
      });

      return product;
    });
    
    this.emitMenu(result);
    return toProductResponse(result);
  }

  
  async updateProduct(id: string, dto: import('./dto/update-product.dto.js').UpdateProductDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.update');

    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) {
      throw new NotFoundException('Product not found');
    }

    await assertBranchAccess(this.prisma, principal, product.branchId);

    if (dto.categoryId) {
      const category = await this.prisma.category.findFirst({
        where: { 
          id: dto.categoryId,
          organizationId: principal.organizationId,
          branchId: product.branchId,
          isActive: true
        }
      });
      if (!category) throw new BadRequestException("Invalid or inactive category");
    }

    if (dto.preparationStationId) {
      const station = await this.prisma.kitchenStation.findFirst({ 
        where: { 
          id: dto.preparationStationId,
          organizationId: principal.organizationId,
          branchId: product.branchId,
          isActive: true
        }
      });
      if (!station) throw new BadRequestException("Invalid or inactive kitchen station");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const data: any = {};
      if (dto.name) data.name = dto.name.trim();
      if (dto.description !== undefined) data.description = dto.description;
      if (dto.categoryId) data.categoryId = dto.categoryId;
      // '' means "no station": handed over by the waiter (bottled drinks), no ticket.
      if (dto.preparationStationId !== undefined) data.preparationStationId = dto.preparationStationId || null;

      const updated = await tx.product.update({
        where: { id },
        data: { ...data, version: { increment: 1 } }
      });

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'UPDATE_PRODUCT',
        entityType: 'PRODUCT',
        entityId: id,
        afterState: data
      });

      return updated;
    });

    this.emitMenu(result);
    return toProductResponse(result);
  }

  async deactivateProduct(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.update');
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) {
      throw new NotFoundException('Product not found');
    }
    await assertBranchAccess(this.prisma, principal, product.branchId);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { isActive: false, version: { increment: 1 } }
      });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'PRODUCT_DEACTIVATED',
        entityType: 'PRODUCT',
        entityId: id,
      });
      return updated;
    });
    this.emitMenu(result);
    return toProductResponse(result);
  }

  /**
   * "Remove from menu". An item nobody ever ordered is deleted for good. An item that appears
   * on past bills is only hidden — old receipts and reports still need its name and price.
   */
  async removeProduct(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.update');
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) throw new NotFoundException('Product not found');
    await assertBranchAccess(this.prisma, principal, product.branchId);

    const used = await this.prisma.orderItem.count({ where: { productId: id } });
    if (used > 0) {
      await this.deactivateProduct(id, principal);
      return { removed: 'hidden' as const, reason: `On ${used} past order line${used === 1 ? '' : 's'}, so it is hidden instead of deleted` };
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.productModifier.deleteMany({ where: { productId: id } });
      await tx.product.delete({ where: { id } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'PRODUCT_DELETED',
        entityType: 'PRODUCT',
        entityId: id,
        beforeState: { name: product.name, sellingPrice: product.sellingPrice.toString() },
      });
    });
    this.emitMenu(product);
    if (product.imageReference) {
      const file = product.imageReference.split('/').pop()?.split('?')[0];
      if (file && /^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(file)) fs.rm(path.join(PRODUCT_UPLOAD_DIR, file), { force: true }, () => undefined);
    }
    return { removed: 'deleted' as const };
  }

  /** "Bring back" a hidden item. */
  async restoreProduct(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.update');
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) throw new NotFoundException('Product not found');
    await assertBranchAccess(this.prisma, principal, product.branchId);
    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({ where: { id }, data: { isActive: true, status: 'AVAILABLE', version: { increment: 1 } } });
      await recordAudit(tx, { actorId: principal.userId, action: 'PRODUCT_RESTORED', entityType: 'PRODUCT', entityId: id });
      return updated;
    });
    this.emitMenu(result);
    return toProductResponse(result);
  }

  async changePrice(id: string, dto: ChangeProductPriceDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.price_update');
    
    let newPrice: Prisma.Decimal;
    try {
      newPrice = parseMoney(dto.newPrice);
    } catch {
      throw new BadRequestException("Invalid product price");
    }

    if (newPrice.isNegative()) throw new BadRequestException("Price cannot be negative");

    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) {
      throw new NotFoundException('Product not found');
    }
    
    if (product.status === 'INACTIVE') {
      throw new BadRequestException('Cannot change price of an inactive product');
    }

    await assertBranchAccess(this.prisma, principal, product.branchId);

    const result = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { sellingPrice: newPrice, version: { increment: 1 } }
      });

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'PRODUCT_PRICE_CHANGED',
        entityType: 'PRODUCT',
        entityId: product.id,
        beforeState: { sellingPrice: product.sellingPrice.toString() },
        afterState: { sellingPrice: newPrice.toString() },
        reason: dto.reason
      });

      return updated;
    });
    
    this.emitMenu(result);
    return toProductResponse(result);
  }
  
  async setStatus(id: string, status: ProductStatus, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.status_update');
    
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) {
      throw new NotFoundException('Product not found');
    }
    
    await assertBranchAccess(this.prisma, principal, product.branchId);
    
    if (product.status === status) {
      return toProductResponse(product);
    }
    
    const currentStatus = product.status as ProductStatus;
    if (!allowedProductTransitions[currentStatus].includes(status)) {
      throw new BadRequestException(`Cannot transition product from ${currentStatus} to ${status}`);
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.product.update({
          where: { id, version: product.version },
          data: { status, version: { increment: 1 } }
        });
        
        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'PRODUCT_STATUS_CHANGED',
          entityType: 'PRODUCT',
          entityId: id,
          beforeState: { status: product.status },
          afterState: { status: status }
        });
        
        return updated;
      });
      this.emitMenu(result);
      return toProductResponse(result);
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException('PRODUCT_VERSION_CONFLICT');
      }
      throw error;
    }
  }

  async uploadImage(id: string, file: Express.Multer.File, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'product.update');

    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product || product.organizationId !== principal.organizationId) {
      throw new NotFoundException('Product not found');
    }
    await assertBranchAccess(this.prisma, principal, product.branchId);

    // Never trust the client's filename: the extension comes from the validated mimetype.
    const ext = IMAGE_EXTENSIONS[file.mimetype];
    if (!ext) throw new BadRequestException('Unsupported image type');

    if (!fs.existsSync(PRODUCT_UPLOAD_DIR)) {
      fs.mkdirSync(PRODUCT_UPLOAD_DIR, { recursive: true });
    }

    // Remove older images for this product with a different extension.
    for (const oldExt of Object.values(IMAGE_EXTENSIONS)) {
      const stale = path.join(PRODUCT_UPLOAD_DIR, `${product.id}.${oldExt}`);
      if (oldExt !== ext && fs.existsSync(stale)) fs.unlinkSync(stale);
    }

    const filename = `${product.id}.${ext}`;
    fs.writeFileSync(path.join(PRODUCT_UPLOAD_DIR, filename), file.buffer);

    // Cache-busting query so clients pick up a replaced image.
    const imageReference = `/api/v1/uploads/products/${filename}?v=${Date.now()}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.product.update({ where: { id }, data: { imageReference } });
      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'PRODUCT_IMAGE_UPDATED',
        entityType: 'Product',
        entityId: id,
        afterState: { imageReference },
      });
    });

    return { imageReference };
  }
}
