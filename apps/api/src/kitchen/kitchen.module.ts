import { Module } from '@nestjs/common';
import { KitchenController } from './kitchen.controller.js';
import { KdsController } from './kds.controller.js';
import { KitchenService } from './kitchen.service.js';

@Module({
  controllers: [KitchenController, KdsController],
  providers: [KitchenService]
})
export class KitchenModule {}
