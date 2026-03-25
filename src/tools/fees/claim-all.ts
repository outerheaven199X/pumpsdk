/** pump_claim_all_fees — Batch claim creator fees for multiple tokens at once. */

import { z } from "zod";
import { Buffer } from "node:buffer";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { portalPostBinary } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { createSigningSession } from "../../signing/serve.js";

const inputSchema = {
  userPublicKey: z.string().describe("Creator's Base58 wallet public key"),
  mints: z.array(z.string()).describe("Array of token mint addresses to claim fees for"),
  pool: z.enum(["pump", "meteora-dbc"]).optional().describe("Pool type (default: pump)"),
  priorityFee: z.number().optional().describe("Priority fee in SOL per transaction (default: 0.000001)"),
};

/**
 * Register the pump_claim_all_fees tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerClaimAllFees(server: McpServer) {
  server.tool(
    "pump_claim_all_fees",
    "Batch claim accumulated creator fees for multiple Pump.fun tokens. Builds one transaction per token and opens a signing page to sign all at once.",
    inputSchema,
    async ({ userPublicKey, mints, pool, priorityFee }) => {
      try {
        requireValidAddress(userPublicKey, "userPublicKey");
        if (mints.length === 0) throw new Error("No mints provided");

        for (const mint of mints) {
          requireValidAddress(mint, `mint (${mint})`);
        }

        const transactions: string[] = [];
        const errors: string[] = [];

        for (const mint of mints) {
          try {
            const txBytes = await portalPostBinary("/trade-local", {
              action: "collectCreatorFee",
              publicKey: userPublicKey,
              mint,
              pool: pool ?? "pump",
              priorityFee: priorityFee ?? 0.000001,
            });
            transactions.push(Buffer.from(txBytes).toString("base64"));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${mint}: ${msg}`);
          }
        }

        if (transactions.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ error: "No claimable fees found", details: errors }, null, 2),
              },
            ],
          };
        }

        const signingUrl = await createSigningSession(transactions, `Claim fees for ${transactions.length} token(s)`, {
          action: "Batch Claim",
          tokens: `${transactions.length} of ${mints.length}`,
          pool: pool ?? "pump",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  signingUrl,
                  claimableCount: transactions.length,
                  failedCount: errors.length,
                  errors: errors.length > 0 ? errors : undefined,
                  instructions: "Open the signing URL to sign all claim transactions at once.",
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
