import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Floor', description: 'Tables and open orders.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
