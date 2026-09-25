import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Payments', description: 'Every payment of the day with transaction numbers and photos.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
