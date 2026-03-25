/** pump_launch_feed — Browse recent token launches on Pump.fun with rich metadata. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { cache, CACHE_TTL } from "../../client/cache.js";
import { lamportsToSol } from "../../utils/formatting.js";

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  market_cap: number;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  complete: boolean;
  raydium_pool: string | null;
  created_timestamp: number;
}

const GRADUATION_SOL_THRESHOLD = 85;

const inputSchema = {
  limit: z.number().optional().describe("Number of launches to return (default: 10, max: 50)"),
  offset: z.number().optional().describe("Pagination offset (default: 0)"),
};

/**
 * Register the pump_launch_feed tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerLaunchFeed(server: McpServer) {
  server.tool(
    "pump_launch_feed",
    "Browse recent token launches on Pump.fun. Returns name, symbol, market cap, bonding curve progress, and graduation status.",
    inputSchema,
    async ({ limit, offset }) => {
      try {
        const maxResults = Math.min(limit ?? 10, 50);
        const startOffset = offset ?? 0;
        const cacheKey = `launch-feed:${maxResults}:${startOffset}`;

        const cached = cache.get<unknown>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };
        }

        const coins = await pumpGet<CoinListing[]>("/coins", {
          sort: "created_timestamp",
          order: "DESC",
          limit: String(maxResults),
          offset: String(startOffset),
          includeNsfw: "false",
        });

        const launches = coins.map((c) => {
          const solReserves = lamportsToSol(c.virtual_sol_reserves);
          const progress = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);
          return {
            mint: c.mint,
            name: c.name,
            symbol: c.symbol,
            description: c.description.slice(0, 120),
            imageUri: c.image_uri,
            marketCap: c.market_cap,
            bondingCurveProgress: `${Math.round(progress)}%`,
            graduated: c.complete,
            raydiumPool: c.raydium_pool,
            createdAt: new Date(c.created_timestamp).toISOString(),
            pumpUrl: `https://pump.fun/coin/${c.mint}`,
          };
        });

        const result = { count: launches.length, offset: startOffset, launches };
        cache.set(cacheKey, result, CACHE_TTL.moderate);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
