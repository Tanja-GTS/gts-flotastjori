type CacheEntry<T> = {
  value: T | Promise<T>;
  expiresAt: number;
  refreshing?: boolean;
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
  // How many ms before expiry to kick off a background refresh (stale-while-revalidate).
  // Defaults to min(60s, ttlMs/2). Set to 0 to disable.
  revalidateEarlyMs?: number;
}): Promise<T> {
  const { key, ttlMs, factory } = params;
  const revalidateMs =
    params.revalidateEarlyMs !== undefined
      ? params.revalidateEarlyMs
      : Math.min(60_000, Math.floor(ttlMs / 2));

  const existing = store.get(key) as CacheEntry<T> | undefined;
  const t = nowMs();

  if (existing && existing.expiresAt > t) {
    // Proactive background refresh: if the entry is within revalidateMs of expiry and not already
    // refreshing, kick off a silent background update so users never hit the cold path.
    if (revalidateMs > 0 && existing.expiresAt - t < revalidateMs && !existing.refreshing) {
      existing.refreshing = true;
      factory()
        .then((value) => {
          store.set(key, { value, expiresAt: nowMs() + Math.max(0, ttlMs) });
        })
        .catch(() => {
          // If refresh fails, let the entry expire naturally and the next caller will retry.
          const e = store.get(key) as CacheEntry<T> | undefined;
          if (e) e.refreshing = false;
        });
    }
    return await (existing.value as Promise<T>);
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
