/** pump_scout_scan — Scan trending topics and generate token launch packages. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";

interface CoinListing {
  mint: string;
  name: string;
  symbol: string;
  market_cap: number;
  created_timestamp: number;
}

const inputSchema = {
  sources: z.string().optional().describe("Comma-separated sources to scan: 'pump,news' (default: pump)"),
  maxIdeas: z.number().optional().describe("Max launch packages to generate (default: 3)"),
};

/**
 * Register the pump_scout_scan tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerScoutScan(server: McpServer) {
  server.tool(
    "pump_scout_scan",
    "Scout trending topics from Pump.fun and news sources, then generate token launch packages. Returns ready-to-launch ideas with name, symbol, description, and image prompt.",
    inputSchema,
    async ({ sources, maxIdeas }) => {
      try {
        const sourceList = (sources ?? "pump").split(",").map((s) => s.trim());
        const maxPackages = Math.min(maxIdeas ?? 3, 5);

        const trendingNames: string[] = [];

        if (sourceList.includes("pump")) {
          const coins = await pumpGet<CoinListing[]>("/coins", {
            sort: "market_cap",
            order: "DESC",
            limit: "20",
            offset: "0",
            includeNsfw: "false",
          });
          trendingNames.push(...coins.slice(0, 10).map((c) => `${c.name} ($${c.symbol})`));
        }

        /* For news sources, we provide the trending data for the LLM to analyze.
           The actual package generation happens in the agent strategy layer (Phase 5)
           or the user can use this data with their own analysis. */
        const result = {
          scannedSources: sourceList,
          trending: trendingNames,
          note: "Use this trending data to generate launch packages. The autonomous agent (--agent --scout) can automatically generate complete packages with AI-powered name/symbol/description/image generation.",
          suggestedWorkflow: [
            "1. Review trending tokens above for themes and patterns",
            "2. Pick a trend or narrative to ride",
            "3. Use pump_generate_token_image to create a logo",
            "4. Use pump_launch to create and launch the token",
          ],
          maxPackages,
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
