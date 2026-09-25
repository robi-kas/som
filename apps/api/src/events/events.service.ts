import { Injectable } from '@nestjs/common';
import { Subject, Observable, filter } from 'rxjs';

/**
 * In-process event bus for live screens (KDS, cashier, waiter floor, dashboard).
 *
 * Events are deliberately thin — "order X changed" — and clients refetch what they show.
 * That keeps permission checks in the normal REST endpoints and means a missed event
 * only costs a slightly stale screen, never wrong data.
 *
 * Scaling note: this Subject lives in one Node process. When you run more than one API
 * instance, swap it for Postgres LISTEN/NOTIFY or Redis pub/sub behind the same interface.
 */
export type CafeEventType =
  | 'order.updated'
  | 'ticket.updated'
  | 'table.updated'
  | 'payment.updated'
  | 'printer.updated'
  | 'menu.updated'
  | 'shift.updated';

export interface CafeEvent {
  type: CafeEventType;
  organizationId: string;
  branchId: string;
  entityId?: string;
  data?: Record<string, string | number | boolean | null>;
  at: string;
}

@Injectable()
export class EventsService {
  private readonly bus = new Subject<CafeEvent>();

  emit(event: Omit<CafeEvent, 'at'>) {
    this.bus.next({ ...event, at: new Date().toISOString() });
  }

  stream(organizationId: string, branchIds: string[] | 'ALL'): Observable<CafeEvent> {
    return this.bus.pipe(
      filter((e) => e.organizationId === organizationId && (branchIds === 'ALL' || branchIds.includes(e.branchId))),
    );
  }
}
