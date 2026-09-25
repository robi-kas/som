import { Controller, Header, MessageEvent, Query, Sse, UseGuards } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { AuthGuard } from '../auth/guards/auth.guard.js';
import { CurrentUser } from '../auth/decorators/current-user.decorator.js';
import type { AuthenticatedPrincipal } from '../auth/interfaces/authenticated-request.interface.js';
import { ORGANIZATION_ADMIN_PERMISSION } from '../common/utils/permission-policy.js';
import { EventsService } from './events.service.js';

@Controller('events')
@UseGuards(AuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Server-Sent Events stream. Browsers connect with `new EventSource('/api/v1/events?branchId=...')`
   * — the session cookie authenticates it. Reconnection is automatic.
   */
  @Sse()
  // no-transform stops proxies/compression (e.g. the Next.js rewrite) from buffering the stream.
  @Header('Cache-Control', 'no-cache, no-transform')
  @Header('X-Accel-Buffering', 'no')
  stream(@CurrentUser() principal: AuthenticatedPrincipal, @Query('branchId') branchId?: string): Observable<MessageEvent> {
    const isAdmin = principal.permissions.includes(ORGANIZATION_ADMIN_PERMISSION);
    let scope: string[] | 'ALL' = isAdmin ? 'ALL' : principal.branchIds;
    if (branchId && (isAdmin || principal.branchIds.includes(branchId))) scope = [branchId];

    const live = this.events.stream(principal.organizationId, scope).pipe(
      map((e): MessageEvent => ({ type: e.type, data: e })),
    );
    // Heartbeat keeps proxies from closing an idle connection.
    const heartbeat = interval(25_000).pipe(map((): MessageEvent => ({ type: 'ping', data: {} })));
    return merge(live, heartbeat);
  }
}
