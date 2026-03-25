/** pump_tool_catalog — List all available tools grouped by domain. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";

const TOOL_CATALOG = {
  trading: [
    { name: "pump_quote", description: "Get buy/sell price quotes using bonding curve math" },
    { name: "pump_trade", description: "Build unsigned swap transactions" },
    { name: "pump_open_signing_page", description: "Open a signing page for pre-built transactions" },
  ],
  tokens: [
    { name: "pump_launch", description: "Upload metadata to IPFS and launch a new token" },
    { name: "pump_open_launch_page", description: "Open launch page with pre-prepared metadata" },
    { name: "pump_metadata", description: "Fetch token metadata (name, symbol, supply, etc.)" },
    { name: "pump_new_mints", description: "List recently created tokens" },
    { name: "pump_launch_feed", description: "Browse recent launches with bonding curve progress" },
    { name: "pump_creator_tokens", description: "Find all tokens created by a wallet" },
  ],
  fees: [
    { name: "pump_claim_fees", description: "Claim creator fees for a single token" },
    { name: "pump_claim_all_fees", description: "Batch claim fees for multiple tokens" },
    { name: "pump_claimable_positions", description: "Check for unclaimed fee positions" },
    { name: "pump_fee_config", description: "Read fee sharing configuration for a token" },
  ],
  analytics: [
    { name: "pump_top_tokens", description: "Top tokens by market cap" },
    { name: "pump_latest_trades", description: "Recent trades (platform-wide or per-token)" },
    { name: "pump_token_holders", description: "Top holders of a token" },
    { name: "pump_bonding_curve_status", description: "Bonding curve progress and graduation analysis" },
  ],
  stream: [
    { name: "pump_stream_new_mints", description: "Real-time new token creation events (WebSocket)" },
    { name: "pump_stream_trades", description: "Real-time trade events for a token (WebSocket)" },
    { name: "pump_graduation_watch", description: "Tokens closest to graduating the bonding curve" },
  ],
  solana: [
    { name: "pump_wallet_balance", description: "Check SOL balance of a wallet" },
    { name: "pump_token_holdings", description: "List all SPL token holdings" },
    { name: "pump_send_transaction", description: "Broadcast a signed transaction" },
  ],
  scout: [
    { name: "pump_scout_scan", description: "Scan trends and generate launch packages" },
    { name: "pump_scout_launch", description: "Launch a token from a scout package" },
    { name: "pump_generate_token_image", description: "Generate a token logo with AI" },
  ],
  meta: [{ name: "pump_tool_catalog", description: "This tool — list all available tools" }],
};

const TOTAL_TOOLS = Object.values(TOOL_CATALOG).reduce((sum, group) => sum + group.length, 0);

const inputSchema = {
  domain: z
    .string()
    .optional()
    .describe("Filter by domain: trading, tokens, fees, analytics, stream, solana, scout, meta (omit for all)"),
};

/**
 * Register the pump_tool_catalog tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerToolCatalog(server: McpServer) {
  server.tool(
    "pump_tool_catalog",
    `List all ${TOTAL_TOOLS} available PumpFun MCP tools grouped by domain. Use this to discover what operations are available.`,
    inputSchema,
    async ({ domain }) => {
      try {
        if (domain) {
          const group = TOOL_CATALOG[domain as keyof typeof TOOL_CATALOG];
          if (!group) {
            const domains = Object.keys(TOOL_CATALOG).join(", ");
            throw new Error(`Unknown domain '${domain}'. Available: ${domains}`);
          }
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ domain, count: group.length, tools: group }, null, 2),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ totalTools: TOTAL_TOOLS, catalog: TOOL_CATALOG }, null, 2),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
