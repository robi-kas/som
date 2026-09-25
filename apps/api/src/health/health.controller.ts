import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaService } from '../prisma/prisma.service.js';

/** Liveness + database readiness for Docker, load balancers and uptime monitors. */
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    const started = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({ status: 'error', database: 'down' });
    }
    return {
      status: 'ok',
      database: 'up',
      dbLatencyMs: Date.now() - started,
      uptimeSeconds: Math.round(process.uptime()),
      version: process.env.APP_VERSION ?? 'dev',
    };
  }
}
