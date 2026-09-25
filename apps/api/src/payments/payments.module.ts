import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { PaymentMethodsController } from './payment-methods.controller.js';
import { PaymentMethodsService } from './payment-methods.service.js';
import { ReceiptsModule } from '../receipts/receipts.module.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [ReceiptsModule, OrdersModule],
  controllers: [PaymentsController, PaymentMethodsController],
  providers: [PaymentsService, PaymentMethodsService],
  exports: [PaymentMethodsService],
})
export class PaymentsModule {}
