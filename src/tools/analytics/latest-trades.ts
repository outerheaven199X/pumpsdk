/** pump_latest_trades — Get recent trades via the WebSocket stream (REST trades API is unavailable on v3). */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpWs } from "../../client/pump-ws.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { lamportsToSol, truncateAddress } from "../../utils/formatting.js";

const inputSchema = {
  mint: z.string().optional().describe("Filter trades by token mint address (subscribes to that token's trades)"),
  limit: z.number().optional().describe("Number of recent trades to return (default: 10, max: 50)"),
};

/**
 * Register the pump_latest_trades tool on the given MCP server.
 * Uses the PumpPortal WebSocket for real-time trades since the Pump.fun v3 REST API
 * does not expose a /trades endpoint.
 * @param server - The McpServer instance to register on.
 */
export function registerLatestTrades(server: McpServer) {
  server.tool(
    "pump_latest_trades",
    "Get recent trades on Pump.fun via real-time WebSocket stream. Optionally filter by token mint. Auto-subscribes on first call.",
    inputSchema,
    async ({ mint, limit }) => {
      try {
        if (mint) requireValidAddress(mint, "mint");
        const maxResults = Math.min(limit ?? 10, 50);

        if (!pumpWs.connected) {
          pumpWs.connect();
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        if (mint) {
          pumpWs.subscribeTokenTrades(mint);
        }

        const events = mint ? pumpWs.recentTrades.filter((e) => e.mint === mint) : pumpWs.recentTrades;

        const recent = events.slice(-maxResults).reverse();

        const trades = recent.map((e) => ({
          signature: e.signature,
          mint: e.mint,
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
                  connected: pumpWs.connected,
                  count: trades.length,
                  trades,
                  note:
                    trades.length === 0
                      ? "WebSocket stream active — trades will appear as they happen. Call again shortly."
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
