import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Printed bills', description: 'Every receipt and ticket as printed.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
