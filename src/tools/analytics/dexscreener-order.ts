/** pump_dexscreener_orders — Check active boost orders for a token on DexScreener. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { dexGet } from "../../client/dexscreener-rest.js";

interface BoostOrder {
  type: string;
  status: string;
  paymentTimestamp: number;
}

const inputSchema = {
  mint: z.string().describe("Token mint address to check boost orders for"),
};

/**
 * Register the pump_dexscreener_orders tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerDexscreenerOrders(server: McpServer) {
  server.tool(
    "pump_dexscreener_orders",
    "Check active DexScreener boost orders for a token. Shows order type, status, and payment details.",
    inputSchema,
    async ({ mint }) => {
      try {
        const orders = await dexGet<BoostOrder[]>(`/orders/v1/solana/${mint}`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  mint,
                  orders: orders.map((o) => ({
                    type: o.type,
                    status: o.status,
                    paymentTime: o.paymentTimestamp ? new Date(o.paymentTimestamp).toISOString() : null,
                  })),
                  totalOrders: orders.length,
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
