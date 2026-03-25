/** pump_pool — Get detailed info for a single Pump.fun token pool. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { pumpGet } from "../../client/pump-rest.js";
import { lamportsToSol } from "../../utils/formatting.js";

const GRADUATION_SOL_THRESHOLD = 85;

interface CoinData {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  market_cap: number;
  complete: boolean;
  raydium_pool: string | null;
  creator: string;
  created_timestamp: number;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
}

const inputSchema = {
  mint: z.string().describe("Token mint address"),
};

/**
 * Register the pump_pool tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerPool(server: McpServer) {
  server.tool(
    "pump_pool",
    "Get detailed information about a specific Pump.fun token pool including bonding curve status, reserves, and graduation progress.",
    inputSchema,
    async ({ mint }) => {
      try {
        const coin = await pumpGet<CoinData>(`/coins/${mint}`);
        const solReserves = lamportsToSol(coin.virtual_sol_reserves);
        const progress = Math.min((solReserves / GRADUATION_SOL_THRESHOLD) * 100, 100);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  mint: coin.mint,
                  name: coin.name,
                  symbol: coin.symbol,
                  description: coin.description,
                  imageUri: coin.image_uri,
                  creator: coin.creator,
                  marketCap: coin.market_cap,
                  solReserves: Number(solReserves.toFixed(4)),
                  tokenReserves: coin.virtual_token_reserves,
                  graduationProgress: Number(progress.toFixed(1)),
                  graduated: coin.complete,
                  raydiumPool: coin.raydium_pool,
                  socials: {
                    twitter: coin.twitter,
                    telegram: coin.telegram,
                    website: coin.website,
                  },
                  createdAt: new Date(coin.created_timestamp).toISOString(),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
