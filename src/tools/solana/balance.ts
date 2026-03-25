/** pump_wallet_balance — Check SOL balance for a Solana wallet. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { lamportsToSol, formatSol } from "../../utils/formatting.js";

const inputSchema = {
  wallet: z.string().describe("Base58 Solana wallet address"),
};

/**
 * Register the pump_wallet_balance tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerWalletBalance(server: McpServer) {
  server.tool(
    "pump_wallet_balance",
    "Check the SOL balance of a Solana wallet address.",
    inputSchema,
    async ({ wallet }) => {
      try {
        requireValidAddress(wallet, "wallet");

        const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getBalance",
            params: [wallet],
          }),
        });

        const data = (await res.json()) as { result?: { value: number }; error?: { message: string } };
        if (data.error) throw new Error(data.error.message);

        const lamports = data.result?.value ?? 0;
        const sol = lamportsToSol(lamports);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ wallet, lamports, sol, display: formatSol(sol) }, null, 2),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
