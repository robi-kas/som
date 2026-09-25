import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('ReportsController', () => {
  let controller: ReportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      // AuthGuard needs PrismaService; the service itself is not exercised here.
      providers: [{ provide: ReportsService, useValue: {} }, { provide: PrismaService, useValue: {} }],
    }).compile();
    controller = module.get<ReportsController>(ReportsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
