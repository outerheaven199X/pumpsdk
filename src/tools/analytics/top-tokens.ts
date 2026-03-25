/** pump_top_tokens — List trending or top tokens on Pump.fun by market cap or volume. */

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

const inputSchema = {
  sort: z.enum(["market_cap", "created_timestamp"]).optional().describe("Sort field (default: market_cap)"),
  limit: z.number().optional().describe("Number of results (default: 10, max: 50)"),
  includeGraduated: z.boolean().optional().describe("Include tokens that graduated to Raydium (default: false)"),
};

/**
 * Register the pump_top_tokens tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerTopTokens(server: McpServer) {
  server.tool(
    "pump_top_tokens",
    "List top tokens on Pump.fun sorted by market cap or creation time. Shows bonding curve status.",
    inputSchema,
    async ({ sort, limit, includeGraduated }) => {
      try {
        const sortField = sort ?? "market_cap";
        const maxResults = Math.min(limit ?? 10, 50);
        const cacheKey = `top-tokens:${sortField}:${maxResults}`;

        const cached = cache.get<CoinListing[]>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ tokens: cached }, null, 2) }] };
        }

        const coins = await pumpGet<CoinListing[]>("/coins", {
          sort: sortField,
          order: "DESC",
          limit: String(maxResults),
          offset: "0",
          includeNsfw: "false",
        });

        const filtered = includeGraduated ? coins : coins.filter((c) => !c.complete);

        const tokens = filtered.map((c) => ({
          mint: c.mint,
          name: c.name,
          symbol: c.symbol,
          marketCap: c.market_cap,
          solReserves: lamportsToSol(c.virtual_sol_reserves),
          graduated: c.complete,
          raydiumPool: c.raydium_pool,
          createdAt: new Date(c.created_timestamp).toISOString(),
        }));

        cache.set(cacheKey, tokens, CACHE_TTL.moderate);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ count: tokens.length, tokens }, null, 2),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
