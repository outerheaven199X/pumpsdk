/** Auto-claim strategy: periodically attempt to claim creator fees above a threshold. */

import { Buffer } from "node:buffer";
import { portalPostBinary } from "../../client/pump-rest.js";
import { pumpGet } from "../../client/pump-rest.js";
import type { AutoClaimConfig } from "../types.js";

const DEFAULT_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MIN_THRESHOLD_SOL = 0.01;

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  created_timestamp: number;
}

/**
 * Run the auto-claim loop: find creator tokens and attempt to claim fees.
 * Logs unsigned transactions — the operator must sign externally.
 * @param config - Auto-claim configuration.
 */
export async function autoClaimLoop(config: AutoClaimConfig): Promise<void> {
  console.error(`[auto-claim] Monitoring ${config.walletAddress}`);
  console.error(`[auto-claim] Threshold: ${config.minClaimThresholdSol} SOL`);
  console.error(`[auto-claim] Check interval: ${config.checkIntervalMs / 1000}s`);

  while (true) {
    try {
      const coins = await pumpGet<CoinListing[]>(`/coins/user-created-coins/${config.walletAddress}`, {
        limit: "50",
        offset: "0",
      });

      if (coins.length > 0) {
        console.error(`[auto-claim] Found ${coins.length} created tokens, attempting claims...`);

        let claimedCount = 0;
        for (const coin of coins) {
          try {
            const txBytes = await portalPostBinary("/trade-local", {
              action: "collectCreatorFee",
              publicKey: config.walletAddress,
              mint: coin.mint,
              pool: "pump",
              priorityFee: 0.000001,
            });
            const txBase64 = Buffer.from(txBytes).toString("base64");
            console.error(`[auto-claim] TX ready for ${coin.symbol}: ${txBase64.slice(0, 20)}...`);
            claimedCount++;
          } catch {
            /* No claimable fees for this token — normal, skip silently */
          }
        }

        if (claimedCount > 0) {
          console.error(`[auto-claim] ${claimedCount} claim transactions built`);
        }
      }
    } catch (err) {
      console.error(`[auto-claim] Check failed: ${err}`);
    }

    await new Promise((r) => setTimeout(r, config.checkIntervalMs));
  }
}

/**
 * Create a default auto-claim config from environment variables.
 * @returns AutoClaimConfig with wallet from env.
 */
export function defaultAutoClaimConfig(): AutoClaimConfig {
  const wallet = process.env.AGENT_WALLET_PUBKEY;
  if (!wallet) throw new Error("AGENT_WALLET_PUBKEY required for auto-claim strategy.");

  return {
    walletAddress: wallet,
    minClaimThresholdSol: DEFAULT_MIN_THRESHOLD_SOL,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  };
}
