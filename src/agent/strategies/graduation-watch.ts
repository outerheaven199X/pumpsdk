/** Graduation watch strategy: alert when tracked tokens near bonding curve completion. */

import { pumpGet } from "../../client/pump-rest.js";
import { lamportsToSol } from "../../utils/formatting.js";
import { routedChat } from "../orchestrator.js";
import type { GraduationWatchConfig, LlmMessage } from "../types.js";

const GRADUATION_SOL_THRESHOLD = 85;
const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_MIN_PROGRESS = 70;

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  virtual_sol_reserves: number;
  market_cap: number;
  complete: boolean;
}

/**
 * Run the graduation watch loop: find tokens approaching bonding curve completion.
 * Alerts when tokens cross the configured progress threshold.
 * @param config - Graduation watch configuration.
 */
export async function graduationWatchLoop(config: GraduationWatchConfig): Promise<void> {
  console.error(`[graduation] Watching for tokens above ${config.minProgressPercent}% progress`);
  console.error(`[graduation] Check interval: ${config.checkIntervalMs / 1000}s`);

  const alerted = new Set<string>();

  while (true) {
    try {
      const coins = await pumpGet<CoinListing[]>("/coins", {
        sort: "market_cap",
        order: "DESC",
        limit: "50",
        offset: "0",
        includeNsfw: "false",
      });

      const graduating = coins
        .filter((c) => !c.complete)
        .map((c) => {
          const sol = lamportsToSol(c.virtual_sol_reserves);
          const progress = Math.min((sol / GRADUATION_SOL_THRESHOLD) * 100, 100);
          return { ...c, solReserves: sol, progress };
        })
        .filter((c) => c.progress >= config.minProgressPercent);

      for (const token of graduating) {
        if (alerted.has(token.mint)) continue;
        alerted.add(token.mint);

        const solRemaining = Math.max(GRADUATION_SOL_THRESHOLD - token.solReserves, 0);
        console.error(`[graduation] ALERT: ${token.name} ($${token.symbol}) at ${token.progress.toFixed(1)}%`);
        console.error(`[graduation]   ${solRemaining.toFixed(2)} SOL to graduation`);
        console.error(`[graduation]   Market cap: ${token.market_cap}`);

        try {
          const messages: LlmMessage[] = [
            {
              role: "system",
              content:
                "You are a Pump.fun graduation analyst. Tokens graduate when their bonding curve fills ~85 SOL. Analyze graduation likelihood.",
            },
            {
              role: "user",
              content: `Token approaching graduation:\n- Name: ${token.name} ($${token.symbol})\n- Progress: ${token.progress.toFixed(1)}%\n- SOL remaining: ${solRemaining.toFixed(2)}\n- Market cap: ${token.market_cap}\n\nIs this likely to graduate? What's the outlook?`,
            },
          ];

          const analysis = await routedChat("analyze graduation likelihood", messages);
          console.error(`[graduation] Analysis: ${analysis.content.slice(0, 200)}`);
        } catch (err) {
          console.error(`[graduation] Analysis failed: ${err}`);
        }
      }
    } catch (err) {
      console.error(`[graduation] Check failed: ${err}`);
    }

    await new Promise((r) => setTimeout(r, config.checkIntervalMs));
  }
}

/**
 * Create a default graduation watch config.
 * @returns GraduationWatchConfig.
 */
export function defaultGraduationWatchConfig(): GraduationWatchConfig {
  const wallet = process.env.AGENT_WALLET_PUBKEY;
  if (!wallet) throw new Error("AGENT_WALLET_PUBKEY required for graduation watch.");

  return {
    walletAddress: wallet,
    minProgressPercent: DEFAULT_MIN_PROGRESS,
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  };
}
