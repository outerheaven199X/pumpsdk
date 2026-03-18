/** Input validation helpers for Solana addresses and trade parameters. */

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Check whether a string looks like a valid Solana address.
 * @param address - The candidate address string.
 * @returns True if the address matches Base58 format.
 */
export function isValidSolanaAddress(address: string): boolean {
  return BASE58_REGEX.test(address);
}

/**
 * Throw a descriptive error if the address is invalid.
 * @param address - The address to validate.
 * @param label - Human-readable label for error messages.
 */
export function requireValidAddress(address: string, label: string): void {
  if (!isValidSolanaAddress(address)) {
    throw new Error(
      `Invalid ${label}: "${address}" is not a valid Base58 Solana address. ` +
      "Solana addresses are 32-44 characters using Base58 encoding (no 0, O, I, or l).",
    );
  }
}

/**
 * Validate that slippage is a reasonable integer percentage.
 * @param slippage - The slippage value to check.
 */
export function requireValidSlippage(slippage: number): void {
  if (!Number.isInteger(slippage) || slippage < 1 || slippage > 100) {
    throw new Error(`Slippage must be an integer between 1 and 100, got ${slippage}`);
  }
}
