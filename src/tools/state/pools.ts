/** pump_pools — List active token pools from Pump.fun sorted by market cap. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { pumpGet } from "../../client/pump-rest.js";
import { lamportsToSol } from "../../utils/formatting.js";

const DEFAULT_LIMIT = 20;
const GRADUATION_SOL_THRESHOLD = 85;

interface CoinData {
  mint: string;
  name: string;
  symbol: string;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  market_cap: number;
  complete: boolean;
  raydium_pool: string | null;
  created_timestamp: number;
}

const inputSchema = {
  limit: z.number().optional().describe("Number of results (default: 20, max: 50)"),
  includeGraduated: z.boolean().optional().describe("Include graduated tokens (default: false)"),
};

/**
 * Register the pump_pools tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerPools(server: McpServer) {
  server.tool(
    "pump_pools",
    "List active Pump.fun token pools sorted by market cap. Shows bonding curve progress and graduation status.",
    inputSchema,
    async ({ limit, includeGraduated }) => {
      try {
        const count = Math.min(limit ?? DEFAULT_LIMIT, 50);
        const coins = await pumpGet<CoinData[]>("/coins", {
          sort: "market_cap",
          order: "DESC",
          limit: String(count),
          offset: "0",
          includeNsfw: "false",
        });

        const filtered = includeGraduated ? coins : coins.filter((c) => !c.complete);

        const pools = filtered.map((c) => {
          const solReserves = lamportsToSol(c.virtual_sol_reserves);
          const progress = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);
          return {
            mint: c.mint,
            name: c.name,
            symbol: c.symbol,
            marketCap: c.market_cap,
            solReserves: Number(solReserves.toFixed(4)),
            graduationProgress: Number(progress.toFixed(1)),
            graduated: c.complete,
            raydiumPool: c.raydium_pool,
          };
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ pools, count: pools.length }, null, 2),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
