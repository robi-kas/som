'use client';

import { useState } from 'react';
import { api, errorText } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';

/** Type in a payment's transaction number after the fact (it was skipped at the till). */
export function ReferenceEditor({
  paymentId,
  onSaved,
  compact,
  initial = '',
  onCancel,
}: {
  paymentId: string;
  onSaved: () => void;
  compact?: boolean;
  initial?: string;
  onCancel?: () => void;
}) {
  const toast = useToast();
  const [ref, setRef] = useState(initial);
  const [busy, setBusy] = useState(false);
  const valid = /^[A-Za-z0-9\-_/ ]{4,64}$/.test(ref.trim());

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      await api.post(`/payments/${paymentId}/reference`, { referenceNumber: ref.trim() });
      toast('Transaction number saved', 'success');
      setRef('');
      onSaved();
    } catch (e) {
      toast(errorText(e), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input
        className={compact ? 'h-9' : undefined}
        autoCapitalize="characters"
        placeholder="Transaction number"
        value={ref}
        onChange={(e) => setRef(e.target.value.toUpperCase())}
        maxLength={64}
        aria-label="Transaction number"
      />
      <Button type="submit" size="sm" disabled={busy || !valid || ref.trim() === initial} loading={busy}>
        Save
      </Button>
      {onCancel && (
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      )}
    </form>
  );
}
