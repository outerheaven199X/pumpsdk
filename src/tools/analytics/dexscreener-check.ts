/** pump_dexscreener_check — Check DexScreener listing and boost status for a Pump.fun token. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { dexGet } from "../../client/dexscreener-rest.js";

interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: { address: string; name: string; symbol: string };
  priceUsd: string;
  volume: { h24: number };
  liquidity: { usd: number };
  fdv: number;
  url: string;
}

interface DexResponse {
  pairs: DexPair[] | null;
}

const inputSchema = {
  mint: z.string().describe("Token mint address to check on DexScreener"),
};

/**
 * Register the pump_dexscreener_check tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerDexscreenerCheck(server: McpServer) {
  server.tool(
    "pump_dexscreener_check",
    "Check if a Pump.fun token is listed on DexScreener and get its trading data (price, volume, liquidity, FDV).",
    inputSchema,
    async ({ mint }) => {
      try {
        const data = await dexGet<DexResponse>(`/latest/dex/tokens/${mint}`);
        const pairs = data.pairs ?? [];

        if (pairs.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    listed: false,
                    mint,
                    message: "Token not yet listed on DexScreener. It may appear after graduation to Raydium.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const primary = pairs[0];
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  listed: true,
                  mint,
                  pairAddress: primary.pairAddress,
                  dex: primary.dexId,
                  priceUsd: primary.priceUsd,
                  volume24h: primary.volume.h24,
                  liquidityUsd: primary.liquidity.usd,
                  fdv: primary.fdv,
                  url: primary.url,
                  totalPairs: pairs.length,
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
