'use client';

import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { SessionProvider } from '@/lib/session';
import { ToastProvider } from '@/components/ui/Toast';
import { ApprovalProvider } from '@/components/approval/ApprovalProvider';
import { installSoundUnlock } from '@/lib/sound';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => {
    installSoundUnlock();
  }, []);

  useEffect(() => {
    // Installable app + cached shell for flaky Wi-Fi. Registered in production only.
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  return (
    <I18nProvider>
      <ToastProvider>
        <SessionProvider>
          <ApprovalProvider>{children}</ApprovalProvider>
        </SessionProvider>
      </ToastProvider>
    </I18nProvider>
  );
}
