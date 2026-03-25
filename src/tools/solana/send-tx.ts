/** pump_send_transaction — Broadcast a signed transaction to Solana. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";

const inputSchema = {
  transaction: z.string().describe("Base64-encoded signed transaction"),
  skipPreflight: z.boolean().optional().describe("Skip preflight simulation (default: false)"),
};

/**
 * Register the pump_send_transaction tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerSendTransaction(server: McpServer) {
  server.tool(
    "pump_send_transaction",
    "Broadcast a fully signed transaction to the Solana network. Returns the transaction signature.",
    inputSchema,
    async ({ transaction, skipPreflight }) => {
      try {
        const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "sendTransaction",
            params: [transaction, { encoding: "base64", skipPreflight: skipPreflight ?? false }],
          }),
        });

        const data = (await res.json()) as { result?: string; error?: { message: string } };
        if (data.error) throw new Error(data.error.message);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  signature: data.result,
                  explorer: `https://solscan.io/tx/${data.result}`,
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
