'use client';

import { useEffect, useRef, useState } from 'react';

export type LiveStatus = 'connecting' | 'live' | 'offline';

type EventType =
  | 'order.updated'
  | 'ticket.updated'
  | 'table.updated'
  | 'payment.updated'
  | 'printer.updated'
  | 'menu.updated'
  | 'shift.updated';

const ALL_TYPES: EventType[] = ['order.updated', 'ticket.updated', 'table.updated', 'payment.updated', 'printer.updated', 'menu.updated', 'shift.updated'];

export interface LiveEvent {
  type: EventType;
  branchId: string;
  entityId?: string;
  at: string;
}

/**
 * One shared Server-Sent Events connection per browser tab.
 *
 * Why shared: over plain HTTP (e.g. localhost in development) browsers allow only 6 open
 * connections per site. Every EventSource holds one open forever, so a page with two live
 * widgets in a few tabs used up all 6 and every other request (the page's data) hung —
 * the page just kept loading. Now every useLive() in a tab rides on the same connection.
 */
type Listener = { types: Set<string>; onEvent: (e: LiveEvent | null) => void; onStatus: (s: LiveStatus) => void };

class LiveHub {
  private es: EventSource | null = null;
  private branchId = '';
  private listeners = new Set<Listener>();
  private status: LiveStatus = 'connecting';
  private retry = 1000;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;

  subscribe(branchId: string, l: Listener) {
    clearTimeout(this.closeTimer);
    this.listeners.add(l);
    l.onStatus(this.status);
    if (branchId !== this.branchId || !this.es) {
      this.branchId = branchId;
      this.connect();
    }
    return () => {
      this.listeners.delete(l);
      // Page transitions unsubscribe and resubscribe immediately; don't drop the connection for that.
      if (this.listeners.size === 0) this.closeTimer = setTimeout(() => this.close(), 3000);
    };
  }

  private setStatus(s: LiveStatus) {
    this.status = s;
    this.listeners.forEach((l) => l.onStatus(s));
  }

  private emit(e: LiveEvent | null) {
    this.listeners.forEach((l) => {
      if (!e || l.types.has(e.type)) l.onEvent(e);
    });
  }

  private close() {
    clearTimeout(this.retryTimer);
    this.es?.close();
    this.es = null;
  }

  private connect() {
    this.close();
    if (!this.branchId) return;
    const es = new EventSource(`/api/v1/events?branchId=${encodeURIComponent(this.branchId)}`, { withCredentials: true });
    this.es = es;
    es.onopen = () => {
      this.retry = 1000;
      this.setStatus('live');
      this.emit(null); // catch up on anything missed while disconnected
    };
    es.onerror = () => {
      this.setStatus(navigator.onLine ? 'connecting' : 'offline');
      es.close();
      if (this.es === es) this.es = null;
      if (this.listeners.size === 0) return;
      this.retryTimer = setTimeout(() => this.connect(), this.retry);
      this.retry = Math.min(this.retry * 2, 15_000);
    };
    for (const t of ALL_TYPES) {
      es.addEventListener(t, (msg) => {
        try {
          this.emit(JSON.parse((msg as MessageEvent).data) as LiveEvent);
        } catch {
          this.emit(null);
        }
      });
    }
  }

  reconnectNow() {
    this.retry = 1000;
    if (this.listeners.size) this.connect();
  }
}

let hub: LiveHub | null = null;
function getHub() {
  if (!hub) {
    hub = new LiveHub();
    window.addEventListener('online', () => hub?.reconnectNow());
  }
  return hub;
}

/**
 * Calls `onEvent` for matching live events (debounced), and every `fallbackMs` as a safety
 * net, so a screen is never more than a few seconds stale even if the stream silently drops.
 * Screens don't trust events for data — they just refetch.
 */
export function useLive(
  branchId: string | undefined,
  types: EventType[],
  onEvent: (e: LiveEvent | null) => void,
  fallbackMs = 30_000,
): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const typesKey = types.join(',');

  useEffect(() => {
    if (!branchId) return;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    // Coalesce bursts (a payment emits order + table + payment events) into one refetch.
    const fire = (e: LiveEvent | null) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => handler.current(e), 150);
    };
    const unsubscribe = getHub().subscribe(branchId, {
      types: new Set(typesKey.split(',')),
      onEvent: fire,
      onStatus: setStatus,
    });
    const poll = setInterval(() => fire(null), fallbackMs);
    const onOffline = () => setStatus('offline');
    window.addEventListener('offline', onOffline);
    return () => {
      unsubscribe();
      clearTimeout(debounce);
      clearInterval(poll);
      window.removeEventListener('offline', onOffline);
    };
  }, [branchId, typesKey, fallbackMs]);

  return status;
}

/** Re-renders every `ms` so timers ("12m ago") stay fresh. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
