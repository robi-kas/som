import { Module } from '@nestjs/common';
import { SyncService } from './sync.service.js';
import { SyncController } from './sync.controller.js';
import { OrdersModule } from '../orders/orders.module.js';

@Module({
  imports: [OrdersModule],
  providers: [SyncService],
  controllers: [SyncController]
})
export class SyncModule {}
