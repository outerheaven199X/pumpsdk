/** pump_new_mints — Get recently minted Pump.fun token addresses. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";

interface CoinEntry {
  mint: string;
  name: string;
  symbol: string;
  [key: string]: unknown;
}

const inputSchema = {
  limit: z.number().optional().describe("Max tokens to return (default 5, max 20)"),
};

/**
 * Register the pump_new_mints tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerNewMints(server: McpServer) {
  server.tool(
    "pump_new_mints",
    "Get recently minted Pump.fun token addresses. Returns up to 20 of the newest token mint addresses.",
    inputSchema,
    async ({ limit }) => {
      try {
        const cap = Math.min(limit ?? 5, 20);
        const coins = await pumpGet<CoinEntry[]>("/coins", {
          offset: "0",
          limit: String(cap),
          sort: "created_timestamp",
          order: "DESC",
          includeNsfw: "false",
        });

        const mints = Array.isArray(coins) ? coins.map((c) => c.mint) : [];

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  count: mints.length,
                  mints,
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
