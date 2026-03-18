/** pump_launch — Upload metadata, generate mint keypair, and build a create-token transaction for Pump.fun. */

import { z } from "zod";
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { portalPostBinary } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { createSigningSession } from "../../signing/serve.js";

const IPFS_UPLOAD_URL = "https://pump.fun/api/ipfs";

interface IpfsResponse {
  metadataUri: string;
}

const inputSchema = {
  name: z.string().describe("Token name (max 32 chars)"),
  symbol: z.string().describe("Token ticker symbol"),
  description: z.string().describe("Token description"),
  imageUrl: z.string().describe("Public URL for the token image"),
  userPublicKey: z.string().describe("Creator's Base58 wallet public key"),
  initialBuySol: z.number().optional().describe("Initial dev buy amount in SOL (default: 0)"),
  slippage: z.number().optional().describe("Slippage tolerance percentage (default: 10)"),
  priorityFee: z.number().optional().describe("Priority fee in SOL (default: 0.0005)"),
  twitter: z.string().optional().describe("Twitter/X URL"),
  telegram: z.string().optional().describe("Telegram URL"),
  website: z.string().optional().describe("Project website URL"),
};

/**
 * Download an image from a URL and return it as a Blob with filename.
 * @param url - The public image URL.
 * @returns The image as a Blob.
 */
async function downloadImage(url: string): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download image: HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const ext = url.split(".").pop()?.split("?")[0] ?? "png";
  return { blob, filename: `token-image.${ext}` };
}

/**
 * Upload token metadata and image to Pump.fun's IPFS endpoint.
 * @param params - Token metadata fields.
 * @returns The IPFS metadata URI.
 */
async function uploadToIpfs(params: {
  name: string;
  symbol: string;
  description: string;
  imageUrl: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}): Promise<string> {
  const { blob, filename } = await downloadImage(params.imageUrl);

  const form = new FormData();
  form.append("file", blob, filename);
  form.append("name", params.name);
  form.append("symbol", params.symbol);
  form.append("description", params.description);
  form.append("showName", "true");

  if (params.twitter) form.append("twitter", params.twitter);
  if (params.telegram) form.append("telegram", params.telegram);
  if (params.website) form.append("website", params.website);

  const res = await fetch(IPFS_UPLOAD_URL, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`IPFS upload failed: HTTP ${res.status}: ${text}`);
  }

  const data = (await res.json()) as IpfsResponse;
  return data.metadataUri;
}

/**
 * Fetch the create-token transaction from PumpPortal and partially sign with the mint keypair.
 * @param mintKeypair - The freshly generated mint keypair.
 * @param userPublicKey - The creator's wallet public key.
 * @param metadataUri - IPFS URI from uploadToIpfs.
 * @param params - Token name, symbol, buy amount, slippage, priority fee.
 * @returns Base58-encoded partially-signed transaction (mint keypair signed, user wallet unsigned).
 */
async function buildPartiallySignedCreateTx(
  mintKeypair: Keypair,
  userPublicKey: string,
  metadataUri: string,
  params: { name: string; symbol: string; buySol: number; slippage: number; priorityFee: number },
): Promise<string> {
  const body = {
    publicKey: userPublicKey,
    action: "create",
    tokenMetadata: {
      name: params.name,
      symbol: params.symbol,
      uri: metadataUri,
    },
    mint: mintKeypair.publicKey.toBase58(),
    denominatedInSol: "true",
    amount: params.buySol,
    slippage: params.slippage,
    priorityFee: params.priorityFee,
    pool: "pump",
  };

  const txBytes = await portalPostBinary("/trade-local", body);
  const tx = VersionedTransaction.deserialize(txBytes);

  tx.sign([mintKeypair]);

  const signedBytes = tx.serialize();
  return Buffer.from(signedBytes).toString("base64");
}

/**
 * Register the pump_launch tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerLaunch(server: McpServer) {
  server.tool(
    "pump_launch",
    "Launch a new token on Pump.fun. Uploads metadata to IPFS, generates a mint keypair, builds a partially-signed create transaction, and opens a signing page for the user's wallet signature.",
    inputSchema,
    async ({ name, symbol, description, imageUrl, userPublicKey, initialBuySol, slippage, priorityFee, twitter, telegram, website }) => {
      try {
        requireValidAddress(userPublicKey, "userPublicKey");

        const metadataUri = await uploadToIpfs({
          name, symbol, description, imageUrl,
          twitter, telegram, website,
        });

        const mintKeypair = Keypair.generate();
        const mintAddress = mintKeypair.publicKey.toBase58();

        const partialTx = await buildPartiallySignedCreateTx(
          mintKeypair, userPublicKey, metadataUri,
          {
            name, symbol,
            buySol: initialBuySol ?? 0,
            slippage: slippage ?? 10,
            priorityFee: priorityFee ?? 0.0005,
          },
        );

        const signingUrl = createSigningSession(
          [partialTx],
          `Launch $${symbol} on Pump.fun`,
          { name, symbol, mint: mintAddress, image: imageUrl },
        );

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              signingUrl,
              name,
              symbol,
              mintAddress,
              metadataUri,
              initialBuySol: initialBuySol ?? 0,
              instructions: "Open the signing URL in your browser. Connect your wallet and sign to launch your token on Pump.fun.",
            }, null, 2),
          }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
