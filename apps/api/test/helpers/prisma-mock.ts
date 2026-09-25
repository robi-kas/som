import { vi, type Mock } from 'vitest';

/**
 * A forgiving PrismaService fake for unit tests.
 *
 * `mock.order.findUnique` (any model, any method) is a vi.fn() created on first access, so
 * tests only configure the calls they care about. `$transaction(cb)` runs cb with the same
 * mock, and `$queryRaw` (used for row locks and counters) resolves to a single row by default.
 */
export type PrismaMock = Record<string, Record<string, Mock>> & {
  $transaction: Mock;
  $queryRaw: Mock;
  $executeRaw: Mock;
};

export function createPrismaMock(): PrismaMock {
  const models = new Map<string, Record<string, Mock>>();
  const model = (name: string) => {
    if (!models.has(name)) {
      const fns = new Map<string, Mock>();
      models.set(
        name,
        new Proxy({} as Record<string, Mock>, {
          get: (_t, prop: string) => {
            if (!fns.has(prop)) fns.set(prop, vi.fn());
            return fns.get(prop);
          },
          set: (_t, prop: string, value: Mock) => {
            fns.set(prop, value);
            return true;
          },
        }),
      );
    }
    return models.get(name)!;
  };

  const root: Record<string, unknown> = {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 'locked', lastValue: 1 }]),
    $executeRaw: vi.fn().mockResolvedValue(1),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
  const proxy = new Proxy(root, {
    get: (t, prop: string) => (prop in t ? t[prop] : typeof prop === 'string' && !prop.startsWith('then') ? model(prop) : undefined),
    set: (t, prop: string, value) => {
      t[prop] = value;
      return true;
    },
  }) as unknown as PrismaMock;
  root.$transaction = vi.fn(async (arg: unknown) => (typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(proxy) : Promise.all(arg as unknown[])));
  return proxy;
}
