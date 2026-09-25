import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Tables', description: 'Tables on the floor.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
