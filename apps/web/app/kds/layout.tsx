import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Kitchen', description: 'Kitchen, coffee and juice tickets, live.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
