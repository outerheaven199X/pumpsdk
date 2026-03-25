/** pump_launch — Upload metadata to IPFS and open a multi-phase launch page for Pump.fun. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { WALLET_PLACEHOLDER } from "../../utils/constants.js";
import { createLaunchSession } from "../../signing/serve.js";
import { uploadToIpfs } from "../../client/ipfs.js";

const BPS_PER_PERCENT = 100;
const FULL_BPS = 10_000;

const inputSchema = {
  name: z.string().describe("Token name (max 32 chars)"),
  symbol: z.string().describe("Token ticker symbol"),
  description: z.string().describe("Token description"),
  imageUrl: z.string().describe("Public URL for the token image"),
  initialBuySol: z.number().optional().describe("Initial dev buy amount in SOL (default: 0)"),
  slippage: z.number().optional().describe("Slippage tolerance percentage (default: 10)"),
  priorityFee: z.number().optional().describe("Priority fee in SOL (default: 0.0005)"),
  twitter: z.string().optional().describe("Twitter/X URL"),
  telegram: z.string().optional().describe("Telegram URL"),
  website: z.string().optional().describe("Project website URL"),
  feeSplit: z
    .array(
      z.object({
        address: z.string().describe("Wallet address for fee recipient, or 'self' for the deployer"),
        percent: z.number().describe("Percentage of creator fees (1-100)"),
      }),
    )
    .optional()
    .describe("Fee split configuration. Defaults to 100% to the deployer."),
};

/**
 * Convert a feeSplit array into claimers and BPS arrays.
 * 'self' addresses are replaced with WALLET_PLACEHOLDER for resolution at connect time.
 * @param feeSplit - Array of address/percent pairs.
 * @returns Claimers array and basis points array.
 */
function resolveFeeSplit(feeSplit?: Array<{ address: string; percent: number }>): {
  claimersArray: string[];
  basisPointsArray: number[];
} {
  if (!feeSplit || feeSplit.length === 0) {
    return {
      claimersArray: [WALLET_PLACEHOLDER],
      basisPointsArray: [FULL_BPS],
    };
  }

  const claimersArray: string[] = [];
  const basisPointsArray: number[] = [];

  for (const entry of feeSplit) {
    const addr = entry.address === "self" ? WALLET_PLACEHOLDER : entry.address;
    claimersArray.push(addr);
    basisPointsArray.push(entry.percent * BPS_PER_PERCENT);
  }

  return { claimersArray, basisPointsArray };
}

/**
 * Register the pump_launch tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerLaunch(server: McpServer) {
  server.tool(
    "pump_launch",
    "Launch a new token on Pump.fun. Uploads metadata to IPFS, then opens a multi-phase launch page where the user connects their wallet, signs the fee config, and signs the launch transaction.",
    inputSchema,
    async ({
      name,
      symbol,
      description,
      imageUrl,
      initialBuySol,
      slippage,
      priorityFee,
      twitter,
      telegram,
      website,
      feeSplit,
    }) => {
      try {
        const metadataUri = await uploadToIpfs({
          name,
          symbol,
          description,
          imageUrl,
          twitter,
          telegram,
          website,
        });

        const { claimersArray, basisPointsArray } = resolveFeeSplit(feeSplit);

        const launchUrl = await createLaunchSession({
          metadataUri,
          tokenName: name,
          tokenSymbol: symbol,
          claimersArray,
          basisPointsArray,
          initialBuySol: initialBuySol ?? 0,
          slippage: slippage ?? 10,
          priorityFee: priorityFee ?? 0.0005,
          description: `Launch $${symbol} on Pump.fun`,
          meta: {
            Name: name,
            Symbol: symbol.toUpperCase(),
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
                  name,
                  symbol,
                  metadataUri,
                  initialBuySol: initialBuySol ?? 0,
                  instructions:
                    "Open the launch URL in your browser. Connect your wallet, sign the fee config transaction, then sign the launch transaction.",
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
