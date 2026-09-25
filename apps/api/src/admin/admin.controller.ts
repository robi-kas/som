import {
  Body, Controller, Get, Patch, Post, Delete, Query, UseGuards, BadRequestException, HttpCode,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { BrandingResetService } from './branding-reset.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { AdminService } from './admin.service.js';
import { UpdateBranchSettingsDto, ResetDataDto, PurgeAuditDto } from './admin.dto.js';

/** Public: name + logo for the sign-in page. */
@Controller('branding')
export class BrandingController {
  constructor(private readonly branding: BrandingResetService) {}

  @Get()
  get(@Query('org') org: string) {
    if (!org) throw new BadRequestException('org is required');
    return this.branding.publicBranding(org);
  }
}

@Controller()
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly branding: BrandingResetService,
  ) {}

  @Post('settings/logo')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }))
  uploadLogo(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 2 * 1024 * 1024 }), new FileTypeValidator({ fileType: /image\/(png|jpeg|webp)/ })],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.branding.uploadLogo(file, principal);
  }

  @Delete('settings/logo')
  @RequirePermissions('settings.manage')
  removeLogo(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.branding.removeLogo(principal);
  }

  @Get('settings/reset')
  @RequirePermissions('settings.manage')
  resetStatus(@CurrentUser() principal: AuthenticatedPrincipal) {
    return this.branding.resetStatus(principal);
  }

  @Post('settings/reset')
  @HttpCode(200)
  @RequirePermissions('settings.manage')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  reset(@Body() dto: ResetDataDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.branding.reset(dto, principal);
  }

  @Get('audit-logs')
  @RequirePermissions('report.view')
  audit(
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('entityId') entityId?: string,
    @Query('before') before?: string,
    @Query('limit') limit?: string,
  ) {
    return this.admin.listAudit(principal, { actorId, action, entityId, before, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @Post('audit-logs/purge')
  @HttpCode(200)
  @RequirePermissions('report.view')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  purgeAudit(@Body() dto: PurgeAuditDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.admin.purgeAudit(dto, principal);
  }

  @Get('settings/branch')
  @RequirePermissions('report.view')
  getSettings(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.admin.getBranchSettings(branchId, principal);
  }

  @Patch('settings/branch')
  @RequirePermissions('settings.manage')
  updateSettings(@Query('branchId') branchId: string, @Body() dto: UpdateBranchSettingsDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.admin.updateBranchSettings(branchId, dto, principal);
  }
}
