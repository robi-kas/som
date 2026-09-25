import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Order', description: 'Take and send an order.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
