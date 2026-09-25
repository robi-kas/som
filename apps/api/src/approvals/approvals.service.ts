import { ForbiddenException, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { ORGANIZATION_ADMIN_PERMISSION } from '../common/utils/permission-policy.js';
import { hashApprovalToken } from '../common/utils/approval-policy.js';
import { recordAudit } from '../common/utils/audit.helper.js';
import { CreateApprovalDto, SetPinDto } from './dto/approval.dto.js';

const APPROVAL_TTL_MS = 3 * 60 * 1000;
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const WEAK_PINS = new Set(['0000', '1111', '1234', '12345', '123456', '4321', '000000', '111111', '2580']);

@Injectable()
export class ApprovalsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * A manager enters their username + PIN on the requester's device.
   * Returns a single-use token valid for 3 minutes, for one permission, for this requester only.
   */
  async createApproval(dto: CreateApprovalDto, requester: AuthenticatedPrincipal) {
    const approver = await this.prisma.user.findUnique({
      where: { organizationId_username: { organizationId: requester.organizationId, username: dto.username } },
      include: {
        employee: true,
        userBranches: true,
        userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
      },
    });

    // Same generic error for every failure so the PIN pad can't be used to probe usernames.
    const deny = () => new UnauthorizedException({ code: 'APPROVAL_DENIED', message: 'Wrong username or PIN' });
    if (!approver || !approver.isActive || !approver.pinHash) throw deny();

    if (approver.pinLockedUntil && approver.pinLockedUntil > new Date()) {
      throw new ForbiddenException({ code: 'PIN_LOCKED', message: 'Too many wrong PINs. Try again in 15 minutes.' });
    }

    const ok = await bcrypt.compare(dto.pin, approver.pinHash);
    if (!ok) {
      const failures = approver.pinFailedCount + 1;
      await this.prisma.user.update({
        where: { id: approver.id },
        data: {
          pinFailedCount: failures >= PIN_MAX_FAILURES ? 0 : failures,
          pinLockedUntil: failures >= PIN_MAX_FAILURES ? new Date(Date.now() + PIN_LOCK_MS) : undefined,
        },
      });
      await this.prisma.securityEvent.create({
        data: {
          organizationId: requester.organizationId,
          actorUserId: requester.userId,
          usernameAttempted: dto.username,
          eventType: 'APPROVAL_PIN_FAILED',
          reason: dto.permission,
        },
      });
      throw deny();
    }

    const perms = approver.userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.code));
    const isAdmin = perms.includes(ORGANIZATION_ADMIN_PERMISSION);
    if (!isAdmin && !perms.includes(dto.permission)) {
      throw new ForbiddenException({ code: 'APPROVER_LACKS_PERMISSION', message: `${dto.username} can't approve this` });
    }
    if (!isAdmin && !approver.userBranches.some((ub) => requester.branchIds.includes(ub.branchId))) {
      throw new ForbiddenException({ code: 'APPROVER_OTHER_BRANCH', message: `${dto.username} works at another branch` });
    }
    if (approver.id === requester.userId) {
      throw new BadRequestException('You already have this permission');
    }

    const token = randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + APPROVAL_TTL_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: approver.id }, data: { pinFailedCount: 0, pinLockedUntil: null } });
      const grant = await tx.approvalGrant.create({
        data: {
          organizationId: requester.organizationId,
          tokenHash: hashApprovalToken(token),
          approverId: approver.id,
          requestedById: requester.userId,
          permission: dto.permission,
          expiresAt,
        },
      });
      await recordAudit(tx, {
        actorId: approver.id,
        action: 'APPROVAL_GRANTED',
        entityType: 'ApprovalGrant',
        entityId: grant.id,
        afterState: { permission: dto.permission, requestedById: requester.userId },
      });
    });

    const displayName = approver.employee
      ? `${approver.employee.firstName} ${approver.employee.lastName}`.trim()
      : approver.username;

    return { approvalToken: token, permission: dto.permission, approver: { id: approver.id, displayName }, expiresAt };
  }

  /** Sets or changes the caller's own PIN. Requires their password, like any credential change. */
  async setOwnPin(dto: SetPinDto, principal: AuthenticatedPrincipal) {
    if (WEAK_PINS.has(dto.pin) || /^(\d)\1+$/.test(dto.pin)) {
      throw new BadRequestException('Choose a less obvious PIN');
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: principal.userId } });
    const ok = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Current password is wrong');

    const pinHash = await bcrypt.hash(dto.pin, 12);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { pinHash, pinFailedCount: 0, pinLockedUntil: null } });
      await recordAudit(tx, { actorId: user.id, action: 'PIN_SET', entityType: 'USER', entityId: user.id });
    });
    return { success: true };
  }
}
