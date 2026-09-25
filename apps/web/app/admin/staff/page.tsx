'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { dateLabel } from '@/lib/format';
import { PageHeader } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, PasswordInput } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface StaffRow {
  id: string;
  username: string;
  displayName: string;
  roleName: string | null;
  branchId: string | null;
  isActive: boolean;
  hasPin: boolean;
  stations: { id: string; name: string }[];
  createdAt: string;
}
interface Station {
  id: string;
  name: string;
}

const ROLES = [
  { value: 'Waiter', help: 'Takes orders at tables, serves, asks for the bill' },
  { value: 'Counter', help: 'Takes the order and the money at one till (takeaway coffee)' },
  { value: 'Cashier', help: 'Takes payments, runs a cash drawer, small refunds' },
  { value: 'Barista', help: 'Coffee & tea screen; marks drinks out of stock', station: true },
  { value: 'Juice bar', help: 'Juice & cold drinks screen', station: true },
  { value: 'Chef', help: 'Kitchen screen; marks food out of stock', station: true },
  { value: 'Supervisor', help: 'Runs a shift: approves voids & discounts with a PIN; no money reports' },
  { value: 'Manager', help: 'Everything in the branch: reports, menu, staff, approvals' },
  { value: 'Admin', help: 'Everything, all branches' },
];
const STATION_DEFAULT: Record<string, string> = { Barista: 'Coffee', 'Juice bar': 'Juice', Chef: 'Kitchen' };

