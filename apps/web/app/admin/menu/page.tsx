'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, errorText } from '@/lib/api';
import { useSession } from '@/lib/session';
import { money } from '@/lib/format';
import type { Category, Product } from '@/lib/types';
import { PageHeader } from '@/components/admin/AdminShell';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Sheet } from '@/components/ui/Sheet';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { Pill } from '@/components/ui/Pill';
import { Icon } from '@/components/ui/Icon';
import { PageSpinner, LoadFailed } from '@/components/ui/Spinner';
import { useToast } from '@/components/ui/Toast';

interface Station {
  id: string;
  name: string;
}
interface AdminModifier {
  id: string;
  name: string;
  priceDelta: string;
  isActive: boolean;
  displayOrder: number;
}

export default function MenuAdminPage() {
  const { branchId, can } = useSession();
  const toast = useToast();
  const [failed, setFailed] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [stations, setStations] = useState<Station[]>([]);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [catOpen, setCatOpen] = useState(false);

  const load = useCallback(async () => {
    if (!branchId) return;
    try {
      setFailed(null);
      const [p, c, s] = await Promise.all([
        api.get<Product[]>(`/products?branchId=${branchId}&includeInactive=true`),
        api.get<Category[]>(`/categories?branchId=${branchId}`),
        api.get<Station[]>(`/kitchen/stations?branchId=${branchId}`),
      ]);
      setProducts(p);
      setCategories(c);
      setStations(s);
    } catch (e) {
      setFailed(errorText(e));
      toast(errorText(e), 'error');
    }
  }, [branchId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (products ?? []).filter((p) => {
      const removed = !p.isActive || p.status === 'INACTIVE';
      if (cat === 'removed') return removed && (!needle || p.name.toLowerCase().includes(needle));
      return !removed && (cat === 'all' || p.categoryId === cat) && (!needle || p.name.toLowerCase().includes(needle));
    });
  }, [products, cat, q]);
  const removedCount = (products ?? []).filter((p) => !p.isActive || p.status === 'INACTIVE').length;

  const restore = async (p: Product) => {
    try {
      await api.post(`/products/${p.id}/restore`);
      toast(`${p.name} is back on the menu`);
      load();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const toggleStock = async (p: Product) => {
    const next = p.status === 'AVAILABLE' ? 'OUT_OF_STOCK' : 'AVAILABLE';
    setProducts((xs) => xs?.map((x) => (x.id === p.id ? { ...x, status: next } : x)) ?? null);
    try {
      await api.post(`/products/${p.id}/set-status`, { status: next });
      toast(next === 'OUT_OF_STOCK' ? `${p.name} marked out of stock` : `${p.name} is back`);
    } catch (e) {
      toast(errorText(e), 'error');
      load();
    }
  };

  if (!products) return failed ? <LoadFailed message={failed} onRetry={() => load()} /> : <PageSpinner />;

  return (
    <div className="pb-10">
      <PageHeader
        title="Menu"
        sub="Out-of-stock changes reach every waiter’s phone immediately."
        actions={
          <>
            {can('category.create') && (
              <Button variant="outline" onClick={() => setCatOpen(true)}>
                Categories
              </Button>
            )}
            {can('product.create') && (
              <Button onClick={() => setEditing('new')}>
                <Icon name="plus" size={18} /> New item
              </Button>
            )}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented value={cat} onChange={setCat} options={[
              { value: 'all', label: 'All' },
              ...categories.filter((c) => c.isActive).map((c) => ({ value: c.id, label: c.name })),
              ...(removedCount ? [{ value: 'removed', label: 'Removed', badge: removedCount }] : []),
            ]} />
          <Input id="menu-q" placeholder="Search" className="h-10 max-w-[14rem]" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="overflow-x-auto rounded-xl border border-line bg-canvas">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-mute">
                <th className="px-4 py-3 font-semibold">Item</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 text-right font-semibold">Price</th>
                <th className="px-4 py-3 font-semibold">Add-ons</th>
                <th className="px-4 py-3 font-semibold">In stock</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const inactive = !p.isActive || p.status === 'INACTIVE';
                return (
                  <tr key={p.id} className={`border-b border-line-soft last:border-0 ${inactive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        {p.imageReference ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageReference} alt="" className="h-10 w-10 rounded-md object-cover" />
                        ) : (
                          <span className="grid h-10 w-10 place-items-center rounded-md bg-canvas-sunk text-xs font-bold text-mute">{p.name.slice(0, 2)}</span>
                        )}
                        <div>
                          <p className="font-semibold">{p.name}</p>
                          {!p.preparationStationId && <p className="text-xs text-mute">No station · handed over by the waiter</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-body">{p.category?.name}</td>
                    <td className="px-4 py-3 text-right font-semibold tnum">{money(p.sellingPrice)}</td>
                    <td className="px-4 py-3 text-body">{p.modifiers.length || '—'}</td>
                    <td className="px-4 py-3">
                      {inactive ? (
                        <span className="flex items-center gap-2">
                          <Pill>Not on menu</Pill>
                          {can('product.update') && (
                            <Button variant="outline" size="sm" onClick={() => restore(p)}>
                              Bring back
                            </Button>
                          )}
                        </span>
                      ) : (
                        <button
                          role="switch"
                          aria-checked={p.status === 'AVAILABLE'}
                          aria-label={`${p.name} in stock`}
                          onClick={() => toggleStock(p)}
                          disabled={!can('product.status_update')}
                          className={`inline-flex h-8 items-center gap-2 rounded-full px-1 pr-3 text-xs font-bold ${p.status === 'AVAILABLE' ? 'bg-positive-bg text-positive' : 'bg-negative-bg text-negative'}`}
                        >
                          <span className={`h-6 w-6 rounded-full ${p.status === 'AVAILABLE' ? 'bg-positive' : 'bg-negative'}`} />
                          {p.status === 'AVAILABLE' ? 'Yes' : 'Out'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
                        Edit
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {shown.length === 0 && <p className="py-10 text-center text-sm text-mute">No items.</p>}
        </div>
      </div>

      {editing && (
        <ProductEditor
          product={editing === 'new' ? null : editing}
          categories={categories.filter((c) => c.isActive)}
          stations={stations}
          branchId={branchId}
          onClose={() => setEditing(null)}
          onSaved={() => {
            load();
          }}
        />
      )}
      <CategorySheet open={catOpen} onClose={() => setCatOpen(false)} categories={categories} branchId={branchId} onChanged={load} />
    </div>
  );
}

function ProductEditor({
  product,
  categories,
  stations,
  branchId,
  onClose,
  onSaved,
}: {
  product: Product | null;
  categories: Category[];
  stations: Station[];
  branchId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(product?.name ?? '');
  const [description, setDescription] = useState(product?.description ?? '');
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? '');
  const [stationId, setStationId] = useState(product ? (product.preparationStationId ?? '') : (stations[0]?.id ?? ''));
  const [price, setPrice] = useState(product?.sellingPrice ?? '');
  const [priceReason, setPriceReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [mods, setMods] = useState<AdminModifier[]>([]);
  const [newMod, setNewMod] = useState({ name: '', priceDelta: '0' });

  const loadMods = useCallback(async () => {
    if (!product) return;
    try {
      setMods(await api.get<AdminModifier[]>(`/products/${product.id}/modifiers`));
    } catch {
      /* ignore */
    }
  }, [product]);
  useEffect(() => {
    loadMods();
  }, [loadMods]);

  const priceChanged = product && price !== product.sellingPrice && Number(price) !== Number(product.sellingPrice);

  const save = async () => {
    setBusy(true);
    try {
      if (!product) {
        await api.post('/products', { branchId, name, description: description || undefined, categoryId, preparationStationId: stationId || undefined, price });
        toast(`${name} added`);
      } else {
        await api.patch(`/products/${product.id}`, { name, description, categoryId, preparationStationId: stationId });
        if (priceChanged) await api.post(`/products/${product.id}/change-price`, { newPrice: price, reason: priceReason });
        toast('Saved');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File) => {
    if (!product) return;
    const form = new FormData();
    form.append('file', file);
    try {
      await api.upload(`/products/${product.id}/image`, form);
      toast('Photo updated');
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const addMod = async () => {
    if (!product || !newMod.name.trim()) return;
    try {
      await api.post(`/products/${product.id}/modifiers`, { name: newMod.name.trim(), priceDelta: newMod.priceDelta || '0' });
      setNewMod({ name: '', priceDelta: '0' });
      loadMods();
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const toggleMod = async (m: AdminModifier) => {
    if (!product) return;
    try {
      await api.patch(`/products/${product.id}/modifiers/${m.id}`, { isActive: !m.isActive });
      loadMods();
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const [confirmRemove, setConfirmRemove] = useState(false);
  const retire = async () => {
    if (!product) return;
    if (!confirmRemove) return setConfirmRemove(true);
    try {
      const res = await api.post<{ removed: 'deleted' | 'hidden' }>(`/products/${product.id}/remove`);
      toast(res.removed === 'deleted' ? `${product.name} deleted` : `${product.name} removed from the menu (kept on old bills — “Removed” tab to bring it back)`);
      onSaved();
      onClose();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };

  const valid = name.trim() && categoryId && /^\d+(\.\d{1,2})?$/.test(price) && (!priceChanged || priceReason.trim().length >= 3);

  return (
    <Sheet
      open
      onClose={onClose}
      wide
      title={product ? product.name : 'New item'}
      footer={
        <div className="flex gap-2 pb-1">
          {product && product.isActive && (
            <Button variant="ghost" onClick={retire} className="text-negative">
              {confirmRemove ? 'Tap again to remove' : 'Remove from menu'}
            </Button>
          )}
          <Button size="lg" className="ml-auto" onClick={save} loading={busy} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="p-name">
          <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </Field>
        <Field label="Price (ETB)" htmlFor="p-price" hint={product ? 'Changing the price is logged. Open bills keep the old price.' : undefined}>
          <Input id="p-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ''))} />
        </Field>
        {priceChanged && (
          <div className="sm:col-span-2">
            <Field label="Why is the price changing?" htmlFor="p-reason">
              <Input id="p-reason" placeholder="e.g. new supplier cost" value={priceReason} onChange={(e) => setPriceReason(e.target.value)} />
            </Field>
          </div>
        )}
        <Field label="Category" htmlFor="p-cat">
          <Select id="p-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Made at" htmlFor="p-station" hint="Tickets for this item print / show at this station. Bottled drinks: choose “No station”.">
          <Select id="p-station" value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="">No station — waiter hands it over (fridge, bottles)</option>
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description (optional)" htmlFor="p-desc">
            <Textarea id="p-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </Field>
        </div>
      </div>

      {product && (
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">Add-ons</h3>
            <ul className="flex flex-col gap-1.5">
              {mods.map((m) => (
                <li key={m.id} className={`flex items-center justify-between rounded-md border border-line px-3 py-2 text-sm ${m.isActive ? '' : 'opacity-50'}`}>
                  <span>
                    {m.name} <span className="text-mute tnum">{Number(m.priceDelta) > 0 ? `+${money(m.priceDelta)}` : 'free'}</span>
                  </span>
                  <button onClick={() => toggleMod(m)} className="text-xs font-semibold text-mute hover:text-ink">
                    {m.isActive ? 'Hide' : 'Show'}
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex gap-2">
              <Input id="mod-name" className="h-10" placeholder="e.g. Extra shot" value={newMod.name} onChange={(e) => setNewMod({ ...newMod, name: e.target.value })} />
              <Input id="mod-price" className="h-10 w-24" inputMode="decimal" placeholder="+0" value={newMod.priceDelta} onChange={(e) => setNewMod({ ...newMod, priceDelta: e.target.value.replace(/[^\d.]/g, '') })} />
              <Button size="sm" className="h-10" onClick={addMod} disabled={!newMod.name.trim()}>
                Add
              </Button>
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Photo</h3>
            {product.imageReference && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={product.imageReference} alt="" className="mb-2 h-32 w-full rounded-md object-cover" />
            )}
            <label className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-line px-4 py-3 text-sm hover:border-ink">
              <Icon name="camera" size={18} /> {product.imageReference ? 'Replace photo' : 'Upload photo'} (JPG, PNG, WebP, max 2 MB)
              <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function CategorySheet({ open, onClose, categories, branchId, onChanged }: { open: boolean; onClose: () => void; categories: Category[]; branchId: string; onChanged: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const add = async () => {
    try {
      await api.post('/categories', { branchId, name: name.trim(), displayOrder: categories.length + 1 });
      setName('');
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  const toggle = async (c: Category) => {
    try {
      await api.post(`/categories/${c.id}/${c.isActive ? 'deactivate' : 'activate'}`);
      onChanged();
    } catch (e) {
      toast(errorText(e), 'error');
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title="Categories">
      <ul className="flex flex-col gap-1.5">
        {categories.map((c) => (
          <li key={c.id} className={`flex items-center justify-between rounded-md border border-line px-3 py-2.5 ${c.isActive ? '' : 'opacity-50'}`}>
            <span className="font-semibold">{c.name}</span>
            <button onClick={() => toggle(c)} className="text-sm font-semibold text-mute hover:text-ink">
              {c.isActive ? 'Remove' : 'Bring back'}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-mute">A category can only be removed once it has no items on the menu.</p>
      <div className="mt-4 flex gap-2 pb-2">
        <Input id="cat-name" placeholder="New category" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="lg" onClick={add} disabled={!name.trim()}>
          Add
        </Button>
      </div>
    </Sheet>
  );
}
