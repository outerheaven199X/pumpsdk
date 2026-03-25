/** pump_creator_tokens — Find all tokens created by a given wallet address. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { cache, CACHE_TTL } from "../../client/cache.js";
import { lamportsToSol } from "../../utils/formatting.js";

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  market_cap: number;
  virtual_sol_reserves: number;
  complete: boolean;
  raydium_pool: string | null;
  created_timestamp: number;
  creator: string;
}

const GRADUATION_SOL_THRESHOLD = 85;

const inputSchema = {
  wallet: z.string().describe("Creator's Base58 wallet address"),
  limit: z.number().optional().describe("Max results (default: 20, max: 50)"),
};

/**
 * Register the pump_creator_tokens tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerCreatorTokens(server: McpServer) {
  server.tool(
    "pump_creator_tokens",
    "Find all tokens created by a specific wallet address on Pump.fun. Filters the coin feed by the creator field.",
    inputSchema,
    async ({ wallet, limit }) => {
      try {
        requireValidAddress(wallet, "wallet");
        const maxResults = Math.min(limit ?? 20, 50);
        const cacheKey = `creator-tokens:${wallet}:${maxResults}`;

        const cached = cache.get<unknown>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };
        }

        let coins: CoinListing[] = [];
        try {
          coins = await pumpGet<CoinListing[]>(`/coins/user-created-coins/${wallet}`, {
            limit: String(maxResults),
            offset: "0",
          });
        } catch {
          /* The v3 API may not support this endpoint for all wallets.
             Fall back to filtering the general feed by creator. */
          const allCoins = await pumpGet<CoinListing[]>("/coins", {
            sort: "created_timestamp",
            order: "DESC",
            limit: "50",
            offset: "0",
            includeNsfw: "false",
          });
          coins = allCoins.filter((c) => c.creator === wallet);
        }

        const tokens = (coins ?? []).map((c) => {
          const solReserves = lamportsToSol(c.virtual_sol_reserves);
          const progress = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);
          return {
            mint: c.mint,
            name: c.name,
            symbol: c.symbol,
            marketCap: c.market_cap,
            bondingCurveProgress: `${Math.round(progress)}%`,
            graduated: c.complete,
            createdAt: new Date(c.created_timestamp).toISOString(),
            pumpUrl: `https://pump.fun/coin/${c.mint}`,
          };
        });

        const result = { creator: wallet, count: tokens.length, tokens };
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
