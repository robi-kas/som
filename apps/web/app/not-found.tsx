import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Page not found' };

export default function NotFound() {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-canvas-soft px-6 text-center">
      <div className="max-w-sm">
        <p className="font-display text-[64px] font-black leading-none text-primary-deep">404</p>
        <h1 className="mt-3 font-display text-display-md">This page doesn’t exist</h1>
        <p className="mt-2 text-sm text-mute">The address may be mistyped, or the page was moved. Nothing was lost.</p>
        <Link href="/" className="mt-6 inline-flex h-12 items-center rounded-md bg-ink px-6 font-semibold text-white hover:bg-ink-soft">
          Back to the app
        </Link>
      </div>
    </main>
  );
}
