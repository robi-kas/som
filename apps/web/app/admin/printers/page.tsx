'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLive } from '@/lib/live';
import { clock } from '@/lib/format';
import { PageHeader, Panel } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { Sheet } from '@/components/ui/Sheet';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface Station {
  id: string;
  name: string;
}
interface PrinterRow {
  id: string;
  name: string;
  kind: 'KITCHEN' | 'RECEIPT';
  stationId: string | null;
  stationName: string | null;
  ipAddress: string | null;
  port: number;
  isActive: boolean;
  status: 'UNKNOWN' | 'ONLINE' | 'OFFLINE';
  lastSeenAt: string | null;
  lastError: string | null;
}
interface Agent {
  id: string;
  name: string;
  lastSeenAt: string | null;
  online: boolean;
}
interface ProblemJob {
  id: string;
  status: string;
  printerName: string;
  ticketType: string;
  orderNumber: string | null;
  table: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export default function PrintersPage() {
  const { branchId, can } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [data, setData] = useState<{ mode: string; printers: PrinterRow[]; agents: Agent[] } | null>(null);
  const [problems, setProblems] = useState<ProblemJob[]>([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', kind: 'KITCHEN' as 'KITCHEN' | 'RECEIPT', stationId: '', ipAddress: '', port: '9100' });
  const [stationName, setStationName] = useState('');
  const [agentKey, setAgentKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setFailed(null);
      const [s, p, j] = await Promise.all([
        api.get<Station[]>(`/kitchen/stations?branchId=${branchId}`),
        api.get<typeof data>(`/printers?branchId=${branchId}`),
        api.get<ProblemJob[]>(`/printer-jobs/problems?branchId=${branchId}`),
      ]);
      setStations(s);
      setData(p);
      setProblems(j);
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);
  useEffect(() => {
    load();
  }, [load]);
  useLive(branchId, ['printer.updated'], () => load(), 20_000);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  if (!data) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;
  const manage = can('printer.manage');

  return (
    <div className="pb-10">
      <PageHeader
        title="Kitchen & printers"
        sub={
          data.mode === 'agent'
            ? 'Printing goes through the print agent running inside the cafe (apps/print-agent).'
            : 'Direct mode: the server prints straight to the printers’ IP addresses.'
        }
      />
      <div className="flex flex-col gap-5 px-4 sm:px-8">
        {problems.length > 0 && (
          <Panel title={`Tickets that didn’t print · ${problems.length}`}>
            <ul className="flex flex-col divide-y divide-line-soft">
              {problems.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <Pill tone={j.status.startsWith('FAILED') ? 'bad' : 'warn'}>{j.status.startsWith('FAILED') ? 'Failed' : 'Stuck'}</Pill>
                  <span className="font-semibold">
                    {j.table ?? j.ticketType} {j.orderNumber ? `#${j.orderNumber}` : ''}
                  </span>
                  <span className="text-mute">
                    {j.printerName} · {clock(j.createdAt)}
                  </span>
                  {j.errorMessage && <span className="text-xs text-negative">{j.errorMessage}</span>}
                  {can('printer.retry') && (
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => run(() => api.post(`/printer-jobs/${j.id}/retry`), 'Sent again')}>
                      Print again
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="grid gap-5 lg:grid-cols-[1fr_2fr]">
          <Panel title="Stations">
            <p className="mb-3 text-sm text-mute">Each menu item is made at one station. Its tickets go to that station’s screen and printer.</p>
            <ul className="mb-3 flex flex-col gap-1.5">
              {stations.map((s) => (
                <li key={s.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 font-semibold">
                  {s.name}
                  {can('kitchen_station.deactivate') && (
                    <button className="text-xs font-semibold text-mute hover:text-negative" onClick={() => run(() => api.post(`/kitchen-stations/${s.id}/deactivate`), `${s.name} removed`)}>
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            {can('kitchen_station.create') && (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() => api.post('/kitchen-stations', { branchId, name: stationName.trim() }), 'Station added').then(() => setStationName(''));
                }}
              >
                <Input id="st-name" className="h-10" placeholder="e.g. Coffee bar" value={stationName} onChange={(e) => setStationName(e.target.value)} />
                <Button size="sm" className="h-10" type="submit" disabled={!stationName.trim()}>
                  Add
                </Button>
              </form>
            )}
          </Panel>

          <Panel title="Printers" actions={manage && <Button size="sm" onClick={() => setAdding(true)}>Add printer</Button>}>
            {data.printers.length === 0 ? (
              <p className="text-sm text-mute">No printers yet. Add the kitchen, bar and receipt printers by their IP address (shown on the printer’s self-test slip).</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line-soft">
                {data.printers.map((p) => (
                  <li key={p.id} className={`flex flex-wrap items-center gap-3 py-3 ${p.isActive ? '' : 'opacity-50'}`}>
                    <Pill tone={p.status === 'ONLINE' ? 'good' : p.status === 'OFFLINE' ? 'bad' : 'neutral'}>
                      {p.status === 'ONLINE' ? 'Online' : p.status === 'OFFLINE' ? 'Offline' : 'Not seen yet'}
                    </Pill>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{p.name}</p>
                      <p className="text-xs text-mute">
                        {p.kind === 'RECEIPT' ? 'Receipts' : `Tickets for ${p.stationName}`} · {p.ipAddress}:{p.port}
                        {p.lastError && <span className="text-negative"> · {p.lastError}</span>}
                      </p>
                    </div>
                    {manage && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => run(() => api.post(`/printers/${p.id}/test`), 'Test page sent')}>
                          Test
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => run(() => api.patch(`/printers/${p.id}`, { isActive: !p.isActive }), p.isActive ? 'Printer paused' : 'Printer on')}>
                          {p.isActive ? 'Pause' : 'Turn on'}
                        </Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {data.mode === 'agent' && (
          <Panel
            title="Print agent"
            actions={
              manage && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const res = await api.post<{ agentKey: string }>('/printers/agents', { branchId, name: `Agent ${new Date().toLocaleDateString('en-GB')}` });
                      setAgentKey(res.agentKey);
                      load();
                    } catch (e) {
                      toast(errorText(e), 'error');
                    }
                  }}
                >
                  New agent key
                </Button>
              )
            }
          >
            <p className="mb-3 text-sm text-mute">
              A small program on a PC or Raspberry Pi in the cafe collects tickets and sends them to the printers over the local network. Printing keeps working through short internet drops.
            </p>
            <ul className="flex flex-col gap-1.5">
              {data.agents.map((a) => (
                <li key={a.id} className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm">
                  <span className="flex items-center gap-2">
                    <Pill tone={a.online ? 'good' : 'bad'}>{a.online ? 'Connected' : 'Not connected'}</Pill>
                    {a.name}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-mute">
                    {a.lastSeenAt ? `last seen ${clock(a.lastSeenAt)}` : 'never connected'}
                    {manage && (
                      <button className="font-semibold hover:text-negative" onClick={() => run(() => api.post(`/printers/agents/${a.id}/revoke`), 'Key revoked')}>
                        Revoke
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {data.agents.length === 0 && <li className="text-sm text-mute">No agent yet — create a key and follow apps/print-agent/README.md.</li>}
            </ul>
          </Panel>
        )}
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add printer"
        footer={
          <Button
            size="lg"
            block
            className="mb-1"
            disabled={!form.name || !/^\d{1,3}(\.\d{1,3}){3}$/.test(form.ipAddress) || (form.kind === 'KITCHEN' && !form.stationId)}
            onClick={() =>
              run(
                () => api.post('/printers', { branchId, name: form.name, kind: form.kind, stationId: form.kind === 'KITCHEN' ? form.stationId : undefined, ipAddress: form.ipAddress, port: parseInt(form.port, 10) || 9100 }),
                'Printer added',
              ).then(() => setAdding(false))
            }
          >
            Add printer
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="pr-name">
            <Input id="pr-name" placeholder="Kitchen printer" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Prints" htmlFor="pr-kind">
            <Select id="pr-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'KITCHEN' | 'RECEIPT' })}>
              <option value="KITCHEN">Kitchen / bar tickets</option>
              <option value="RECEIPT">Customer bills & receipts</option>
            </Select>
          </Field>
          {form.kind === 'KITCHEN' && (
            <Field label="Station" htmlFor="pr-station">
              <Select id="pr-station" value={form.stationId} onChange={(e) => setForm({ ...form, stationId: e.target.value })}>
                <option value="">Choose…</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label="IP address" htmlFor="pr-ip" hint="Give the printer a fixed IP in your router.">
            <Input id="pr-ip" inputMode="decimal" placeholder="192.168.1.50" value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} />
          </Field>
          <Field label="Port" htmlFor="pr-port">
            <Input id="pr-port" inputMode="numeric" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value.replace(/\D/g, '') })} />
          </Field>
        </div>
      </Sheet>

      <Sheet open={!!agentKey} onClose={() => setAgentKey(null)} title="Agent key — copy it now">
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-sm text-body">This key is shown once. Put it in the print agent’s .env file as AGENT_KEY. Anyone with it can print to your printers, so keep it private.</p>
          <code className="break-all rounded-lg bg-ink p-4 font-mono text-sm text-primary">{agentKey}</code>
          <Button
            size="lg"
            onClick={() => {
              navigator.clipboard?.writeText(agentKey ?? '').then(
                () => toast('Copied'),
                () => toast('Select and copy it manually', 'info'),
              );
            }}
          >
            Copy
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
