/** Formatting utilities for SOL amounts, addresses, and display values. */

import { LAMPORTS_PER_SOL } from "./constants.js";

/**
 * Convert lamports to SOL with up to 9 decimal places.
 * @param lamports - Amount in lamports.
 * @returns Amount in SOL.
 */
export function lamportsToSol(lamports: number): number {
  return lamports / LAMPORTS_PER_SOL;
}

/**
 * Convert SOL to lamports (integer).
 * @param sol - Amount in SOL.
 * @returns Amount in lamports.
 */
export function solToLamports(sol: number): number {
  return Math.round(sol * LAMPORTS_PER_SOL);
}

/**
 * Truncate a Solana address for display: first4...last4.
 * @param address - Full Base58 address.
 * @returns Truncated string.
 */
export function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

/**
 * Format a SOL amount for display with unit suffix.
 * @param sol - Amount in SOL.
 * @returns Formatted string (e.g. "1.5 SOL").
 */
export function formatSol(sol: number): string {
  return `${sol.toFixed(4)} SOL`;
}
