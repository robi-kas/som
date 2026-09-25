import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { assertBranchAccess } from '../common/utils/branch-policy.js';
import { requirePermission } from '../common/utils/permission-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto.js';
import { DEFAULT_PAYMENT_METHODS } from './default-methods.js';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Makes sure a branch has the default list (branches created after the migration). */
  async ensureDefaults(branchId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
    const count = await tx.paymentMethod.count({ where: { branchId } });
    if (count > 0) return;
    await tx.paymentMethod.createMany({
      data: DEFAULT_PAYMENT_METHODS.map((d, i) => ({ ...d, branchId, displayOrder: i + 1 })),
      skipDuplicates: true,
    });
  }

  async list(branchId: string, principal: AuthenticatedPrincipal, includeInactive = false) {
    await assertBranchAccess(this.prisma, principal, branchId);
    await this.ensureDefaults(branchId);
    const rows = await this.prisma.paymentMethod.findMany({
      where: { branchId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      kind: r.kind,
      requiresReference: r.requiresReference,
      requiresProof: r.requiresProof,
      requiresVerification: r.requiresVerification,
      askPayerBank: r.askPayerBank,
      accountInfo: r.accountInfo,
      isActive: r.isActive,
      displayOrder: r.displayOrder,
    }));
  }

  /** Looked up by the payment flow; the rules come from here, not from the client. */
  async getActive(branchId: string, code: string, tx: Prisma.TransactionClient) {
    await this.ensureDefaults(branchId, tx);
    const method = await tx.paymentMethod.findUnique({ where: { branchId_code: { branchId, code } } });
    if (!method || !method.isActive) throw new BadRequestException({ code: 'METHOD_NOT_ACCEPTED', message: 'This payment method is switched off' });
    return method;
  }

  async create(dto: CreatePaymentMethodDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'settings.manage');
    await assertBranchAccess(this.prisma, principal, dto.branchId);
    const code =
      dto.code ??
      (dto.name
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 30) || 'METHOD');
    if (!/^[A-Z]/.test(code)) throw new BadRequestException('Name must start with a letter');
    const isCash = dto.kind === 'CASH';
    try {
      const max = await this.prisma.paymentMethod.aggregate({ where: { branchId: dto.branchId }, _max: { displayOrder: true } });
      const created = await this.prisma.paymentMethod.create({
        data: {
          branchId: dto.branchId,
          code,
          name: dto.name.trim(),
          kind: dto.kind,
          requiresReference: dto.requiresReference ?? !isCash,
          requiresProof: dto.requiresProof ?? dto.kind === 'BANK_APP',
          requiresVerification: dto.requiresVerification ?? !(isCash || dto.kind === 'CARD'),
          askPayerBank: dto.askPayerBank ?? false,
          accountInfo: dto.accountInfo?.trim() || null,
          displayOrder: (max._max.displayOrder ?? 0) + 1,
        },
      });
      await recordAudit(this.prisma, { actorId: principal.userId, action: 'PAYMENT_METHOD_CREATED', entityType: 'PaymentMethod', entityId: created.id, afterState: { code, name: created.name } });
      return created;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('A method with that name already exists');
      throw e;
    }
  }

  async update(id: string, dto: UpdatePaymentMethodDto, principal: AuthenticatedPrincipal) {
    requirePermission(principal, 'settings.manage');
    const method = await this.prisma.paymentMethod.findUnique({ where: { id } });
    if (!method) throw new NotFoundException();
    await assertBranchAccess(this.prisma, principal, method.branchId);
    if (method.code === 'CASH' && dto.isActive === false) throw new BadRequestException('Cash can’t be switched off');
    // Cash never needs a reference or a second check; don't let a setting break the till.
    const safe = method.kind === 'CASH' ? { ...dto, requiresReference: false, requiresProof: false, requiresVerification: false } : dto;
    const updated = await this.prisma.paymentMethod.update({
      where: { id },
      data: { ...safe, name: safe.name?.trim(), accountInfo: safe.accountInfo === undefined ? undefined : safe.accountInfo.trim() || null },
    });
    await recordAudit(this.prisma, {
      actorId: principal.userId,
      action: 'PAYMENT_METHOD_UPDATED',
      entityType: 'PaymentMethod',
      entityId: id,
      afterState: dto as unknown as Record<string, string | number | boolean | null>,
    });
    return updated;
  }
}
