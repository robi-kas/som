import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Cashier', description: 'Open bills, payments, refunds and the cash drawer.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
