/** Fee optimizer strategy: one-shot Sonnet-powered fee config analysis. */

import { pumpGet } from "../../client/pump-rest.js";
import { sonnetChat } from "../sonnet.js";
import type { LlmMessage } from "../types.js";

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  market_cap: number;
  virtual_sol_reserves: number;
}

/**
 * Run a one-shot fee optimization analysis using Sonnet.
 * Analyzes the user's created tokens and recommends fee config improvements.
 * @param wallet - Creator wallet address.
 * @returns Analysis text from Sonnet.
 */
export async function analyzeFeeOptimization(wallet: string): Promise<string> {
  const coins = await pumpGet<CoinListing[]>(`/coins/user-created-coins/${wallet}`, {
    limit: "20",
    offset: "0",
  });

  if (coins.length === 0) {
    return "No created tokens found for this wallet. Create a token first to get fee optimization suggestions.";
  }

  const tokenSummary = coins
    .map((c) => `- ${c.name} ($${c.symbol}): Market cap ${c.market_cap}, Reserves ${c.virtual_sol_reserves}`)
    .join("\n");

  const messages: LlmMessage[] = [
    {
      role: "system",
      content:
        "You are a Pump.fun fee optimization consultant. Analyze creator tokens and recommend fee config improvements for maximum revenue.",
    },
    {
      role: "user",
      content: `Wallet: ${wallet}\n\nCreated tokens:\n${tokenSummary}\n\nAnalyze:\n1. Which tokens are generating the most fees?\n2. Should any fee splits be adjusted?\n3. Are there tokens where fees should be claimed immediately?\n4. General optimization recommendations.`,
    },
  ];

  const result = await sonnetChat(messages);
  return result.content;
}
