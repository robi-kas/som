'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { clock, money } from '@/lib/format';
import { PageHeader } from '@/components/admin/AdminShell';
import { ReceiptCanvas, printImage, type PrintPreview, type ReceiptCanvasHandle } from '@/components/print/ReceiptCanvas';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/Icon';
import { Input } from '@/components/ui/Field';
import { Pill, type Tone } from '@/components/ui/Pill';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface ReceiptRow {
  id: string;
  receiptNumber: string;
  orderNumber: string | null;
  table: string | null;
  waiterName: string | null;
  total: string | null;
  paid: string | null;
  method: string | null;
  reprintCount: number;
  createdAt: string;
}

interface JobRow {
  id: string;
  status: string;
  printerName: string;
  printerKind: string;
  ticketType: string;
  isReprint: boolean;
  orderNumber: string | null;
  table: string | null;
  total: string | null;
  receiptNumber: string | null;
  stationName: string | null;
  itemCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  printedAt: string | null;
}

type Tab = 'receipts' | 'log';
type LogKind = 'bills' | 'kitchen' | 'all';
type Selected = { type: 'receipt'; row: ReceiptRow } | { type: 'job'; row: JobRow };

const JOB_STATUS: Record<string, { label: string; tone: Tone }> = {
  PRINTED: { label: 'Printed', tone: 'good' },
  PENDING: { label: 'Waiting', tone: 'warn' },
  QUEUED: { label: 'Waiting', tone: 'warn' },
  PRINTING: { label: 'Printing', tone: 'info' },
  FAILED: { label: 'Failed', tone: 'bad' },
  FAILED_PERMANENT: { label: 'Failed', tone: 'bad' },
};

const TICKET_LABEL: Record<string, string> = {
  RECEIPT: 'Receipt',
  BILL: 'Bill (before payment)',
  NEW_ORDER: 'Kitchen ticket',
  ADDITION: 'Kitchen · addition',
  CANCELLATION: 'Kitchen · void',
  TEST: 'Test page',
};

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayRange(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  return { from: new Date(y, m - 1, d).toISOString(), to: new Date(y, m - 1, d + 1).toISOString() };
}

