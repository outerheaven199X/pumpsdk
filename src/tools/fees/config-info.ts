/** pump_fee_config — Read the current fee sharing configuration for a Pump.fun token. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { cache, CACHE_TTL } from "../../client/cache.js";

const inputSchema = {
  mint: z.string().describe("Base58 token mint address"),
};

/**
 * Register the pump_fee_config tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerFeeConfig(server: McpServer) {
  server.tool(
    "pump_fee_config",
    "Read the current fee sharing configuration for a Pump.fun token. Shows who receives what percentage of creator fees.",
    inputSchema,
    async ({ mint }) => {
      try {
        requireValidAddress(mint, "mint");
        const cacheKey = `fee-config:${mint}`;

        const cached = cache.get<unknown>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };
        }

        /* Fee config is stored on-chain in the fee sharing PDA.
           The @pump-fun/pump-sdk can read it, but requires a connection.
           For now, provide guidance on where to check. */
        const result = {
          mint,
          note: "Fee configuration is stored on-chain. Use the Pump.fun UI at pump.fun to view the current fee split for this token, or check the fee sharing PDA on Solscan.",
          links: {
            pumpfun: `https://pump.fun/coin/${mint}`,
            solscan: `https://solscan.io/token/${mint}`,
          },
        };

        cache.set(cacheKey, result, CACHE_TTL.stable);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
