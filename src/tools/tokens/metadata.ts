/** pump_metadata — Get token metadata from Pump.fun. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";

const inputSchema = {
  mint: z.string().describe("Base58 token mint address"),
};

/**
 * Register the pump_metadata tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerMetadata(server: McpServer) {
  server.tool(
    "pump_metadata",
    "Get token metadata from Pump.fun including name, symbol, description, image URL, decimals, supply, and authorities.",
    inputSchema,
    async ({ mint }) => {
      try {
        requireValidAddress(mint, "mint");

        const result = await pumpGet<Record<string, unknown>>(`/coins/${mint}`);

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
