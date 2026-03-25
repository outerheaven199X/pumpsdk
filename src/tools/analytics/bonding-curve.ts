/** pump_bonding_curve_status — Analyze bonding curve progress and graduation likelihood. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { cache, CACHE_TTL } from "../../client/cache.js";
import { lamportsToSol } from "../../utils/formatting.js";

/** Approximate SOL threshold where the bonding curve graduates. */
const GRADUATION_SOL_THRESHOLD = 85;

interface CoinData {
  mint: string;
  name: string;
  symbol: string;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  complete: boolean;
  raydium_pool: string | null;
  market_cap: number;
}

const inputSchema = {
  mint: z.string().describe("Base58 token mint address"),
};

/**
 * Register the pump_bonding_curve_status tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerBondingCurveStatus(server: McpServer) {
  server.tool(
    "pump_bonding_curve_status",
    "Analyze a Pump.fun token's bonding curve: current reserves, progress toward graduation, and estimated graduation price. Novel analytics not available elsewhere.",
    inputSchema,
    async ({ mint }) => {
      try {
        requireValidAddress(mint, "mint");
        const cacheKey = `bonding:${mint}`;

        const cached = cache.get<unknown>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };
        }

        const coin = await pumpGet<CoinData>(`/coins/${mint}`);
        const solReserves = lamportsToSol(coin.virtual_sol_reserves);
        const progressPercent = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);
        const solRemaining = Math.max(GRADUATION_SOL_THRESHOLD - solReserves, 0);

        const result = {
          mint: coin.mint,
          name: coin.name,
          symbol: coin.symbol,
          graduated: coin.complete,
          raydiumPool: coin.raydium_pool,
          bondingCurve: {
            virtualSolReserves: solReserves,
            virtualTokenReserves: coin.virtual_token_reserves,
            progressPercent: Math.round(progressPercent * 100) / 100,
            solToGraduation: Math.round(solRemaining * 10000) / 10000,
            graduationThreshold: GRADUATION_SOL_THRESHOLD,
          },
          marketCap: coin.market_cap,
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
