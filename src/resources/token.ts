/** pump://token/{mint} — Token metadata, bonding curve status, and recent trades. */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../client/pump-rest.js";
import { cache, CACHE_TTL } from "../client/cache.js";
import { lamportsToSol } from "../utils/formatting.js";

const GRADUATION_SOL_THRESHOLD = 85;

interface CoinData {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  complete: boolean;
  raydium_pool: string | null;
  market_cap: number;
  created_timestamp: number;
}

/**
 * Register the pump://token/{mint} resource template on the given MCP server.
 * @param server - The McpServer instance.
 */
export function registerTokenResource(server: McpServer): void {
  server.resource(
    "token",
    new ResourceTemplate("pump://token/{mint}", { list: undefined }),
    { description: "Detailed token metadata including bonding curve status", mimeType: "application/json" },
    async (uri, params) => {
      const mint = String(params.mint);
      const cacheKey = `resource:token:${mint}`;
      const cached = cache.get<string>(cacheKey);
      if (cached) return { contents: [{ uri: uri.href, text: cached, mimeType: "application/json" }] };

      const coin = await pumpGet<CoinData>(`/coins/${mint}`);
      const solReserves = lamportsToSol(coin.virtual_sol_reserves);
      const progress = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);

      const data = {
        mint: coin.mint,
        name: coin.name,
        symbol: coin.symbol,
        description: coin.description,
        imageUri: coin.image_uri,
        marketCap: coin.market_cap,
        bondingCurve: {
          solReserves,
          tokenReserves: coin.virtual_token_reserves,
          progressPercent: Math.round(progress * 100) / 100,
          graduated: coin.complete,
          raydiumPool: coin.raydium_pool,
        },
        createdAt: new Date(coin.created_timestamp).toISOString(),
        links: {
          pumpfun: `https://pump.fun/coin/${coin.mint}`,
          solscan: `https://solscan.io/token/${coin.mint}`,
        },
      };

      const text = JSON.stringify(data, null, 2);
      cache.set(cacheKey, text, CACHE_TTL.volatile);
      return { contents: [{ uri: uri.href, text, mimeType: "application/json" }] };
    },
  );
}
