/** Tiered TTL cache for Pump.fun API responses — reduces latency and redundant calls. */

export const CACHE_TTL = {
  /** Token metadata — rarely changes after creation. */
  stable: 10 * 60 * 1000,
  /** Coin listings, trades feed, analytics — moderate churn. */
  moderate: 3 * 60 * 1000,
  /** Bonding curve reserves — changes on every trade. */
  volatile: 30 * 1000,
  /** Quotes, transactions, signing sessions — never cache. */
  none: 0,
} as const;

interface CacheEntry {
  data: unknown;
  expires: number;
}

/**
 * In-memory key-value cache with TTL expiry.
 * Keys follow "domain:identifier" convention (e.g. "coin:MINT_ADDR").
 */
class ApiCache {
  private store = new Map<string, CacheEntry>();

  /**
   * Retrieve a cached value if it exists and hasn't expired.
   * @param key - Cache key (typically "domain:identifier").
   * @returns The cached value or null if missing/expired.
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  /**
   * Store a value with a TTL. Zero-TTL values are never stored.
   * @param key - Cache key.
   * @param data - Value to cache.
   * @param ttlMs - Time-to-live in milliseconds.
   */
  set(key: string, data: unknown, ttlMs: number): void {
    if (ttlMs === 0) return;
    this.store.set(key, { data, expires: Date.now() + ttlMs });
  }

  /**
   * Remove all cache entries whose key starts with the given prefix.
   * @param prefix - Key prefix to match for invalidation.
   */
  invalidate(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  /** Current number of cached entries (for diagnostics). */
  get size(): number {
    return this.store.size;
  }
}

export const cache = new ApiCache();