export default function PrintedBillsPage() {
  const { branchId, can } = useSession();
  const toast = useToast();
  const canLog = can('printer.view');
  const [tab, setTab] = useState<Tab>('receipts');
  const [kind, setKind] = useState<LogKind>('bills');
  const [day, setDay] = useState(() => dayKey(new Date()));
  const [receipts, setReceipts] = useState<ReceiptRow[] | null>(null);
  const [jobs, setJobs] = useState<JobRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Selected | null>(null);
  const [preview, setPreview] = useState<PrintPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const paper = useRef<ReceiptCanvasHandle>(null);
  const today = dayKey(new Date());

  const load = useCallback(async () => {
    if (!branchId) return;
    setFailed(null);
    const { from, to } = dayRange(day);
    const q = `branchId=${branchId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    try {
      if (tab === 'receipts') setReceipts(await api.get<ReceiptRow[]>(`/receipts?${q}`));
      else setJobs(await api.get<JobRow[]>(`/printer-jobs/history?${q}&kind=${kind}`));
    } catch (e) {
      setFailed(errorText(e));
    }
  }, [branchId, day, tab, kind]);

  useEffect(() => {
    if (tab === 'receipts') setReceipts(null);
    else setJobs(null);
    setSelected(null);
    load();
  }, [load, tab]);

  // Load the picture of the selected ticket.
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!selected) return;
    const url = selected.type === 'receipt' ? `/receipts/${selected.row.id}/preview` : `/printer-jobs/${selected.row.id}/preview`;
    let alive = true;
    api
      .get<PrintPreview>(url)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setPreviewError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [selected]);

  const title = selected
    ? selected.type === 'receipt'
      ? `Receipt ${selected.row.receiptNumber}`
      : `${TICKET_LABEL[selected.row.ticketType] ?? selected.row.ticketType} · ${selected.row.table ?? ''}`
    : '';

  const download = async () => {
    const blob = await paper.current?.toBlob();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^\w-]+/g, '_') || 'ticket'}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  const printHere = () => {
    const url = paper.current?.toDataURL();
    if (!url || !preview) return;
    if (!printImage(url, title, preview.columns)) toast('Allow pop-ups for this site to print from this computer', 'error');
  };

  const reprint = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      if (selected.type === 'receipt') await api.post(`/receipts/${selected.row.id}/reprint`, { reason: reason.trim() });
      else await api.post(`/printer-jobs/${selected.row.id}/reprint`);
      toast('Sent to the printer, marked COPY', 'ok');
      setReprintOpen(false);
      setReason('');
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const matches = (...vals: (string | null)[]) => !q || vals.some((v) => v?.toLowerCase().includes(q));
  const shownReceipts = (receipts ?? []).filter((r) => matches(r.receiptNumber, r.orderNumber, r.table, r.waiterName, r.method));
  const shownJobs = (jobs ?? []).filter((j) => matches(j.receiptNumber, j.orderNumber, j.table, j.printerName, j.stationName));
  const rows = tab === 'receipts' ? receipts : jobs;
  const canReprint = selected?.type === 'receipt' ? can('receipt.reprint') : can('printer.reprint');

  const previewPanel = (
    <div className="flex flex-col gap-3">
      {!selected ? (
        <div className="grid min-h-[320px] place-items-center rounded-xl border border-dashed border-line bg-canvas p-8 text-center text-sm text-mute">
          <div>
            <Icon name="receipt" size={32} className="mx-auto mb-2" />
            Pick a bill to see exactly what the printer printed.
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={download} disabled={!preview}>
              Download image
            </Button>
            <Button size="sm" variant="outline" onClick={printHere} disabled={!preview}>
              <Icon name="printer" size={16} /> Print on this computer
            </Button>
            {canReprint && (
              <Button size="sm" onClick={() => (selected.type === 'receipt' ? setReprintOpen(true) : reprint())} disabled={!preview || busy} loading={busy && selected.type === 'job'}>
                Print again (copy)
              </Button>
            )}
          </div>
          {selected.type === 'job' && selected.row.errorMessage && (
            <p className="rounded-md bg-negative-bg px-3 py-2 text-sm text-negative">Printer said: {selected.row.errorMessage}</p>
          )}
          {/* The paper */}
          <div className="rounded-xl bg-canvas-sunk p-4 sm:p-6">
            {previewError ? (
              <p className="py-10 text-center text-sm text-negative">{previewError}</p>
            ) : !preview ? (
              <PageSpinner />
            ) : (
              <div className="mx-auto max-w-[400px] shadow-[0_2px_12px_rgba(0,0,0,0.12)]">
                <ReceiptCanvas ref={paper} preview={preview} />
              </div>
            )}
          </div>
          {preview && (
            <p className="text-center text-xs text-mute">
              {preview.columns >= 48 ? '80 mm' : '58 mm'} paper, {preview.columns} characters per line. Letters the printer can’t print show as “?”.
            </p>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="pb-10">
      <PageHeader title="Printed bills" sub="Every receipt and ticket, shown exactly as it comes out of the printer." />
      <div className="flex flex-col gap-4 px-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          {canLog ? (
            <Segmented
              value={tab}
              onChange={setTab}
              options={[
                { value: 'receipts', label: 'Receipts' },
                { value: 'log', label: 'Print log' },
              ]}
            />
          ) : null}
          {tab === 'log' && (
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: 'bills', label: 'Bills' },
                { value: 'kitchen', label: 'Kitchen' },
                { value: 'all', label: 'All' },
              ]}
            />
          )}
          <Input type="date" className="h-10 w-auto" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} aria-label="Day" />
          <Input className="h-10 min-w-0 flex-1 sm:max-w-xs" type="search" placeholder="Search receipt no., table, order…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
          {/* List */}
          <div className="min-w-0">
            {failed ? (
              <LoadFailed message={failed} onRetry={load} />
            ) : !rows ? (
              <PageSpinner />
            ) : (tab === 'receipts' ? shownReceipts.length : shownJobs.length) === 0 ? (
              <div className="rounded-xl border border-line bg-canvas px-4 py-12 text-center text-sm text-mute">
                {tab === 'receipts' ? 'No receipts on this day.' : 'Nothing was sent to a printer on this day.'}
              </div>
            ) : (
              <ul className="overflow-hidden rounded-xl border border-line bg-canvas">
                {tab === 'receipts'
                  ? shownReceipts.map((r) => {
                      const on = selected?.type === 'receipt' && selected.row.id === r.id;
                      return (
                        <li key={r.id} className="border-b border-line-soft last:border-0">
                          <button onClick={() => setSelected({ type: 'receipt', row: r })} className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm ${on ? 'bg-primary-pale' : 'hover:bg-canvas-soft'}`}>
                            <Icon name="receipt" size={18} className="shrink-0 text-mute" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">
                                {r.table ?? 'Takeaway'} · <span className="font-mono">{r.receiptNumber}</span>
                              </span>
                              <span className="block truncate text-xs text-mute">
                                {clock(r.createdAt)} · {r.method ?? '—'}
                                {r.waiterName ? ` · ${r.waiterName}` : ''}
                                {r.reprintCount ? ` · reprinted ${r.reprintCount}×` : ''}
                              </span>
                            </span>
                            <span className="font-semibold tnum">{r.paid ? money(r.paid) : r.total ? money(r.total) : ''}</span>
                          </button>
                        </li>
                      );
                    })
                  : shownJobs.map((j) => {
                      const on = selected?.type === 'job' && selected.row.id === j.id;
                      const st = JOB_STATUS[j.status] ?? { label: j.status, tone: 'neutral' as Tone };
                      return (
                        <li key={j.id} className="border-b border-line-soft last:border-0">
                          <button onClick={() => setSelected({ type: 'job', row: j })} className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm ${on ? 'bg-primary-pale' : 'hover:bg-canvas-soft'}`}>
                            <Icon name={j.ticketType === 'RECEIPT' || j.ticketType === 'BILL' ? 'receipt' : 'kitchen'} size={18} className="shrink-0 text-mute" />
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold">
                                {TICKET_LABEL[j.ticketType] ?? j.ticketType}
                                {j.table ? ` · ${j.table}` : ''}
                                {j.isReprint ? ' · copy' : ''}
                              </span>
                              <span className="block truncate text-xs text-mute">
                                {clock(j.createdAt)} · {j.printerName}
                                {j.orderNumber ? ` · #${j.orderNumber.split('-').pop()}` : ''}
                              </span>
                            </span>
                            <span className="flex shrink-0 flex-col items-end gap-1">
                              <Pill tone={st.tone}>{st.label}</Pill>
                              {j.total && <span className="text-xs font-semibold tnum">{money(j.total)}</span>}
                            </span>
                          </button>
                        </li>
                      );
                    })}
              </ul>
            )}
          </div>

          {/* Preview: beside the list on a PC, in a sheet on a phone */}
          <div className="hidden lg:block">
            <div className="sticky top-4">{previewPanel}</div>
          </div>
        </div>
      </div>

      <div className="lg:hidden">
        <Sheet open={!!selected} onClose={() => setSelected(null)} title={title} wide>
          {previewPanel}
        </Sheet>
      </div>

      <Sheet open={reprintOpen} onClose={() => setReprintOpen(false)} title="Print a copy">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-mute">The copy is marked “COPY” on the paper and recorded in the activity log.</p>
          <Input placeholder="Why? e.g. customer lost it, paper jam" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus />
          <Button size="lg" onClick={reprint} loading={busy} disabled={busy || reason.trim().length < 3}>
            Print copy
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
