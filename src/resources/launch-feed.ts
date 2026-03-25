/** pump://launches — Live feed of recent token launches on Pump.fun. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../client/pump-rest.js";
import { cache, CACHE_TTL } from "../client/cache.js";
import { lamportsToSol } from "../utils/formatting.js";

const GRADUATION_SOL_THRESHOLD = 85;

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  market_cap: number;
  virtual_sol_reserves: number;
  complete: boolean;
  created_timestamp: number;
}

/**
 * Register the pump://launches resource on the given MCP server.
 * @param server - The McpServer instance.
 */
export function registerLaunchFeedResource(server: McpServer): void {
  server.resource(
    "launches",
    "pump://launches",
    { description: "Live feed of the 20 most recent token launches on Pump.fun", mimeType: "application/json" },
    async () => {
      const cacheKey = "resource:launches";
      const cached = cache.get<string>(cacheKey);
      if (cached) return { contents: [{ uri: "pump://launches", text: cached, mimeType: "application/json" }] };

      const coins = await pumpGet<CoinListing[]>("/coins", {
        sort: "created_timestamp",
        order: "DESC",
        limit: "20",
        offset: "0",
        includeNsfw: "false",
      });

      const launches = coins.map((c) => {
        const sol = lamportsToSol(c.virtual_sol_reserves);
        return {
          mint: c.mint,
          name: c.name,
          symbol: c.symbol,
          marketCap: c.market_cap,
          bondingCurveProgress: `${Math.round((sol / GRADUATION_SOL_THRESHOLD) * 100)}%`,
          graduated: c.complete,
          createdAt: new Date(c.created_timestamp).toISOString(),
        };
      });

      const text = JSON.stringify({ count: launches.length, launches }, null, 2);
      cache.set(cacheKey, text, CACHE_TTL.moderate);
      return { contents: [{ uri: "pump://launches", text, mimeType: "application/json" }] };
    },
  );
}
