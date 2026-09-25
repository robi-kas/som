import { Module } from '@nestjs/common';
import { RefundsService } from './refunds.service.js';
import { RefundsController } from './refunds.controller.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [OrdersModule],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
