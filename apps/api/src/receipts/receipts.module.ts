import { Module } from '@nestjs/common';
import { ReceiptsService } from './receipts.service.js';
import { ReceiptsController } from './receipts.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService]
})
export class ReceiptsModule {}
