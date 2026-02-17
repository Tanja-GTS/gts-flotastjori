type CacheEntry<T> = {
  value: T | Promise<T>;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

function nowMs() {
  return Date.now();
}

export function cacheClearAll() {
  store.clear();
}

export function cacheInvalidatePrefix(prefix: string) {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

export async function cacheGetOrSet<T>(params: {
  key: string;
  ttlMs: number;
  factory: () => Promise<T>;
}): Promise<T> {
  const { key, ttlMs, factory } = params;
  const existing = store.get(key) as CacheEntry<T> | undefined;
  const t = nowMs();

  if (existing && existing.expiresAt > t) {
    return await existing.value;
  }

  const pending = factory();
  store.set(key, { value: pending, expiresAt: t + Math.max(0, ttlMs) });

  try {
    const value = await pending;
    store.set(key, { value, expiresAt: t + Math.max(0, ttlMs) });
    return value;
  } catch (err) {
    store.delete(key);
    throw err;
  }
}
