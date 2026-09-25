import { Injectable, ForbiddenException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateCategoryDto } from './dto/create-category.dto.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { toCategoryResponse } from '../common/mappers/response.mapper.js';
import { Prisma } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}
  async findAll(branchId: string, principal: AuthenticatedPrincipal) {
    // assertBranchAccess also lets org admins see every branch.
    await assertBranchAccess(this.prisma, principal, branchId);
    const categories = await this.prisma.category.findMany({
      where: {
        organizationId: principal.organizationId,
        branchId,
      },
      orderBy: { displayOrder: 'asc' }
    });
    return categories.map(c => ({
      id: c.id,
      name: c.name,
      displayOrder: c.displayOrder,
      isActive: c.isActive
    }));
  }


  // Intentionally deferred: list, update, activate

  async create(dto: CreateCategoryDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'category.create');
    const normalizedName = dto.name.trim();

    await assertBranchAccess(this.prisma, principal, dto.branchId);

    try {
      const category = await this.prisma.$transaction(async (tx) => {
        const created = await tx.category.create({
          data: {
            organizationId: principal.organizationId,
            branchId: dto.branchId,
            name: normalizedName,
            isActive: true,
          }
        });

        await recordAudit(tx, {
          actorId: principal.userId,
          action: 'CREATE_CATEGORY',
          entityType: 'CATEGORY',
          entityId: created.id,
          afterState: { name: normalizedName, branchId: dto.branchId, organizationId: principal.organizationId }
        });

        return created;
      });
      return toCategoryResponse(category);
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Category name already exists in this branch');
      }
      throw e;
    }
  }

  async deactivate(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'category.deactivate');

    const result = await this.prisma.$transaction(async (tx) => {
      const category = await tx.category.findUnique({ where: { id } });
      if (!category || category.organizationId !== principal.organizationId) {
        throw new NotFoundException('Category not found');
      }

      await assertBranchAccess(tx, principal, category.branchId);

      const activeProducts = await tx.product.count({
        where: {
          categoryId: id,
          status: { in: ['AVAILABLE', 'OUT_OF_STOCK'] }
        }
      });

      if (activeProducts > 0) {
        throw new ConflictException('Cannot deactivate category containing active products');
      }

      const updated = await tx.category.update({
        where: { id },
        data: { isActive: false }
      });

      await recordAudit(tx, {
        actorId: principal.userId,
        action: 'DEACTIVATE_CATEGORY',
        entityType: 'CATEGORY',
        entityId: id,
        beforeState: { isActive: true },
        afterState: { isActive: false }
      });

      return updated;
    });

    return toCategoryResponse(result);
  }

  async activate(id: string, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'category.update');
    const category = await this.prisma.category.findUnique({ where: { id } });
    if (!category || category.organizationId !== principal.organizationId) throw new NotFoundException('Category not found');
    await assertBranchAccess(this.prisma, principal, category.branchId);
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.category.update({ where: { id }, data: { isActive: true } });
      await recordAudit(tx, { actorId: principal.userId, action: 'ACTIVATE_CATEGORY', entityType: 'CATEGORY', entityId: id });
      return u;
    });
    return toCategoryResponse(updated);
  }
}
