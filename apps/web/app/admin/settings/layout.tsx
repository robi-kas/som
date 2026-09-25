import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Settings', description: 'Cafe name, logo, VAT, limits and payment methods.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
