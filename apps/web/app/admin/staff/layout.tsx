import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Staff', description: 'Staff logins, roles and stations.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
