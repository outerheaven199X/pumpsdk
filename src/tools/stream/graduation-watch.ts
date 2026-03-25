/** pump_graduation_watch — Monitor tokens approaching bonding curve graduation. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { cache, CACHE_TTL } from "../../client/cache.js";
import { lamportsToSol } from "../../utils/formatting.js";

const GRADUATION_SOL_THRESHOLD = 85;
const MIN_PROGRESS_PERCENT = 50;

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  virtual_sol_reserves: number;
  market_cap: number;
  complete: boolean;
  raydium_pool: string | null;
  created_timestamp: number;
}

const inputSchema = {
  minProgress: z.number().optional().describe("Minimum bonding curve progress % to include (default: 50)"),
  limit: z.number().optional().describe("Max tokens to return (default: 10, max: 50)"),
};

/**
 * Register the pump_graduation_watch tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerGraduationWatch(server: McpServer) {
  server.tool(
    "pump_graduation_watch",
    "Find Pump.fun tokens closest to graduating their bonding curve. Returns tokens sorted by proximity to the graduation threshold. Novel feature — not available on other platforms.",
    inputSchema,
    async ({ minProgress, limit }) => {
      try {
        const threshold = minProgress ?? MIN_PROGRESS_PERCENT;
        const maxResults = Math.min(limit ?? 10, 50);
        const cacheKey = `graduation-watch:${threshold}:${maxResults}`;

        const cached = cache.get<unknown>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };
        }

        /* Fetch top tokens by market cap (higher cap = closer to graduation) */
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
            const solReserves = lamportsToSol(c.virtual_sol_reserves);
            const progress = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);
            return {
              mint: c.mint,
              name: c.name,
              symbol: c.symbol,
              marketCap: c.market_cap,
              solReserves: Math.round(solReserves * 10000) / 10000,
              progressPercent: Math.round(progress * 100) / 100,
              solToGraduation: Math.round((GRADUATION_SOL_THRESHOLD - solReserves) * 10000) / 10000,
              createdAt: new Date(c.created_timestamp).toISOString(),
              pumpUrl: `https://pump.fun/coin/${c.mint}`,
            };
          })
          .filter((t) => t.progressPercent >= threshold)
          .sort((a, b) => b.progressPercent - a.progressPercent)
          .slice(0, maxResults);

        const result = {
          count: graduating.length,
          graduationThreshold: `${GRADUATION_SOL_THRESHOLD} SOL`,
          tokens: graduating,
        };

        cache.set(cacheKey, result, CACHE_TTL.volatile);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
