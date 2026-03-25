/** pump://graduating — Tokens closest to graduating the bonding curve. */

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
 * Register the pump://graduating resource on the given MCP server.
 * @param server - The McpServer instance.
 */
export function registerGraduatingResource(server: McpServer): void {
  server.resource(
    "graduating",
    "pump://graduating",
    { description: "Tokens closest to graduating the bonding curve (50%+ progress)", mimeType: "application/json" },
    async () => {
      const cacheKey = "resource:graduating";
      const cached = cache.get<string>(cacheKey);
      if (cached) return { contents: [{ uri: "pump://graduating", text: cached, mimeType: "application/json" }] };

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
          return {
            mint: c.mint,
            name: c.name,
            symbol: c.symbol,
            marketCap: c.market_cap,
            solReserves: Math.round(sol * 10000) / 10000,
            progressPercent: Math.round(progress * 100) / 100,
            solToGraduation: Math.round(Math.max(GRADUATION_SOL_THRESHOLD - sol, 0) * 10000) / 10000,
            pumpUrl: `https://pump.fun/coin/${c.mint}`,
          };
        })
        .filter((t) => t.progressPercent >= 50)
        .sort((a, b) => b.progressPercent - a.progressPercent)
        .slice(0, 15);

      const text = JSON.stringify(
        {
          count: graduating.length,
          graduationThreshold: `${GRADUATION_SOL_THRESHOLD} SOL`,
          tokens: graduating,
        },
        null,
        2,
      );

      cache.set(cacheKey, text, CACHE_TTL.volatile);
      return { contents: [{ uri: "pump://graduating", text, mimeType: "application/json" }] };
    },
  );
}
