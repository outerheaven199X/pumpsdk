/** Runtime feature flags — set via environment variables with PUMPSDK_ prefix. */

export const FLAGS = {
  /** Skip CSRF validation (development/testing only). */
  DEV_NO_CSRF: process.env.PUMPSDK_DEV_NO_CSRF === "1",

  /** Log all outbound API requests for debugging. */
  DEBUG_API: process.env.PUMPSDK_DEBUG_API === "1",

  /** Disable image generation even if FAL_API_KEY is set. */
  NO_IMAGE_GEN: process.env.PUMPSDK_NO_IMAGE_GEN === "1",

  /** Agent strategies run in dry-run mode (log only, no transactions built). */
  AGENT_DRY_RUN: process.env.PUMPSDK_AGENT_DRY_RUN === "1",

  /** Use devnet RPC and skip mainnet-only tool calls. */
  DEVNET_MODE: process.env.PUMPSDK_DEVNET === "1",

  /** Session TTL override in milliseconds (default: 10 minutes). */
  SESSION_TTL: Number(process.env.PUMPSDK_SESSION_TTL) || 600_000,

  /** Disable PumpPortal WebSocket connection. */
  NO_WEBSOCKET: process.env.PUMPSDK_NO_WS === "1",

  /** Encrypt session store at rest (requires PUMPSDK_SESSION_KEY env). */
  ENCRYPT_SESSIONS: process.env.PUMPSDK_ENCRYPT_SESSIONS === "1",
} as const;

export type FlagKey = keyof typeof FLAGS;

/**
 * Check a flag value at runtime.
 * @param key - The flag name to check.
 * @returns The flag's current value.
 */
export function flag(key: FlagKey): boolean | number | string {
  return FLAGS[key];
}
