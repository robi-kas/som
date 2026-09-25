import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller.js';
import { ProductsController } from './products.controller.js';
import { CategoriesService } from './categories.service.js';
import { ProductsService } from './products.service.js';

@Module({
  controllers: [CategoriesController, ProductsController],
  providers: [CategoriesService, ProductsService],
  exports: [CategoriesService, ProductsService]
})
export class MenuModule {}
