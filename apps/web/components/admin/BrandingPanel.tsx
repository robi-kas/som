'use client';

import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Panel } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';

/** Cafe name + logo: shown on every screen and the sign-in page, printed on every bill. */
export function BrandingPanel({ cafeName, logoUrl, editable, onName, onChanged }: { cafeName: string; logoUrl: string | null; editable: boolean; onName: (v: string) => void; onChanged: () => void }) {
  const toast = useToast();
  const { refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [printable, setPrintable] = useState<boolean | null>(logoUrl ? logoUrl.toLowerCase().includes('.png') : null);

  const upload = async (file: File) => {
    setBusy(true);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await api.upload<{ logoUrl: string; printable: boolean }>('/settings/logo', form);
      setPrintable(res.printable);
      toast(res.printable ? 'Logo saved — it will print on bills' : 'Logo saved. Upload a PNG to also print it on bills.');
      await refresh();
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    try {
      await api.delete('/settings/logo');
      toast('Logo removed');
      setPrintable(null);
      await refresh();
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  return (
    <Panel title="Cafe name & logo" className="lg:col-span-2">
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="flex flex-col gap-4">
          <Field label="Cafe name" htmlFor="st-cafe" hint="Shown on every screen and the sign-in page, and printed at the top of bills.">
            <Input id="st-cafe" value={cafeName} onChange={(e) => onName(e.target.value)} maxLength={80} disabled={!editable} />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Logo</span>
            <div className="flex flex-wrap items-center gap-3">
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Cafe logo" className="h-20 w-20 rounded-lg border border-line bg-white object-contain p-1" />
              ) : (
                <span className="grid h-20 w-20 place-items-center rounded-lg border border-dashed border-line text-xs text-mute">No logo</span>
              )}
              {editable && (
                <div className="flex flex-col gap-2">
                  <label className={`inline-flex h-11 cursor-pointer items-center gap-2 rounded-md bg-ink px-4 text-sm font-semibold text-white hover:bg-ink-soft ${busy ? 'opacity-50' : ''}`}>
                    <Icon name="camera" size={18} /> {logoUrl ? 'Replace logo' : 'Upload logo'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                  </label>
                  {logoUrl && (
                    <Button variant="ghost" size="sm" onClick={remove}>
                      Remove logo
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-mute">
              PNG, square, up to 2 MB. For printing, a simple black logo on a white or transparent background works best — thermal printers only print black dots.
              {printable === false && <span className="block font-semibold text-warning-deep">This logo is not a PNG, so it shows on screens but won’t print on bills.</span>}
            </p>
          </div>
        </div>

        {/* What the top of a printed bill will look like. */}
        <div className="rounded-lg bg-canvas-soft p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-mute">On the printed bill</p>
          <div className="mx-auto flex w-full max-w-[220px] flex-col items-center gap-1 bg-white px-3 py-4 font-mono text-[11px] text-ink shadow-card">
            {logoUrl && printable !== false && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="mb-1 h-14 w-14 object-contain grayscale contrast-200" />
            )}
            <span className="text-center text-sm font-bold">{cafeName || 'Your cafe'}</span>
            <span>Receipt R260926-0001</span>
            <span className="w-full border-t border-dashed border-ink/40" />
            <span className="self-stretch">2 x Macchiato ....... 110.00</span>
            <span className="self-stretch">1 x Buna ............. 40.00</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}
