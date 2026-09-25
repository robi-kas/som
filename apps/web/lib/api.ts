/**
 * The one way the web app talks to the API.
 *
 * - Same-origin requests to /api/v1/... (proxied to NestJS by next.config.js), so the
 *   httpOnly session cookie is sent automatically; no token ever touches JavaScript.
 * - Every write carries X-Requested-With (the API's CSRF check).
 * - Errors become ApiError with the server's `code` and a human `message`.
 * - Sensitive actions: when the API answers APPROVAL_REQUIRED, the registered approval
 *   handler (the manager PIN pad) is shown and the request is retried with the token.
 */

import { uuid } from '@/lib/uuid';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
    public body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type ApprovalHandler = (permission: string) => Promise<string | null>;
let approvalHandler: ApprovalHandler | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setApprovalHandler(fn: ApprovalHandler | null) {
  approvalHandler = fn;
}
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

function extractMessage(body: unknown, fallback: string): { code?: string; message: string; permission?: string } {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const msg = Array.isArray(b.message) ? b.message.join(', ') : typeof b.message === 'string' ? b.message : undefined;
    return {
      code: typeof b.code === 'string' ? b.code : typeof b.message === 'string' && /^[A-Z_]+$/.test(b.message) ? b.message : undefined,
      message: msg ?? fallback,
      permission: typeof b.permission === 'string' ? b.permission : undefined,
    };
  }
  return { message: typeof body === 'string' && body ? body : fallback };
}

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  /** Set false for requests where a 401 should not bounce to /login (e.g. the login call itself). */
  redirectOn401?: boolean;
  signal?: AbortSignal;
}

async function request<T>(method: string, path: string, opts: RequestOptions = {}, approvalToken?: string): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (method !== 'GET') headers['X-Requested-With'] = 'cafe-web';
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (approvalToken) headers['X-Approval-Token'] = approvalToken;

  // Never wait forever: a hung request becomes a clear error instead of an endless spinner.
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), isForm ? 60_000 : 15_000);
  opts.signal?.addEventListener('abort', () => timeout.abort());

  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: timeout.signal,
      cache: 'no-store',
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if ((e as Error)?.name === 'AbortError') throw new ApiError(0, 'TIMEOUT', 'The server took too long to answer', null);
    throw new ApiError(0, 'NETWORK', 'No connection to the server', null);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }

  if (res.ok) return body as T;

  const { code, message, permission } = extractMessage(body, `Request failed (${res.status})`);

  if (res.status === 401 && opts.redirectOn401 !== false) {
    unauthorizedHandler?.();
  }

  if (res.status === 403 && code === 'APPROVAL_REQUIRED' && permission && approvalHandler && !approvalToken) {
    const token = await approvalHandler(permission);
    if (token) return request<T>(method, path, opts, token);
    throw new ApiError(403, 'APPROVAL_CANCELLED', 'Cancelled', body);
  }

  throw new ApiError(res.status, code, message, body);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body: body ?? {} }),
  upload: <T>(path: string, form: FormData, headers?: Record<string, string>) => request<T>('POST', path, { body: form, headers }),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};

/** A friendly one-liner for toasts. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'NETWORK') return 'No connection. Check the Wi-Fi and try again.';
    if (e.code === 'TIMEOUT') return 'The server took too long. Is the API running? Try again.';
    if (e.code === 'ORDER_VERSION_CONFLICT') return 'Someone else just changed this order. It has been reloaded.';
    return e.message;
  }
  return e instanceof Error ? e.message : 'Something went wrong';
}

export function newIdempotencyKey() {
  return uuid();
}
