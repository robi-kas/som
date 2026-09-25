import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Reports', description: 'Sales by day, item, waiter, payment method and hour.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
