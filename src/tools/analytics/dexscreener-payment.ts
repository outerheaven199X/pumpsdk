/** pump_dexscreener_profile — Get DexScreener token profile (social links, header, description). */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { dexGet } from "../../client/dexscreener-rest.js";

interface TokenProfile {
  url: string;
  chainId: string;
  tokenAddress: string;
  icon: string | null;
  header: string | null;
  description: string | null;
  links: Array<{ type: string; label: string; url: string }>;
}

const inputSchema = {
  mint: z.string().describe("Token mint address to fetch DexScreener profile for"),
};

/**
 * Register the pump_dexscreener_profile tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerDexscreenerProfile(server: McpServer) {
  server.tool(
    "pump_dexscreener_profile",
    "Get a token's DexScreener profile including social links, header image, and description.",
    inputSchema,
    async ({ mint }) => {
      try {
        const profiles = await dexGet<TokenProfile[]>(`/token-profiles/latest/v1`);
        const match = profiles.find((p) => p.chainId === "solana" && p.tokenAddress === mint);

        if (!match) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    found: false,
                    mint,
                    message: "No DexScreener profile found for this token.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  found: true,
                  mint,
                  url: match.url,
                  icon: match.icon,
                  header: match.header,
                  description: match.description,
                  links: match.links,
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
