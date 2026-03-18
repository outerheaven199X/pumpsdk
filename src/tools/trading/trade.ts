/** pump_trade — Build an unsigned trade transaction via PumpPortal and open a signing page. */

import { z } from "zod";
import { Buffer } from "node:buffer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { portalPostBinary } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress, requireValidSlippage } from "../../utils/validation.js";
import { createSigningSession } from "../../signing/serve.js";

const inputSchema = {
  trade_type: z.enum(["buy", "sell"]).describe("Trade direction: buy (SOL→token) or sell (token→SOL)"),
  mint: z.string().describe("Base58 token mint address"),
  amount: z.number().describe("SOL amount if buying; token amount if selling"),
  slippage: z.number().describe("Slippage tolerance as integer percentage (e.g. 10 for 10%)"),
  userPublicKey: z.string().describe("Trader's Base58 wallet public key"),
  priorityFee: z.number().optional().describe("Optional priority fee in SOL"),
};

/**
 * Register the pump_trade tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerTrade(server: McpServer) {
  server.tool(
    "pump_trade",
    "Build an unsigned swap transaction for a Pump.fun token and open a signing page. Zero-custody: no private keys needed.",
    inputSchema,
    async ({ trade_type, mint, amount, slippage, userPublicKey, priorityFee }) => {
      try {
        requireValidAddress(mint, "mint");
        requireValidAddress(userPublicKey, "userPublicKey");
        requireValidSlippage(slippage);

        const body: Record<string, unknown> = {
          publicKey: userPublicKey,
          action: trade_type,
          mint,
          amount,
          denominatedInSol: trade_type === "buy" ? "true" : "false",
          slippage,
          priorityFee: priorityFee ?? 0.0001,
          pool: "pump",
        };

        const txBytes = await portalPostBinary("/trade-local", body);
        const txBase64 = Buffer.from(txBytes).toString("base64");

        const label = trade_type === "buy" ? "Buy" : "Sell";
        const signingUrl = createSigningSession(
          [txBase64],
          `${label} token on Pump.fun`,
          {
            action: label,
            mint: mint.slice(0, 8) + "...",
            amount: String(amount),
            slippage: slippage + "%",
          },
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              signingUrl,
              tradeType: trade_type,
              mint,
              amount,
              slippage,
              instructions: "Open the signing URL in your browser. Connect your wallet and sign to execute the trade.",
            }, null, 2),
          }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
