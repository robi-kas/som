'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import type { MethodKind, PaymentMethodConfig } from '@/lib/types';
import { Panel } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { Sheet } from '@/components/ui/Sheet';
import { useToast } from '@/components/ui/Toast';
import { MethodLogo } from './MethodLogo';

const KIND_LABEL: Record<MethodKind, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  MOBILE_MONEY: 'Mobile money wallet',
  BANK_APP: 'Bank app / transfer',
  OTHER: 'Other',
};

/** Settings → Payment methods: what the till offers, and the rules for each. */
export function PaymentMethodsPanel({ branchId, editable }: { branchId: string; editable: boolean }) {
  const toast = useToast();
  const [methods, setMethods] = useState<PaymentMethodConfig[] | null>(null);
  const [editing, setEditing] = useState<PaymentMethodConfig | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', kind: 'BANK_APP' as MethodKind, accountInfo: '' });

  const load = useCallback(async () => {
    try {
      setMethods(await api.get<PaymentMethodConfig[]>(`/payment-methods?branchId=${branchId}&all=true`));
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);
  useEffect(() => {
    if (branchId) load();
  }, [branchId, load]);

  const patch = async (m: PaymentMethodConfig, body: Partial<PaymentMethodConfig>, ok?: string) => {
    setMethods((xs) => xs?.map((x) => (x.id === m.id ? { ...x, ...body } : x)) ?? null);
    try {
      await api.patch(`/payment-methods/${m.id}`, body);
      if (ok) toast(ok);
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    }
  };

  const add = async () => {
    try {
      await api.post('/payment-methods', { branchId, name: draft.name.trim(), kind: draft.kind, accountInfo: draft.accountInfo.trim() || undefined });
      toast(`${draft.name} added`);
      setAdding(false);
      setDraft({ name: '', kind: 'BANK_APP', accountInfo: '' });
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  if (!methods) return null;
  const on = methods.filter((m) => m.isActive);
  const off = methods.filter((m) => !m.isActive);

  const row = (m: PaymentMethodConfig) => (
    <li key={m.id} className={`flex flex-wrap items-center gap-3 py-3 ${m.isActive ? '' : 'opacity-60'}`}>
      <MethodLogo code={m.code} name={m.name} size={40} />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{m.name}</p>
        <p className="text-xs text-mute">
          {[
            KIND_LABEL[m.kind],
            m.accountInfo ? `pay to ${m.accountInfo}` : m.kind !== 'CASH' && m.kind !== 'CARD' ? 'no account number set' : null,
            m.requiresProof ? 'screenshot required' : null,
            m.requiresVerification ? 'manager checks' : m.kind !== 'CASH' ? 'counts as paid immediately' : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      {editable && (
        <div className="flex items-center gap-1">
          {m.kind !== 'CASH' && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
              Edit
            </Button>
          )}
          {m.code !== 'CASH' && (
            <button
              role="switch"
              aria-checked={m.isActive}
              aria-label={`Accept ${m.name}`}
              onClick={() => patch(m, { isActive: !m.isActive }, m.isActive ? `${m.name} switched off` : `${m.name} is on the till`)}
              className={`relative h-7 w-12 rounded-full transition-colors ${m.isActive ? 'bg-positive' : 'bg-line'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${m.isActive ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <Panel
      title="Payment methods"
      className="lg:col-span-2"
      actions={editable && <Button size="sm" onClick={() => setAdding(true)}>Add bank or app</Button>}
    >
      <p className="mb-2 text-sm text-mute">
        What the cashier sees on the till. Add your merchant / account number and it’s printed on every bill and shown to the customer at payment.
      </p>
      <ul className="divide-y divide-line-soft">{on.map(row)}</ul>
      {off.length > 0 && (
        <>
          <p className="mb-1 mt-5 text-xs font-bold uppercase tracking-wider text-mute">Switched off</p>
          <ul className="divide-y divide-line-soft">{off.map(row)}</ul>
        </>
      )}
      <p className="mt-4 text-xs text-mute">Bank and wallet logos: ethiopianlogos.com by Chapa (MIT). Logos belong to their owners.</p>

      <Sheet
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.name}
        footer={
          <Button
            size="lg"
            block
            className="mb-1"
            onClick={async () => {
              if (!editing) return;
              await patch(
                editing,
                {
                  name: editing.name,
                  accountInfo: editing.accountInfo ?? '',
                  requiresReference: editing.requiresReference,
                  requiresProof: editing.requiresProof,
                  requiresVerification: editing.requiresVerification,
                  askPayerBank: editing.askPayerBank,
                },
                'Saved',
              );
              setEditing(null);
            }}
          >
            Save
          </Button>
        }
      >
        {editing && (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <MethodLogo code={editing.code} name={editing.name} size={48} />
              <Field label="Name on the till and receipts" htmlFor="pm-name">
                <Input id="pm-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </Field>
            </div>
            {editing.kind !== 'CARD' && (
              <Field label="Your merchant / account number" htmlFor="pm-acc" hint="e.g. Telebirr merchant 123456, or CBE 1000123456789 (New Chapter Cafe)">
                <Input id="pm-acc" value={editing.accountInfo ?? ''} onChange={(e) => setEditing({ ...editing, accountInfo: e.target.value })} maxLength={120} />
              </Field>
            )}
            <Toggle label="Transaction number required" help="From the customer's SMS or app confirmation." value={editing.requiresReference} onChange={(v) => setEditing({ ...editing, requiresReference: v })} />
            <Toggle label="Screenshot required" help="Cashier must photograph or upload the customer's confirmation screen." value={editing.requiresProof} onChange={(v) => setEditing({ ...editing, requiresProof: v })} />
            <Toggle
              label="A manager checks the statement"
              help="Stays 'pending' until someone other than the cashier verifies it. Turn off only for methods that confirm instantly (e.g. card machine)."
              value={editing.requiresVerification}
              onChange={(v) => setEditing({ ...editing, requiresVerification: v })}
            />
            <Toggle label="Ask which bank" help="For a catch-all like 'Other bank / app'." value={editing.askPayerBank} onChange={(v) => setEditing({ ...editing, askPayerBank: v })} />
          </div>
        )}
      </Sheet>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a bank or app"
        footer={
          <Button size="lg" block className="mb-1" disabled={draft.name.trim().length < 2} onClick={add}>
            Add
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <MethodLogo code="" name={draft.name || '?'} size={48} />
            <Field label="Name" htmlFor="pm-new-name" hint="e.g. Wegagen Bank, Nib Bank, Siinqee Bank, Abay Bank">
              <Input id="pm-new-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={40} />
            </Field>
          </div>
          <Field label="Type" htmlFor="pm-new-kind">
            <Select id="pm-new-kind" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as MethodKind })}>
              <option value="BANK_APP">Bank app / transfer (screenshot + manager check)</option>
              <option value="MOBILE_MONEY">Mobile money wallet (manager check)</option>
              <option value="CARD">Card machine (paid immediately)</option>
              <option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Your account number (optional)" htmlFor="pm-new-acc">
            <Input id="pm-new-acc" value={draft.accountInfo} onChange={(e) => setDraft({ ...draft, accountInfo: e.target.value })} maxLength={120} />
          </Field>
        </div>
      </Sheet>
    </Panel>
  );
}

function Toggle({ label, help, value, onChange }: { label: string; help: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-1 h-5 w-5 accent-[#1f4a05]" checked={value} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-mute">{help}</span>
      </span>
    </label>
  );
}
