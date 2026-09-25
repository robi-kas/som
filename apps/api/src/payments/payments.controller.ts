import { BlockOfflineGuard } from '../sync/guards/block-offline.guard.js';
import {
  Controller, Post, Get, Body, Headers, UseGuards, Param, HttpCode, Query, Res, BadRequestException,
  UseInterceptors, UploadedFile, ParseFilePipe, MaxFileSizeValidator, FileTypeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PaymentsService } from './payments.service.js';
import { CreatePaymentDto, RejectPaymentDto, SetReferenceDto, ReportPaymentDto } from './dto/payment.dto.js';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { PermissionsGuard } from '../auth/guards/permissions.guard.js';
import { RequirePermissions } from '../auth/decorators/permissions.decorator.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';

@UseGuards(AuthGuard, PermissionsGuard)
@Controller()
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('orders/:orderId/payments')
  @RequirePermissions('payment.collect')
  @UseGuards(BlockOfflineGuard)
  createPayment(
    @Param('orderId') orderId: string,
    @Body() dto: CreatePaymentDto,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.createPayment(orderId, dto, principal, idempotencyKey);
  }

  /** A waiter records a transfer from their phone, with the photo in the same request. */
  @Post('orders/:orderId/payments/report')
  @RequirePermissions('payment.report')
  @UseGuards(BlockOfflineGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024, files: 1 } }))
  reportPayment(
    @Param('orderId') orderId: string,
    @Body() dto: ReportPaymentDto,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.reportPayment(orderId, dto, file, principal, idempotencyKey);
  }

  @Get('payments/pending')
  @RequirePermissions('payment.view')
  listPending(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.paymentsService.listPending(branchId, principal);
  }

  @Get('payments/history')
  @RequirePermissions('payment.view')
  listHistory(
    @Query('branchId') branchId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('method') method: string | undefined,
    @Query('status') status: string | undefined,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    if (!branchId || !from || !to) throw new BadRequestException('branchId, from and to are required');
    return this.paymentsService.listHistory({ branchId, from: new Date(from), to: new Date(to), method: method || undefined, status: status || undefined }, principal);
  }

  @Get('payments/missing-reference')
  @RequirePermissions('payment.view')
  listMissingReferences(@Query('branchId') branchId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    if (!branchId) throw new BadRequestException('branchId is required');
    return this.paymentsService.listMissingReferences(branchId, principal);
  }

  @Post('payments/:paymentId/reference')
  @HttpCode(200)
  @RequirePermissions('payment.collect')
  setReference(@Param('paymentId') paymentId: string, @Body() dto: SetReferenceDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.paymentsService.setReference(paymentId, dto.referenceNumber, principal);
  }

  @Post('payments/:paymentId/confirm')
  @HttpCode(200)
  @RequirePermissions('payment.confirm')
  @UseGuards(BlockOfflineGuard)
  confirmPayment(
    @Param('paymentId') paymentId: string,
    @CurrentUser() principal: AuthenticatedPrincipal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.confirmPayment(paymentId, principal, idempotencyKey);
  }

  @Post('payments/:paymentId/reject')
  @HttpCode(200)
  @RequirePermissions('payment.confirm')
  @UseGuards(BlockOfflineGuard)
  rejectPayment(@Param('paymentId') paymentId: string, @Body() dto: RejectPaymentDto, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.paymentsService.rejectPayment(paymentId, dto.reason, principal);
  }

  @Post('payments/:paymentId/evidence')
  @HttpCode(200)
  @RequirePermissions('payment.collect')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 4 * 1024 * 1024 } }))
  attachEvidence(
    @Param('paymentId') paymentId: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: 4 * 1024 * 1024 }), new FileTypeValidator({ fileType: /image\/(png|jpeg|webp)/ })],
      }),
    )
    file: Express.Multer.File,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    return this.paymentsService.attachEvidence(paymentId, file, principal);
  }

  @Get('payments/:paymentId/evidence')
  @RequirePermissions('payment.view')
  async getEvidence(@Param('paymentId') paymentId: string, @CurrentUser() principal: AuthenticatedPrincipal, @Res() res: Response) {
    const file = await this.paymentsService.getEvidencePath(paymentId, principal);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(file);
  }

  @Get('payments/:paymentId')
  @RequirePermissions('payment.view')
  getPayment(@Param('paymentId') paymentId: string, @CurrentUser() principal: AuthenticatedPrincipal) {
    return this.paymentsService.getPayment(paymentId, principal);
  }
}
