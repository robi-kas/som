import { Module } from '@nestjs/common';
import { AdminController, BrandingController } from './admin.controller.js';
import { BrandingResetService } from './branding-reset.service.js';
import { AdminService } from './admin.service.js';

@Module({
  controllers: [AdminController, BrandingController],
  providers: [AdminService, BrandingResetService],
})
export class AdminModule {}
