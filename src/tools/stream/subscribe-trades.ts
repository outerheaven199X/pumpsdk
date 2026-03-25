/** pump_stream_trades — Subscribe to real-time trade events for a specific token. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpWs } from "../../client/pump-ws.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { lamportsToSol, truncateAddress } from "../../utils/formatting.js";

const inputSchema = {
  mint: z.string().describe("Token mint address to watch for trades"),
  limit: z.number().optional().describe("Number of recent trade events to return (default: 10, max: 50)"),
};

/**
 * Register the pump_stream_trades tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerStreamTrades(server: McpServer) {
  server.tool(
    "pump_stream_trades",
    "Subscribe to real-time trade events for a specific Pump.fun token via WebSocket. Returns recent trades from the live stream.",
    inputSchema,
    async ({ mint, limit }) => {
      try {
        requireValidAddress(mint, "mint");

        if (!pumpWs.connected) {
          pumpWs.connect();
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        pumpWs.subscribeTokenTrades(mint);

        const maxResults = Math.min(limit ?? 10, 50);
        const events = pumpWs.recentTrades
          .filter((e) => e.mint === mint)
          .slice(-maxResults)
          .reverse();

        const trades = events.map((e) => ({
          signature: e.signature,
          type: e.txType,
          trader: truncateAddress(e.traderPublicKey),
          solAmount: lamportsToSol(e.solAmount),
          tokenAmount: e.tokenAmount,
          timestamp: new Date(e.timestamp).toISOString(),
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  mint,
                  connected: pumpWs.connected,
                  count: trades.length,
                  trades,
                  note: trades.length === 0 ? "Subscribed — call again to see incoming trades." : undefined,
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
