/** pump_open_launch_page — Open a multi-phase launch page when metadata is already prepared. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { createLaunchSession } from "../../signing/serve.js";

const inputSchema = {
  metadataUri: z.string().describe("IPFS metadata URI for the token"),
  tokenName: z.string().describe("Token name"),
  tokenSymbol: z.string().describe("Token ticker symbol"),
  claimersArray: z
    .array(z.string())
    .describe("Wallet addresses for fee claimers (use '__CONNECTED_WALLET__' for the deployer)"),
  basisPointsArray: z.array(z.number()).describe("BPS allocations per claimer (must sum to 10000)"),
  initialBuySol: z.number().optional().describe("Initial dev buy in SOL (default: 0)"),
  slippage: z.number().optional().describe("Slippage tolerance percentage (default: 10)"),
  priorityFee: z.number().optional().describe("Priority fee in SOL (default: 0.0005)"),
};

/**
 * Register the pump_open_launch_page tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerOpenLaunchPage(server: McpServer) {
  server.tool(
    "pump_open_launch_page",
    "Open a multi-phase launch page for a token with pre-prepared metadata. The user connects their wallet, signs fee config, then signs the launch transaction.",
    inputSchema,
    async ({
      metadataUri,
      tokenName,
      tokenSymbol,
      claimersArray,
      basisPointsArray,
      initialBuySol,
      slippage,
      priorityFee,
    }) => {
      try {
        if (claimersArray.length !== basisPointsArray.length) {
          throw new Error("claimersArray and basisPointsArray must have the same length");
        }

        const launchUrl = await createLaunchSession({
          metadataUri,
          tokenName,
          tokenSymbol,
          claimersArray,
          basisPointsArray,
          initialBuySol: initialBuySol ?? 0,
          slippage: slippage ?? 10,
          priorityFee: priorityFee ?? 0.0005,
          description: `Launch $${tokenSymbol} on Pump.fun`,
          meta: {
            Name: tokenName,
            Symbol: tokenSymbol.toUpperCase(),
            "Initial Buy": `${initialBuySol ?? 0} SOL`,
          },
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  launchUrl,
                  tokenName,
                  tokenSymbol,
                  instructions:
                    "Open the launch URL in your browser. Connect your wallet, sign the fee config, then sign the launch transaction.",
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
