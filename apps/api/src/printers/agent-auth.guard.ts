import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { hashAgentKey } from './printer-jobs.service.js';

/** Authenticates the in-cafe print agent by its X-Agent-Key header. */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const key = req.headers['x-agent-key'];
    if (typeof key !== 'string' || !key.startsWith('pa_')) throw new UnauthorizedException();
    const agent = await this.prisma.printAgent.findUnique({ where: { keyHash: hashAgentKey(key) } });
    if (!agent || !agent.isActive) throw new UnauthorizedException();
    req.agent = { id: agent.id, branchId: agent.branchId };
    return true;
  }
}
