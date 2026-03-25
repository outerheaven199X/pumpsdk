/** pump_claim_fees — Build an unsigned transaction to claim creator fees from Pump.fun. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { portalPostBinary } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { createSigningSession } from "../../signing/serve.js";

const inputSchema = {
  mint: z.string().optional().describe("Token mint address (optional for pump pool — claims all fees at once)"),
  pool: z
    .enum(["pump", "meteora-dbc"])
    .optional()
    .describe("Pool type: 'pump' (bonding curve) or 'meteora-dbc' (Meteora). Default: pump"),
  userPublicKey: z.string().describe("Creator's Base58 wallet public key"),
  priorityFee: z.number().optional().describe("Priority fee in SOL (default: 0.000001)"),
};

/**
 * Register the pump_claim_fees tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerClaimFees(server: McpServer) {
  server.tool(
    "pump_claim_fees",
    "Build an unsigned transaction to claim accumulated creator fees from Pump.fun. Opens a signing page for the user to sign with their wallet.",
    inputSchema,
    async ({ mint, pool, userPublicKey, priorityFee }) => {
      try {
        requireValidAddress(userPublicKey, "userPublicKey");
        if (mint) {
          requireValidAddress(mint, "mint");
        }

        const body: Record<string, unknown> = {
          action: "collectCreatorFee",
          publicKey: userPublicKey,
          pool: pool ?? "pump",
          priorityFee: priorityFee ?? 0.000001,
        };
        if (mint) {
          body.mint = mint;
        }

        const txBytes = await portalPostBinary("/trade-local", body);
        const txBase64 = Buffer.from(txBytes).toString("base64");

        const signingUrl = await createSigningSession([txBase64], "Claim creator fees from Pump.fun", {
          action: "Claim Fees",
          pool: pool ?? "pump",
          mint: mint ?? "all tokens",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  signingUrl,
                  action: "collectCreatorFee",
                  pool: pool ?? "pump",
                  mint: mint ?? "all",
                  instructions:
                    "Open the signing URL in your browser. Connect your wallet and sign to claim your creator fees.",
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
