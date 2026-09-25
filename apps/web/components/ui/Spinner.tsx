export function Spinner({ className = 'h-6 w-6' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

export function PageSpinner() {
  return (
    <div className="flex h-full min-h-[40vh] w-full items-center justify-center text-mute">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

/** Shown instead of an endless spinner when a page's data couldn't be loaded. */
export function LoadFailed({ onRetry, message }: { onRetry: () => void; message?: string }) {
  return (
    <div className="flex min-h-[40vh] w-full flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="font-display text-display-sm text-ink">Couldn’t load this page</p>
      <p className="max-w-sm text-sm text-mute">{message ?? 'The server didn’t answer. Check that the API is running (npm run dev), then try again.'}</p>
      <button onClick={onRetry} className="mt-1 h-11 rounded-md bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-soft">
        Try again
      </button>
    </div>
  );
}
