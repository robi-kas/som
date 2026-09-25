'use client';

import { useOfflineQueue } from '@/lib/offline';
import { useT } from '@/lib/i18n';
import { Icon } from '@/components/ui/Icon';

export function OfflineQueueBadge() {
  const { count, online, rejected, dismissRejected } = useOfflineQueue();
  const { t } = useT();
  return (
    <>
      {!online && (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-warning-bg px-3 text-sm font-semibold text-warning-deep">
          <Icon name="wifiOff" size={16} />
          {t('common.offline')}
          {count > 0 && ` · ${count}`}
        </span>
      )}
      {online && count > 0 && (
        <span className="inline-flex h-9 items-center gap-1.5 rounded-full bg-info-bg px-3 text-sm font-semibold text-info">
          <Icon name="refresh" size={16} className="animate-spin" />
          Sending {count}
        </span>
      )}
      {rejected.length > 0 && (
        <button onClick={dismissRejected} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-negative-bg px-3 text-left text-sm font-semibold text-negative">
          {rejected.length} not sent: {rejected[rejected.length - 1].tableName ?? ''} {rejected[rejected.length - 1].reason} ✕
        </button>
      )}
    </>
  );
}
