type CacheEntry<T> = {
  value: T | Promise<T>;
  expiresAt: number;
  refreshTimer?: ReturnType<typeof setTimeout>;
};

const store = new Map<string, CacheEntry<unknown>>();

function nowMs() {
  return Date.now();
}

export function cacheClearAll() {
  for (const entry of store.values()) {
    const e = entry as CacheEntry<unknown>;
    if (e.refreshTimer) clearTimeout(e.refreshTimer);
  }
  store.clear();
}

export function cacheInvalidatePrefix(prefix: string) {
  for (const [key, entry] of store.entries()) {
    if (key.startsWith(prefix)) {
      const e = entry as CacheEntry<unknown>;
      if (e.refreshTimer) clearTimeout(e.refreshTimer);
      store.delete(key);
    }
  }
}

function scheduleRefresh<T>(key: string, ttlMs: number, factory: () => Promise<T>) {
  const entry = store.get(key) as CacheEntry<T> | undefined;
  if (!entry) return;
  if (entry.refreshTimer) clearTimeout(entry.refreshTimer);

  // Fire the refresh 30s before the TTL expires so it completes before the entry goes stale.
  const delay = Math.max(0, ttlMs - 30_000);
  entry.refreshTimer = setTimeout(() => {
    // Skip if the entry was invalidated or replaced in the meantime.
    if (store.get(key) !== (entry as unknown)) return;
    factory()
      .then((value) => {
        const next: CacheEntry<T> = { value, expiresAt: nowMs() + Math.max(0, ttlMs) };
        store.set(key, next as CacheEntry<unknown>);
        scheduleRefresh(key, ttlMs, factory);
      })
      .catch(() => {
        // Refresh failed — entry will expire naturally; next caller will retry.
      });
  }, delay);
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
    return await (existing.value as Promise<T>);
  }

  const pending = factory();
  const pendingEntry: CacheEntry<T> = { value: pending, expiresAt: t + Math.max(0, ttlMs) };
  store.set(key, pendingEntry as CacheEntry<unknown>);

  try {
    const value = await pending;
    const resolved: CacheEntry<T> = { value, expiresAt: t + Math.max(0, ttlMs) };
    store.set(key, resolved as CacheEntry<unknown>);
    // Schedule a background refresh so the cache stays warm without needing traffic.
    scheduleRefresh(key, ttlMs, factory);
    return value;
  } catch (err) {
    if (store.get(key) === (pendingEntry as unknown)) store.delete(key);
    throw err;
  }
}