function tempPassword() {
  const words = ['buna', 'injera', 'shai', 'macchiato', 'jebena', 'sini', 'habesha', 'tej'];
  const pick = () => words[Math.floor(Math.random() * words.length)];
  return `${pick()}-${pick()}-${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function StaffPage() {
  const { branchId, me } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', username: '', password: '', roleName: 'Waiter', stationIds: [] as string[] });
  const [stations, setStations] = useState<Station[]>([]);
  const [editStations, setEditStations] = useState<StaffRow | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [created, setCreated] = useState<{ username: string; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setFailed(null);
      setStaff(await api.get<StaffRow[]>('/staff'));
      if (branchId) setStations(await api.get<Station[]>(`/kitchen/stations?branchId=${branchId}`));
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    }
  }, [toast, branchId]);
  useEffect(() => {
    load();
  }, [load]);

  const openAdd = () => {
    setForm({ firstName: '', lastName: '', username: '', password: tempPassword(), roleName: 'Waiter', stationIds: [] });
    setAdding(true);
  };

  const create = async () => {
    setBusy(true);
    try {
      await api.post('/staff', { ...form, username: form.username.trim().toLowerCase(), branchId });
      setCreated({ username: form.username.trim().toLowerCase(), password: form.password });
      setAdding(false);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const resetPassword = async (s: StaffRow) => {
    const pw = tempPassword();
    try {
      await api.post(`/users/${s.id}/reset-password`, { newPassword: pw });
      setCreated({ username: s.username, password: pw });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  if (!staff) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;

  return (
    <div className="pb-10">
      <PageHeader title="Staff" sub="Each person has their own login. New people choose their own password on first sign-in." actions={<Button onClick={openAdd}>Add person</Button>} />
      <div className="px-4 sm:px-8">
        <div className="overflow-x-auto rounded-xl border border-line bg-canvas">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-mute">
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Username</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Since</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id} className={`border-b border-line-soft last:border-0 ${s.isActive ? '' : 'opacity-50'}`}>
                  <td className="px-4 py-3 font-semibold">
                    {s.displayName} {!s.isActive && <Pill className="ml-1">Disabled</Pill>}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{s.username}</td>
                  <td className="px-4 py-3">
                    {s.roleName} {s.hasPin && <span className="text-xs text-mute">· PIN set</span>}
                    {s.stations.length > 0 && <span className="block text-xs text-mute">at {s.stations.map((x) => x.name).join(', ')}</span>}
                  </td>
                  <td className="px-4 py-3 text-mute">{dateLabel(s.createdAt)}</td>
                  <td className="px-4 py-3 text-right">
                    {s.id !== me?.user.id && (
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setPicked(s.stations.map((x) => x.id));
                            setEditStations(s);
                          }}
                        >
                          Stations
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => resetPassword(s)}>
                          Reset password
                        </Button>
                        {s.isActive ? (
                          <Button variant="ghost" size="sm" className="text-negative" onClick={() => run(() => api.patch(`/staff/${s.id}/deactivate`), `${s.displayName} can no longer sign in`)}>
                            Disable
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => run(() => api.patch(`/staff/${s.id}/reactivate`), `${s.displayName} enabled`)}>
                            Enable
                          </Button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add person"
        footer={
          <Button size="lg" block className="mb-1" loading={busy} onClick={create} disabled={!form.firstName || !/^[a-z0-9._-]{3,40}$/.test(form.username.trim().toLowerCase()) || form.password.length < 6}>
            Create login
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="s-first">
            <Input id="s-first" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          </Field>
          <Field label="Last name" htmlFor="s-last">
            <Input id="s-last" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          </Field>
          <Field label="Username" htmlFor="s-user" hint="Lowercase, no spaces. e.g. hana.t">
            <Input id="s-user" autoCapitalize="none" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Temporary password" htmlFor="s-pw" hint="They must change it when they first sign in.">
            <PasswordInput id="s-pw" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Role" htmlFor="s-role">
              <Select
                id="s-role"
                value={form.roleName}
                onChange={(e) => {
                  const roleName = e.target.value;
                  const def = stations.find((x) => x.name === STATION_DEFAULT[roleName]);
                  setForm({ ...form, roleName, stationIds: def ? [def.id] : [] });
                }}
              >
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.value} — {r.help}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="mt-2 text-xs text-mute">You can only give a role whose permissions you have yourself.</p>
          </div>
          {ROLES.find((r) => r.value === form.roleName)?.station && (
            <div className="sm:col-span-2">
              <p className="mb-2 text-sm font-semibold">Works at</p>
              <StationPicker stations={stations} value={form.stationIds} onChange={(ids) => setForm({ ...form, stationIds: ids })} />
            </div>
          )}
        </div>
      </Sheet>

      <Sheet
        open={!!editStations}
        onClose={() => setEditStations(null)}
        title={`${editStations?.displayName ?? ''} works at`}
        footer={
          <Button
            size="lg"
            block
            className="mb-1"
            onClick={() =>
              editStations &&
              run(() => api.patch(`/staff/${editStations.id}/stations`, { stationIds: picked }), 'Stations saved').then(() => setEditStations(null))
            }
          >
            Save
          </Button>
        }
      >
        <p className="mb-3 text-sm text-mute">Their kitchen screen shows only these stations’ tickets.</p>
        <StationPicker stations={stations} value={picked} onChange={setPicked} />
      </Sheet>

      <Sheet open={!!created} onClose={() => setCreated(null)} title="Hand this over">
        <div className="flex flex-col gap-3 pb-2">
          <p className="text-sm text-body">Give these to the person privately. The password is shown only once and must be changed at first sign-in.</p>
          <div className="rounded-lg bg-ink p-4 font-mono text-white">
            <p>
              <span className="text-[#b9bdb4]">username</span> {created?.username}
            </p>
            <p>
              <span className="text-[#b9bdb4]">password</span> {created?.password}
            </p>
          </div>
          <Button size="lg" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function StationPicker({ stations, value, onChange }: { stations: Station[]; value: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {stations.map((st) => {
        const on = value.includes(st.id);
        return (
          <button
            key={st.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== st.id) : [...value, st.id])}
            className={`h-11 rounded-full border-2 px-4 text-sm font-semibold ${on ? 'border-ink bg-ink text-white' : 'border-line hover:border-body'}`}
          >
            {st.name}
          </button>
        );
      })}
      {stations.length === 0 && <p className="text-sm text-mute">No stations yet — add them in Kitchen &amp; printers.</p>}
    </div>
  );
}
