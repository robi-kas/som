import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Menu', description: 'Items, prices, photos, stations and stock.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
