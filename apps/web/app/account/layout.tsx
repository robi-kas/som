import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Password & PIN', description: 'Change your password and manager PIN.' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
