'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { clock, dateLabel } from '@/lib/format';
import { PageHeader } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Input, PasswordInput } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useSession } from '@/lib/session';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface Entry {
  id: string;
  at: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

/** Turns an audit row into a sentence a manager can read. */
function describe(e: Entry) {
  const a = (e.after ?? {}) as Record<string, unknown>;
  const b = (e.before ?? {}) as Record<string, unknown>;
  const reason = typeof a.reason === 'string' ? ` — “${a.reason}”` : '';
  const approved = typeof a.approvedById === 'string' && a.approvedById ? ' (manager approved)' : '';
  switch (e.action) {
    case 'ORDER_CREATED':
      return `opened order #${a.orderNumber ?? ''}`;
    case 'ORDER_FIRED':
      return `sent order #${a.orderNumber ?? ''} to the kitchen`;
    case 'ORDER_ITEMS_SERVED':
      return 'marked items served';
    case 'ORDER_COMPLETED':
      return `closed order #${a.orderNumber ?? ''}`;
    case 'ORDER_VOIDED':
      return `cancelled order #${b.orderNumber ?? ''}${approved}${reason}`;
    case 'ORDER_ITEM_VOIDED':
      return `removed ${a.quantity ?? ''}× ${a.productName ?? 'item'} after it was sent${approved}${reason}`;
    case 'ORDER_ITEM_REMOVED':
      return `removed ${a.quantity ?? ''}× ${a.productName ?? 'item'} before sending`;
    case 'ORDER_DISCOUNT_APPLIED':
      return `gave a ${a.discountType === 'PERCENT' ? `${a.discountValue}%` : `${a.discountValue} ETB`} discount${approved}${reason}`;
    case 'PAYMENT_CONFIRMED':
      return `took ${a.applied} ETB (${a.method})`;
    case 'PAYMENT_RECORDED_PENDING':
      return `recorded ${a.applied} ETB by ${a.method}, ref ${a.reference} — waiting for verification`;
    case 'PAYMENT_VERIFIED':
      return `verified payment ref ${a.reference}`;
    case 'PAYMENT_REFERENCE_ADDED':
      return `added transaction number ${a.reference} to a ${a.applied} ETB payment (order #${a.orderNumber})`;
    case 'PAYMENT_REFERENCE_CHANGED':
      return `changed a transaction number ${b.reference} → ${a.reference} (order #${a.orderNumber})`;
    case 'PAYMENT_REJECTED':
      return `rejected payment ref ${a.reference ?? '(none)'}${reason}${a.changeLost ? ` — ${a.changeLost} ETB cash change had already been given` : ''}`;
    case 'PAYMENT_REPORTED_BY_WAITER':
      return `took a ${a.applied} ETB ${a.method} transfer at the table${Number(a.change) > 0 ? ` (customer sent ${a.sent}, ${a.change} change due at the till)` : ''}${a.photo ? ' with a photo' : ''}`;
    case 'PRODUCT_PRICE_CHANGED':
      return `changed a price ${b.sellingPrice} → ${a.sellingPrice} ETB${reason}`;
    case 'PRODUCT_STATUS_CHANGED':
      return `set an item to ${String(a.status).toLowerCase().replace('_', ' ')}`;
    case 'REFUND_INITIATED':
      return `started a ${a.amount} ETB refund${reason}`;
    case 'REFUND_APPROVED':
      return 'approved a refund';
    case 'REFUND_CONFIRMED':
      return `paid out a ${a.amount} ETB refund`;
    case 'SHIFT_CLOSED':
    case 'SHIFT_CLOSED_WITH_VARIANCE':
      return `closed their drawer: expected ${a.expected}, counted ${a.actual} (${a.variance})`;
    case 'SHIFT_VARIANCE_APPROVED':
      return `signed off a drawer difference of ${a.variance}${reason}`;
    case 'APPROVAL_GRANTED':
      return `approved with PIN: ${String(a.permission)}`;
    case 'LOGIN_SUCCESS':
      return 'signed in';
    case 'STAFF_CREATED':
      return `added ${a.username} as ${a.role}`;
    case 'ACTIVITY_LOG_CLEARED':
      return `cleared ${a.removed} activity entries older than ${a.olderThanDays} days`;
    case 'PRODUCT_DELETED':
      return 'deleted a menu item';
    case 'RECEIPT_REPRINTED':
      return `reprinted a receipt${reason}`;
    default:
      return e.action.toLowerCase().replace(/_/g, ' ');
  }
}

const SENSITIVE = /VOID|DISCOUNT|REFUND|PRICE|REJECT|VARIANCE|APPROVAL|REPRINT|CLEARED|RESET|REFERENCE_CHANGED|WAITER/;

export default function ActivityPage() {
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [filter, setFilter] = useState('');
  const [onlySensitive, setOnlySensitive] = useState(true);
  const { can } = useSession();
  const [clearOpen, setClearOpen] = useState(false);

  const load = useCallback(
    async (before?: string) => {
      try {
      setFailed(null);
        const q = new URLSearchParams({ limit: '150' });
        if (filter.trim()) q.set('action', filter.trim().replace(/\s+/g, '_'));
        if (before) q.set('before', before);
        const data = await api.get<Entry[]>(`/audit-logs?${q}`);
        setRows((prev) => (before && prev ? [...prev, ...data] : data));
      } catch (e) {
        setFailed(errorText(e));
      toast(errorText(e), 'error');
      }
    },
    [filter, toast],
  );

  useEffect(() => {
    load();
  }, [load]);

  if (!rows) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;
  const shown = onlySensitive ? rows.filter((r) => SENSITIVE.test(r.action)) : rows;

  return (
    <div className="pb-10">
      <PageHeader
        title="Activity log"
        sub="Every important action with who did it and when. Entries can’t be edited; the owner can clear old ones."
        actions={
          can('org.admin') && (
            <Button variant="outline" onClick={() => setClearOpen(true)}>
              Clear old entries
            </Button>
          )
        }
      />
      <ClearOldSheet open={clearOpen} onClose={() => setClearOpen(false)} onCleared={() => load()} />
      <div className="flex flex-col gap-4 px-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Input id="act-filter" className="h-10 max-w-xs" placeholder="Filter, e.g. void, discount, price" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-[#1f4a05]" checked={onlySensitive} onChange={(e) => setOnlySensitive(e.target.checked)} />
            Only money-sensitive actions
          </label>
        </div>
        <ol className="overflow-hidden rounded-xl border border-line bg-canvas">
          {shown.map((r) => (
            <li key={r.id} className="grid grid-cols-[5.5rem_1fr] gap-3 border-b border-line-soft px-4 py-3 text-sm last:border-0 sm:grid-cols-[7rem_1fr]">
              <span className="text-mute tnum">
                {dateLabel(r.at)} {clock(r.at)}
              </span>
              <span>
                <span className="font-semibold">{r.actorName}</span> {describe(r)}
              </span>
            </li>
          ))}
          {shown.length === 0 && <li className="px-4 py-10 text-center text-sm text-mute">Nothing matches.</li>}
        </ol>
        {rows.length >= 150 && (
          <Button variant="outline" onClick={() => load(rows[rows.length - 1].at)}>
            Load older
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Owner-only clean-up. Only whole old periods can go, never single entries, so nobody can
 * quietly erase one void or refund; and the clean-up itself is written to the log.
 */
function ClearOldSheet({ open, onClose, onCleared }: { open: boolean; onClose: () => void; onCleared: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState<30 | 90 | 365>(365);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { removed } = await api.post<{ removed: number }>('/audit-logs/purge', { olderThanDays: days, password });
      toast(removed ? `Removed ${removed} entries older than ${days} days` : `Nothing older than ${days} days`, 'ok');
      setPassword('');
      onClose();
      onCleared();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title="Clear old activity">
      <div className="flex flex-col gap-4 p-5">
        <p className="text-sm text-body">Keep the recent history and delete everything older. This can’t be undone.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([30, 90, 365] as const).map((d) => (
            <Button key={d} variant={days === d ? 'dark' : 'outline'} onClick={() => setDays(d)}>
              {d === 365 ? 'Older than 1 year' : `Older than ${d} days`}
            </Button>
          ))}
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-semibold">Your password</span>
          <PasswordInput id="purge-pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <Button variant="danger" size="lg" onClick={submit} loading={busy} disabled={busy || !password}>
          Delete entries older than {days === 365 ? '1 year' : `${days} days`}
        </Button>
      </div>
    </Sheet>
  );
}
