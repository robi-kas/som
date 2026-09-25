import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { SyncController } from './sync.controller.js';
import { SyncService } from './sync.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

describe('SyncController', () => {
  let controller: SyncController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [{ provide: SyncService, useValue: {} }, { provide: PrismaService, useValue: {} }],
    }).compile();
    controller = module.get<SyncController>(SyncController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
