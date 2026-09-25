import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Needs attention', description: 'Payments to check, refunds and drawer differences waiting for a manager.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
