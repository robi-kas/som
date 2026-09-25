import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service.js';
import { ReportsController } from './reports.controller.js';

@Module({
  providers: [ReportsService],
  controllers: [ReportsController]
})
export class ReportsModule {}
