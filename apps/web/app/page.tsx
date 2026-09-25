'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, homeFor } from '@/lib/session';
import { PageSpinner } from '@/components/ui/Spinner';

/** Sends each person to their own screen. */
export default function Home() {
  const { me, loading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading) router.replace(me ? homeFor(me) : '/login');
  }, [me, loading, router]);
  return <PageSpinner />;
}
