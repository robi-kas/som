'use client';

import { useCallback, useEffect, useState } from 'react';
import { uuid } from '@/lib/uuid';
import { api, ApiError } from './api';

/**
 * Offline ordering.
 *
 * While the Wi-Fi is down a waiter can still build an order and press Send. The order is
 * stored on the phone and delivered when the connection returns:
 *   - NEW_ORDER  → POST /sync/batch (the server creates, prices and fires it)
 *   - ADD_ITEMS  → items for an order that already exists on the server
 *
 * Only ordering works offline. Payments, refunds and price changes always need the server.
 */

export interface CartLine {
  key: string;
  productId: string;
  name: string;
  unitPrice: string;
  quantity: number;
  notes?: string;
  modifierIds: string[];
  modifierNames: string[];
  modifierTotal: string;
}

type QueueItem =
  | { id: string; kind: 'NEW_ORDER'; createdAt: string; branchId: string; tableId?: string; tableName?: string; lines: CartLine[] }
  | { id: string; kind: 'ADD_ITEMS'; createdAt: string; orderId: string; tableName?: string; lines: CartLine[] };

export interface Rejected {
  id: string;
  tableName?: string;
  reason: string;
  at: string;
}

const QUEUE_KEY = 'offlineQueue';
const REJECTED_KEY = 'offlineRejected';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    window.dispatchEvent(new Event('offline-queue'));
  } catch {
    /* storage full or blocked */
  }
}

export function deviceId(): string {
  try {
    let id = localStorage.getItem('deviceId');
    if (!id) {
      id = `dev_${uuid().replace(/-/g, '').slice(0, 24)}`;
      localStorage.setItem('deviceId', id);
    }
    return id;
  } catch {
    return 'dev_unknown_device';
  }
}

/** Omit that keeps a union's variants apart (plain Omit merges them into one shape). */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function enqueue(item: DistributiveOmit<QueueItem, 'id' | 'createdAt'> & { id?: string }) {
  const q = read<QueueItem[]>(QUEUE_KEY, []);
  q.push({ ...item, id: item.id ?? uuid(), createdAt: new Date().toISOString() } as QueueItem);
  write(QUEUE_KEY, q);
}

export function toApiItems(lines: CartLine[]) {
  return lines.map((l) => ({
    productId: l.productId,
    quantity: l.quantity,
    notes: l.notes || undefined,
    modifierIds: l.modifierIds.length ? l.modifierIds : undefined,
  }));
}

let flushing = false;

/** Sends everything queued. Safe to call often; only one flush runs at a time. */
export async function flushQueue(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    let q = read<QueueItem[]>(QUEUE_KEY, []);
    for (const item of [...q]) {
      let done = false;
      let rejectedReason: string | null = null;
      try {
        if (item.kind === 'NEW_ORDER') {
          const res = await api.post<{ syncStatus: string; errorMessage: string | null }[]>(
            '/sync/batch',
            {
              events: [
                {
                  localEventId: item.id,
                  entityType: 'Order',
                  entityId: item.id,
                  eventType: 'ORDER_SUBMITTED',
                  clientTimestamp: item.createdAt,
                  payload: { branchId: item.branchId, tableId: item.tableId, items: toApiItems(item.lines) },
                },
              ],
            },
            { headers: { 'x-device-id': deviceId() } },
          );
          const r = res[0];
          if (r?.syncStatus === 'SYNCED' || r?.syncStatus === 'CONFLICT') done = true;
          if (r?.syncStatus === 'CONFLICT') rejectedReason = 'The table was taken by someone else while you were offline. A manager will sort it out.';
          if (r?.syncStatus === 'REJECTED') {
            done = true;
            rejectedReason = r.errorMessage ?? 'Rejected';
          }
        } else {
          const order = await api.get<{ version: number }>(`/orders/${item.orderId}`);
          const added = await api.post<{ version: number }>(`/orders/${item.orderId}/items`, {
            expectedVersion: order.version,
            items: toApiItems(item.lines),
          });
          await api.post(`/orders/${item.orderId}/fire`, { expectedVersion: added.version });
          done = true;
        }
      } catch (e) {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 408 && e.status !== 429) {
          // The server understood and refused (e.g. item out of stock): don't retry forever.
          done = true;
          rejectedReason = e.message;
        } else {
          break; // still offline / server down: keep the rest queued, try later
        }
      }
      if (done) {
        q = read<QueueItem[]>(QUEUE_KEY, []).filter((x) => x.id !== item.id);
        write(QUEUE_KEY, q);
        if (rejectedReason) {
          const rej = read<Rejected[]>(REJECTED_KEY, []);
          rej.push({ id: item.id, tableName: item.tableName, reason: rejectedReason, at: new Date().toISOString() });
          write(REJECTED_KEY, rej.slice(-20));
        }
      }
    }
  } finally {
    flushing = false;
  }
}

export function useOfflineQueue() {
  const [count, setCount] = useState(0);
  const [rejected, setRejected] = useState<Rejected[]>([]);
  const [online, setOnline] = useState(true);

  const refresh = useCallback(() => {
    setCount(read<QueueItem[]>(QUEUE_KEY, []).length);
    setRejected(read<Rejected[]>(REJECTED_KEY, []));
    setOnline(navigator.onLine);
  }, []);

  useEffect(() => {
    refresh();
    const onOnline = () => {
      refresh();
      flushQueue().finally(refresh);
    };
    window.addEventListener('offline-queue', refresh);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', refresh);
    const id = setInterval(() => flushQueue().finally(refresh), 15_000);
    flushQueue().finally(refresh);
    return () => {
      window.removeEventListener('offline-queue', refresh);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', refresh);
      clearInterval(id);
    };
  }, [refresh]);

  const dismissRejected = useCallback(() => {
    write(REJECTED_KEY, []);
    refresh();
  }, [refresh]);

  return { count, rejected, online, dismissRejected };
}

/** Last good copy of the menu, so the waiter can still order during an outage. */
export function cacheMenu(branchId: string, data: unknown) {
  try {
    localStorage.setItem(`menu:${branchId}`, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}
export function cachedMenu<T>(branchId: string): T | null {
  return read<T | null>(`menu:${branchId}`, null);
}
