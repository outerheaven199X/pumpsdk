/** Scout strategy: scan trending topics and generate token launch packages. */

import { pumpGet } from "../../client/pump-rest.js";
import { sonnetChat } from "../sonnet.js";
import type { ScoutConfig, LlmMessage } from "../types.js";

const DEFAULT_SCAN_INTERVAL_MS = 30 * 60 * 1000;
const DEFAULT_MAX_IDEAS = 3;

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  market_cap: number;
}

interface ScoutPackage {
  name: string;
  symbol: string;
  description: string;
  imagePrompt: string;
  reasoning: string;
}

/**
 * Run the scout loop: scan trends, generate launch packages via Sonnet.
 * @param config - Scout configuration.
 */
export async function scoutLoop(config: ScoutConfig): Promise<void> {
  console.error(`[scout] Starting scout strategy (interval: ${config.scanIntervalMs / 1000}s)`);
  console.error(`[scout] Sources: ${config.sources.join(", ")}`);
  console.error(`[scout] Max ideas per cycle: ${config.maxIdeas}`);

  while (true) {
    try {
      const trendingNames: string[] = [];

      if (config.sources.includes("pump")) {
        const coins = await pumpGet<CoinListing[]>("/coins", {
          sort: "market_cap",
          order: "DESC",
          limit: "20",
          offset: "0",
          includeNsfw: "false",
        });
        trendingNames.push(...coins.slice(0, 10).map((c) => `${c.name} ($${c.symbol}) - MC: ${c.market_cap}`));
      }

      if (trendingNames.length > 0) {
        console.error(`[scout] Trending: ${trendingNames.slice(0, 5).join(", ")}...`);

        const messages: LlmMessage[] = [
          {
            role: "system",
            content: `You are a Pump.fun token scout. Generate ${config.maxIdeas} unique token launch ideas inspired by current trends. Each idea should have: name (max 32 chars), symbol (3-5 chars), description (1-2 sentences), and imagePrompt (description for AI image generation). Return as JSON array.`,
          },
          {
            role: "user",
            content: `Current trending tokens on Pump.fun:\n${trendingNames.join("\n")}\n\nGenerate ${config.maxIdeas} new token ideas that ride similar trends but are unique. Return JSON array with fields: name, symbol, description, imagePrompt, reasoning.`,
          },
        ];

        const result = await sonnetChat(messages);
        console.error(`[scout] Generated ideas:\n${result.content.slice(0, 500)}`);

        try {
          const packages = JSON.parse(result.content) as ScoutPackage[];
          for (const pkg of packages) {
            console.error(`[scout] Idea: ${pkg.name} ($${pkg.symbol}) - ${pkg.description}`);
          }
        } catch {
          console.error("[scout] Could not parse ideas as JSON — raw output logged above");
        }
      }
    } catch (err) {
      console.error(`[scout] Scan failed: ${err}`);
    }

    await new Promise((r) => setTimeout(r, config.scanIntervalMs));
  }
}

/**
 * Create a default scout config.
 * @returns ScoutConfig.
 */
export function defaultScoutConfig(): ScoutConfig {
  return {
    sources: (process.env.SCOUT_SOURCES ?? "pump").split(",").map((s) => s.trim()),
    maxIdeas: Number(process.env.SCOUT_MAX_IDEAS ?? DEFAULT_MAX_IDEAS),
    scanIntervalMs: Number(process.env.SCOUT_INTERVAL ?? DEFAULT_SCAN_INTERVAL_MS),
  };
}
