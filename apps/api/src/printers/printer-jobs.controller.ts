import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards, Req, HttpCode, BadRequestException } from '@nestjs/common';
import { PrinterJobsService } from './printer-jobs.service.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { AgentAuthGuard } from './agent-auth.guard.js';
import { CreatePrinterDto, UpdatePrinterDto, CreatePrintAgentDto, JobResultDto, HeartbeatDto } from './dto/printer.dto.js';

@Controller('printer-jobs')
@UseGuards(AuthGuard, PermissionsGuard)
export class PrinterJobsController {
  constructor(private readonly printerJobsService: PrinterJobsService) {}

  @Get('problems')
  @RequirePermissions('printer.view')
  listProblems(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.printerJobsService.listProblemJobs(branchId, principal);
  }

  @Get('history')
  @RequirePermissions('printer.view')
  history(
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('kind') kind: string | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    if (!branchId || !from || !to) throw new BadRequestException('branchId, from and to are required');
    const k = kind === 'bills' || kind === 'kitchen' ? kind : 'all';
    return this.printerJobsService.listHistory({ branchId, from: new Date(from), to: new Date(to), kind: k }, principal);
  }

  @Get(':id/preview')
  @RequirePermissions('printer.view')
  preview(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.printerJobsService.preview(id, principal);
  }

  @Get(':id')
  @RequirePermissions('printer.view')
  getJob(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.printerJobsService.getJob(id, principal);
  }

  @Post(':id/retry')
  @HttpCode(200)
  @RequirePermissions('printer.retry')
  retryJob(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.printerJobsService.retry(id, principal);
  }

  @Post(':id/reprint')
  @HttpCode(200)
  @RequirePermissions('printer.reprint')
  reprintJob(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.printerJobsService.reprint(id, principal);
  }
}

@Controller('printers')
@UseGuards(AuthGuard, PermissionsGuard)
export class PrintersAdminController {
  constructor(private readonly service: PrinterJobsService) {}

  @Get()
  @RequirePermissions('printer.view')
  list(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.service.listPrinters(branchId, principal);
  }

  @Post()
  @RequirePermissions('printer.manage')
  create(@Body() dto: CreatePrinterDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.service.createPrinter(dto, principal);
  }

  @Patch(':id')
  @RequirePermissions('printer.manage')
  update(@Param('id') id: string, @Body() dto: UpdatePrinterDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.service.updatePrinter(id, dto, principal);
  }

  @Post(':id/test')
  @HttpCode(200)
  @RequirePermissions('printer.manage')
  test(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.service.testPrint(id, principal);
  }

  @Post('agents')
  @RequirePermissions('printer.manage')
  createAgent(@Body() dto: CreatePrintAgentDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.service.createAgent(dto, principal);
  }

  @Post('agents/:id/revoke')
  @HttpCode(200)
  @RequirePermissions('printer.manage')
  revokeAgent(@Param('id') id: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.service.revokeAgent(id, principal);
  }
}

/** Endpoints used by apps/print-agent. Authenticated with X-Agent-Key, not a user session. */
@Controller('print-agent')
@UseGuards(AgentAuthGuard)
export class PrintAgentController {
  constructor(private readonly service: PrinterJobsService) {}

  @Post('claim')
  @HttpCode(200)
  claim(@Req() req: { agent: { id: string; branchId: string } }) {
    return this.service.claimJobs(req.agent);
  }

  @Post('jobs/:id/result')
  @HttpCode(200)
  result(@Req() req: { agent: { id: string; branchId: string } }, @Param('id') id: string, @Body() dto: JobResultDto) {
    return this.service.reportResult(req.agent, id, dto);
  }

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(@Req() req: { agent: { id: string; branchId: string } }, @Body() dto: HeartbeatDto) {
    return this.service.heartbeat(req.agent, dto);
  }
}
