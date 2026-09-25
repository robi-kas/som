import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Kitchen & printers', description: 'Stations and network printers.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
