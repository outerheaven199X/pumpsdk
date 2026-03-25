/** pump_scout_launch — Launch a token from a scout-generated package. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { WALLET_PLACEHOLDER, IPFS_UPLOAD_URL } from "../../utils/constants.js";
import { createLaunchSession } from "../../signing/serve.js";

const FULL_BPS = 10_000;

interface IpfsResponse {
  metadataUri: string;
}

const inputSchema = {
  name: z.string().describe("Token name from scout package"),
  symbol: z.string().describe("Token symbol from scout package"),
  description: z.string().describe("Token description from scout package"),
  imageUrl: z.string().describe("Generated image URL for the token"),
  initialBuySol: z.number().optional().describe("Initial buy in SOL (default: 0)"),
  slippage: z.number().optional().describe("Slippage percentage (default: 10)"),
};

/**
 * Register the pump_scout_launch tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerScoutLaunch(server: McpServer) {
  server.tool(
    "pump_scout_launch",
    "Launch a token from a scout-generated package. Uploads the image and metadata to IPFS, then opens the launch page.",
    inputSchema,
    async ({ name, symbol, description, imageUrl, initialBuySol, slippage }) => {
      try {
        const imgRes = await fetch(imageUrl);
        if (!imgRes.ok) throw new Error(`Failed to download image: HTTP ${imgRes.status}`);
        const blob = await imgRes.blob();

        const form = new FormData();
        form.append("file", blob, "token-image.png");
        form.append("name", name);
        form.append("symbol", symbol);
        form.append("description", description);
        form.append("showName", "true");

        const ipfsRes = await fetch(IPFS_UPLOAD_URL, { method: "POST", body: form });
        if (!ipfsRes.ok) {
          const text = await ipfsRes.text().catch(() => ipfsRes.statusText);
          throw new Error(`IPFS upload failed: HTTP ${ipfsRes.status}: ${text}`);
        }

        const { metadataUri } = (await ipfsRes.json()) as IpfsResponse;

        const launchUrl = await createLaunchSession({
          metadataUri,
          tokenName: name,
          tokenSymbol: symbol,
          claimersArray: [WALLET_PLACEHOLDER],
          basisPointsArray: [FULL_BPS],
          initialBuySol: initialBuySol ?? 0,
          slippage: slippage ?? 10,
          priorityFee: 0.0005,
          description: `Scout launch: $${symbol}`,
          meta: { Name: name, Symbol: symbol.toUpperCase() },
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
                  instructions: "Open the launch URL to connect your wallet and sign the launch transaction.",
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
