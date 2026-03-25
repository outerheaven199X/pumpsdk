/** pump_stream_new_mints — Subscribe to real-time new token creation events via WebSocket. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpWs } from "../../client/pump-ws.js";
import { mcpError } from "../../utils/errors.js";
import { truncateAddress } from "../../utils/formatting.js";

const inputSchema = {
  limit: z.number().optional().describe("Number of recent events to return (default: 10, max: 50)"),
};

/**
 * Register the pump_stream_new_mints tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerStreamNewMints(server: McpServer) {
  server.tool(
    "pump_stream_new_mints",
    "Get real-time new token creation events from Pump.fun via WebSocket. Returns the most recent events from the live stream. Automatically subscribes on first call.",
    inputSchema,
    async ({ limit }) => {
      try {
        if (!pumpWs.connected) {
          pumpWs.connect();
          pumpWs.subscribeNewTokens();
          /* Give the connection a moment to establish */
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } else {
          pumpWs.subscribeNewTokens();
        }

        const maxResults = Math.min(limit ?? 10, 50);
        const events = pumpWs.recentTokens.slice(-maxResults).reverse();

        const tokens = events.map((e) => ({
          mint: e.mint,
          name: e.name,
          symbol: e.symbol,
          creator: truncateAddress(e.traderPublicKey),
          initialBuy: e.initialBuy,
          uri: e.uri,
          timestamp: new Date(e.timestamp).toISOString(),
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  connected: pumpWs.connected,
                  count: tokens.length,
                  tokens,
                  note:
                    tokens.length === 0
                      ? "Stream just started — call again in a few seconds to see new mints."
                      : undefined,
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
