/** pump_relaunch — Relaunch a graduated token with fresh metadata and bonding curve. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { pumpGet } from "../../client/pump-rest.js";
import { uploadToIpfs } from "../../client/ipfs.js";
import { createLaunchSession } from "../../signing/serve.js";
import { WALLET_PLACEHOLDER } from "../../utils/constants.js";

const BPS_PER_PERCENT = 100;
const FULL_BPS = 10_000;
const DEFAULT_NAME_SUFFIX = " v2";

interface CoinData {
  mint: string;
  name: string;
  symbol: string;
  description: string;
  image_uri: string;
  twitter: string | null;
  telegram: string | null;
  website: string | null;
  complete: boolean;
  raydium_pool: string | null;
}

const inputSchema = {
  originalMint: z.string().describe("Mint address of the graduated token to relaunch"),
  nameSuffix: z.string().optional().describe("Suffix for the new token name (default: ' v2')"),
  initialBuySol: z.number().optional().describe("Initial dev buy in SOL (default: 0)"),
  slippage: z.number().optional().describe("Slippage tolerance percentage (default: 10)"),
  priorityFee: z.number().optional().describe("Priority fee in SOL (default: 0.0005)"),
  feeSplit: z
    .array(
      z.object({
        address: z.string().describe("Wallet address or 'self' for deployer"),
        percent: z.number().describe("Percentage of creator fees (1-100)"),
      }),
    )
    .optional()
    .describe("Fee split. Defaults to 100% deployer."),
};

/**
 * Resolve fee split to claimers and BPS arrays.
 * @param feeSplit - User-provided fee split.
 * @returns Claimers and basis points arrays.
 */
function resolveFeeSplit(feeSplit?: Array<{ address: string; percent: number }>): {
  claimersArray: string[];
  basisPointsArray: number[];
} {
  if (!feeSplit || feeSplit.length === 0) {
    return { claimersArray: [WALLET_PLACEHOLDER], basisPointsArray: [FULL_BPS] };
  }
  const claimersArray: string[] = [];
  const basisPointsArray: number[] = [];
  for (const entry of feeSplit) {
    claimersArray.push(entry.address === "self" ? WALLET_PLACEHOLDER : entry.address);
    basisPointsArray.push(entry.percent * BPS_PER_PERCENT);
  }
  return { claimersArray, basisPointsArray };
}

/**
 * Register the pump_relaunch tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerRelaunch(server: McpServer) {
  server.tool(
    "pump_relaunch",
    "Relaunch a graduated token with a fresh bonding curve. Fetches original metadata, appends a version suffix, uploads new metadata to IPFS, and opens a launch page.",
    inputSchema,
    async ({ originalMint, nameSuffix, initialBuySol, slippage, priorityFee, feeSplit }) => {
      try {
        const coin = await pumpGet<CoinData>(`/coins/${originalMint}`);

        if (!coin.complete && !coin.raydium_pool) {
          return mcpError(
            new Error(
              `Token ${coin.name} ($${coin.symbol}) has not graduated yet. ` +
                "Relaunch is only available for tokens that have completed their bonding curve.",
            ),
          );
        }

        const suffix = nameSuffix ?? DEFAULT_NAME_SUFFIX;
        const newName = coin.name + suffix;

        const metadataUri = await uploadToIpfs({
          name: newName,
          symbol: coin.symbol,
          description: coin.description,
          imageUrl: coin.image_uri,
          twitter: coin.twitter ?? undefined,
          telegram: coin.telegram ?? undefined,
          website: coin.website ?? undefined,
        });

        const { claimersArray, basisPointsArray } = resolveFeeSplit(feeSplit);

        const launchUrl = await createLaunchSession({
          metadataUri,
          tokenName: newName,
          tokenSymbol: coin.symbol,
          claimersArray,
          basisPointsArray,
          initialBuySol: initialBuySol ?? 0,
          slippage: slippage ?? 10,
          priorityFee: priorityFee ?? 0.0005,
          description: `Relaunch $${coin.symbol} as ${newName}`,
          meta: {
            Name: newName,
            Symbol: coin.symbol.toUpperCase(),
            "Original Mint": originalMint,
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
                  newName,
                  symbol: coin.symbol,
                  originalMint,
                  metadataUri,
                  instructions:
                    "Open the launch URL to connect your wallet and sign. This creates a fresh bonding curve for the relaunched token.",
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
