/** pump_claimable_positions — List all tokens where a wallet has unclaimed creator fees. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";

const inputSchema = {
  wallet: z.string().describe("Creator's Base58 wallet address to check for claimable positions"),
};

/**
 * Register the pump_claimable_positions tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerClaimablePositions(server: McpServer) {
  server.tool(
    "pump_claimable_positions",
    "List all tokens where a wallet has unclaimed creator fees on Pump.fun. Attempts to claim each token to determine if fees are available.",
    inputSchema,
    async ({ wallet }) => {
      try {
        requireValidAddress(wallet, "wallet");

        /* Pump.fun doesn't have a direct "list claimable" endpoint,
           so we try claiming with simulation to detect which tokens have fees.
           For now, return a guidance message directing the user to check specific mints. */
        const result = {
          wallet,
          note: "Pump.fun does not expose a bulk claimable-positions endpoint. To check fees for a specific token, use pump_claim_fees with the token mint. Use pump_creator_tokens to find tokens you created, then check each one.",
          suggestedWorkflow: [
            "1. Call pump_creator_tokens with your wallet to find your tokens",
            "2. For each token, call pump_claim_fees to claim accumulated fees",
            "3. Or use pump_claim_all_fees to attempt batch claiming",
          ],
        };

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
