/** REST client for Pump.fun frontend API and PumpPortal local-trade API. */

import { PUMP_FRONTEND_API, PUMPPORTAL_API_BASE } from "../utils/constants.js";

/**
 * GET request to the Pump.fun frontend API (metadata, coins, etc.).
 * @param path - API path (e.g. "/coins/MINT").
 * @param params - Optional query parameters.
 * @returns Parsed JSON response.
 */
export async function pumpGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${PUMP_FRONTEND_API}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Pump API error: HTTP ${res.status}: ${res.statusText}`);
  }

  return res.json() as Promise<T>;
}

/**
 * POST JSON to PumpPortal and return parsed JSON response.
 * Used for endpoints that return JSON (e.g. quotes if available).
 * @param path - API path.
 * @param body - JSON-serializable request body.
 * @returns Parsed JSON response.
 */
export async function portalPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PUMPPORTAL_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`PumpPortal API error: HTTP ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

/**
 * POST to PumpPortal and return raw transaction bytes.
 * PumpPortal /trade-local returns a serialized VersionedTransaction as binary.
 * @param path - API path (e.g. "/trade-local").
 * @param body - JSON-serializable request body.
 * @returns Raw transaction bytes as Uint8Array.
 */
export async function portalPostBinary(path: string, body: unknown): Promise<Uint8Array> {
  const res = await fetch(`${PUMPPORTAL_API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`PumpPortal API error: HTTP ${res.status}: ${text}`);
  }

  const buffer = await res.arrayBuffer();
  return new Uint8Array(buffer);
}
