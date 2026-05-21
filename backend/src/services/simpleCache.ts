type CacheEntry<T> = {
  value: T | Promise<T>;
  expiresAt: number;
  refreshTimer?: ReturnType<typeof setTimeout>;
  isRefreshing?: boolean;
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

function scheduleRefresh<T>(key: string, ttlMs: number, factory: () => Promise<T>, attempt = 0) {
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
        scheduleRefresh(key, ttlMs, factory, 0);
      })
      .catch(() => {
        // Refresh failed — reschedule with backoff so the chain stays alive.
        // Cap at 4 retries (60s max delay) then let the entry expire naturally.
        if (attempt < 4) {
          const retryDelay = Math.min(60_000, 5_000 * Math.pow(2, attempt));
          const current = store.get(key) as CacheEntry<T> | undefined;
          if (current && current === (entry as unknown)) {
            current.refreshTimer = setTimeout(
              () => scheduleRefresh(key, ttlMs, factory, attempt + 1),
              retryDelay
            );
          }
        }
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

  if (existing) {
    if (existing.expiresAt > t) {
      // Fresh — return immediately (awaits if still a pending Promise).
      return await (existing.value as Promise<T>);
    }

    // Stale but has resolved data — return it immediately and refresh in background.
    if (!(existing.value instanceof Promise) && !existing.isRefreshing) {
      existing.isRefreshing = true;
      factory()
        .then((value) => {
          const next: CacheEntry<T> = { value, expiresAt: nowMs() + Math.max(0, ttlMs) };
          store.set(key, next as CacheEntry<unknown>);
          scheduleRefresh(key, ttlMs, factory, 0);
        })
        .catch(() => {
          // Background refresh failed — clear the flag so the next request can retry.
          const current = store.get(key) as CacheEntry<T> | undefined;
          if (current && current.isRefreshing) current.isRefreshing = false;
        });
      return existing.value as T;
    }

    // Stale but in-flight Promise — wait for it rather than launching a second factory.
    if (existing.value instanceof Promise) {
      return await (existing.value as Promise<T>);
    }
  }

  const pending = factory();
  const pendingEntry: CacheEntry<T> = { value: pending, expiresAt: t + Math.max(0, ttlMs) };
  store.set(key, pendingEntry as CacheEntry<unknown>);

  try {
    const value = await pending;
    const resolved: CacheEntry<T> = { value, expiresAt: nowMs() + Math.max(0, ttlMs) };
    store.set(key, resolved as CacheEntry<unknown>);
    scheduleRefresh(key, ttlMs, factory);
    return value;
  } catch (err) {
    if (store.get(key) === (pendingEntry as unknown)) store.delete(key);
    throw err;
  }
}
