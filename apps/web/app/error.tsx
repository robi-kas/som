'use client';

import { useEffect } from 'react';

/** Shown if a screen crashes, instead of a blank page. Orders and payments already saved are safe. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="grid min-h-[100dvh] place-items-center bg-canvas-soft px-6 text-center">
      <div className="max-w-sm">
        <h1 className="font-display text-display-md">Something went wrong on this screen</h1>
        <p className="mt-2 text-sm text-mute">
          Everything already saved (orders, payments) is safe. Try again; if it keeps happening, tell the manager
          {error.digest ? (
            <>
              {' '}
              and mention code <code className="rounded bg-canvas-sunk px-1">{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <button onClick={reset} className="inline-flex h-12 items-center rounded-md bg-ink px-6 font-semibold text-white hover:bg-ink-soft">
            Try again
          </button>
          <a href="/" className="inline-flex h-12 items-center rounded-md border border-line px-6 font-semibold hover:border-ink">
            Home
          </a>
        </div>
      </div>
    </main>
  );
}
