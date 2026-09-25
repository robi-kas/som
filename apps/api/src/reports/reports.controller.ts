import { Controller, Get, Query, Res, UseGuards, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService, todayLocal } from './reports.service.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@Controller('reports')
@UseGuards(AuthGuard, PermissionsGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('daily-sales')
  @RequirePermissions('report.view_financial')
  getDailySalesReport(@Query('branchId') branchId: string, @Query('date') date: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.reportsService.getDailySalesReport(branchId, date || todayLocal(), principal);
  }

  @Get('range')
  @RequirePermissions('report.view_financial')
  getRange(
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    if (!branchId || !from || !to) throw new BadRequestException('branchId, from and to are required');
    return this.reportsService.getRangeReport(branchId, from, to, principal);
  }

  @Get('dashboard')
  @RequirePermissions('report.view')
  getOperationalDashboard(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.reportsService.getOperationalDashboard(branchId, principal);
  }

  @Get('cash-variance')
  @RequirePermissions('report.view_financial')
  getCashVarianceReport(
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.reportsService.getCashVarianceReport(branchId, from, to, principal);
  }

  @Get('orders.csv')
  @RequirePermissions('report.view_financial')
  async exportCsv(
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Res() res: Response,
  ) {
    if (!branchId || !from || !to) throw new BadRequestException('branchId, from and to are required');
    const csv = await this.reportsService.exportOrdersCsv(branchId, from, to, principal);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="orders-${from}-to-${to}.csv"`);
    res.send('﻿' + csv); // BOM so Excel opens Amharic text correctly
  }
}
