'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { PageHeader, Panel } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';
import { PaymentMethodsPanel } from '@/components/payments/PaymentMethodsPanel';
import { BrandingPanel } from '@/components/admin/BrandingPanel';
import { DangerZone } from '@/components/admin/DangerZone';

interface Settings {
  cafeName: string;
  logoUrl: string | null;
  branchName: string;
  currency: string;
  taxRate: string;
  isTaxInclusive: boolean;
  serviceChargeRate: string;
  roundingMode: string;
  varianceTolerance: string;
  largeDiscountPercent: string;
  cashierRefundLimit: string;
  ticketWarnMinutes: number;
  ticketLateMinutes: number;
  tinNumber: string | null;
  receiptFooter: string | null;
  verifyBySecondPerson: boolean;
  waiterPayments: boolean;
  waiterPhotoRequired: boolean;
}

export default function SettingsPage() {
  const { branchId, can, refresh } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const editable = can('settings.manage');

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setFailed(null);
      setS(await api.get<Settings>(`/settings/branch?branchId=${branchId}`));
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);
  useEffect(() => {
    load();
  }, [load]);

  if (!s) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });

  const save = async () => {
    setBusy(true);
    try {
      // Only send editable fields (the API rejects unknown ones).
      const { currency: _c, branchId: _b, logoUrl: _l, ...body } = s as Settings & { branchId?: string };
      setS(await api.patch<Settings>(`/settings/branch?branchId=${branchId}`, { ...body, tinNumber: body.tinNumber || undefined, receiptFooter: body.receiptFooter || undefined }));
      toast('Saved. New orders use these settings; open bills keep theirs.');
      refresh();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const num = (v: string) => v.replace(/[^\d.]/g, '');

  return (
    <div className="pb-10">
      <PageHeader title="Settings" sub={editable ? 'Changes are logged.' : 'Only the owner/admin can change these.'} actions={editable && <Button onClick={save} loading={busy}>Save changes</Button>} />
      <div className="grid gap-5 px-4 pb-5 sm:px-8 lg:grid-cols-2">
        <BrandingPanel cafeName={s.cafeName} logoUrl={s.logoUrl} editable={editable} onName={(v) => set('cafeName', v)} onChanged={load} />
      </div>
      <fieldset disabled={!editable} className="grid gap-5 px-4 sm:px-8 lg:grid-cols-2">
        <Panel title="Bills">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cafe / branch name" htmlFor="st-name">
              <Input id="st-name" value={s.branchName} onChange={(e) => set('branchName', e.target.value)} />
            </Field>
            <Field label="TIN (printed on bills)" htmlFor="st-tin">
              <Input id="st-tin" value={s.tinNumber ?? ''} onChange={(e) => set('tinNumber', e.target.value)} />
            </Field>
            <Field label="VAT %" htmlFor="st-vat" hint="Ethiopian standard rate is 15%.">
              <Input id="st-vat" inputMode="decimal" value={s.taxRate} onChange={(e) => set('taxRate', num(e.target.value))} />
            </Field>
            <Field label="Menu prices include VAT?" htmlFor="st-incl">
              <Select id="st-incl" value={s.isTaxInclusive ? 'yes' : 'no'} onChange={(e) => set('isTaxInclusive', e.target.value === 'yes')}>
                <option value="no">No — VAT is added on the bill</option>
                <option value="yes">Yes — VAT is inside the price</option>
              </Select>
            </Field>
            <Field label="Service charge % (tables only)" htmlFor="st-svc">
              <Input id="st-svc" inputMode="decimal" value={s.serviceChargeRate} onChange={(e) => set('serviceChargeRate', num(e.target.value))} />
            </Field>
            <Field label="Rounding" htmlFor="st-round">
              <Select id="st-round" value={s.roundingMode} onChange={(e) => set('roundingMode', e.target.value)}>
                <option value="HALF_UP">Nearest santim (half up)</option>
                <option value="HALF_EVEN">Nearest santim (banker’s)</option>
                <option value="CEIL">Always up</option>
                <option value="FLOOR">Always down</option>
              </Select>
            </Field>
            <div className="sm:col-span-2">
              <Field label="Bottom line on bills" htmlFor="st-footer">
                <Input id="st-footer" value={s.receiptFooter ?? ''} onChange={(e) => set('receiptFooter', e.target.value)} placeholder="Thank you for visiting" />
              </Field>
            </div>
          </div>
        </Panel>
        <Panel title="Waiters & transfers">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Can waiters take transfers at the table?" htmlFor="st-wpay" hint="The waiter snaps the customer’s “payment successful” screen; the cashier checks it on the PC.">
              <Select id="st-wpay" value={s.waiterPayments ? 'yes' : 'no'} onChange={(e) => set('waiterPayments', e.target.value === 'yes')}>
                <option value="yes">Yes — from their phone, with a photo</option>
                <option value="no">No — all payments at the till</option>
              </Select>
            </Field>
            <Field label="Photo of the payment screen" htmlFor="st-wphoto">
              <Select id="st-wphoto" value={s.waiterPhotoRequired ? 'yes' : 'no'} onChange={(e) => set('waiterPhotoRequired', e.target.value === 'yes')} disabled={!s.waiterPayments}>
                <option value="yes">Required (recommended)</option>
                <option value="no">Optional</option>
              </Select>
            </Field>
          </div>
        </Panel>
        <Panel title="Controls">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Discounts above this % need a manager PIN" htmlFor="st-disc">
              <Input id="st-disc" inputMode="decimal" value={s.largeDiscountPercent} onChange={(e) => set('largeDiscountPercent', num(e.target.value))} />
            </Field>
            <Field label="Cashier can refund up to (ETB)" htmlFor="st-refund">
              <Input id="st-refund" inputMode="decimal" value={s.cashierRefundLimit} onChange={(e) => set('cashierRefundLimit', num(e.target.value))} />
            </Field>
            <Field label="Drawer difference allowed (ETB)" htmlFor="st-var" hint="Bigger differences need a manager to sign off.">
              <Input id="st-var" inputMode="decimal" value={s.varianceTolerance} onChange={(e) => set('varianceTolerance', num(e.target.value))} />
            </Field>
            <Field label="Who checks Telebirr / bank payments?" htmlFor="st-verify">
              <Select id="st-verify" value={s.verifyBySecondPerson ? 'second' : 'anyone'} onChange={(e) => set('verifyBySecondPerson', e.target.value === 'second')}>
                <option value="anyone">The cashier can confirm it themselves</option>
                <option value="second">Someone else must confirm it (stricter)</option>
              </Select>
            </Field>
            <Field label="Kitchen ticket turns amber after (min)" htmlFor="st-warn">
              <Input id="st-warn" inputMode="numeric" value={String(s.ticketWarnMinutes)} onChange={(e) => set('ticketWarnMinutes', parseInt(e.target.value, 10) || 1)} />
            </Field>
            <Field label="…and red after (min)" htmlFor="st-late">
              <Input id="st-late" inputMode="numeric" value={String(s.ticketLateMinutes)} onChange={(e) => set('ticketLateMinutes', parseInt(e.target.value, 10) || 1)} />
            </Field>
          </div>
        </Panel>
      </fieldset>
      <div className="mt-5 grid gap-5 px-4 sm:px-8 lg:grid-cols-2">
        <PaymentMethodsPanel branchId={branchId} editable={editable} />
        <DangerZone />
      </div>
    </div>
  );
}
