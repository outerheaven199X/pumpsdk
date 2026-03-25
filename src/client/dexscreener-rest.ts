/** REST client for DexScreener API — token profile boosting and listing checks. */

import { DEXSCREENER_API_BASE } from "../utils/constants.js";

/**
 * Make a GET request to the DexScreener API.
 * @param path - API path (e.g., "/latest/dex/tokens/...").
 * @returns Parsed JSON response.
 */
export async function dexGet<T>(path: string): Promise<T> {
  const url = `${DEXSCREENER_API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`DexScreener GET ${path} failed: HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Make a POST request to the DexScreener API.
 * @param path - API path.
 * @param body - JSON request body.
 * @returns Parsed JSON response.
 */
export async function dexPost<T>(path: string, body: unknown): Promise<T> {
  const url = `${DEXSCREENER_API_BASE}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`DexScreener POST ${path} failed: HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}
