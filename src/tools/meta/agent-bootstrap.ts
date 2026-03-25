/** pump_agent_bootstrap — Initialize agent mode by verifying wallet and environment. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { isValidSolanaAddress } from "../../utils/validation.js";

const inputSchema = {
  walletOverride: z.string().optional().describe("Override the agent wallet (defaults to PUMP_AGENT_WALLET env var)"),
};

/**
 * Register the pump_agent_bootstrap tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerAgentBootstrap(server: McpServer) {
  server.tool(
    "pump_agent_bootstrap",
    "Initialize agent mode. Verifies the agent wallet from environment variables and checks API key availability for autonomous operations.",
    inputSchema,
    async ({ walletOverride }) => {
      try {
        const wallet = walletOverride || process.env.PUMP_AGENT_WALLET;
        if (!wallet) {
          return mcpError(
            new Error(
              "No agent wallet configured. Set PUMP_AGENT_WALLET environment variable " +
                "or provide a walletOverride parameter.",
            ),
          );
        }

        if (!isValidSolanaAddress(wallet)) {
          return mcpError(new Error(`Invalid wallet address: ${wallet}`));
        }

        const hasNousKey = !!process.env.NOUS_API_KEY;
        const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
        const hasImageGen = !!(process.env.FAL_API_KEY || process.env.REPLICATE_API_KEY);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  agentReady: true,
                  wallet,
                  capabilities: {
                    hermes: hasNousKey,
                    sonnet: hasAnthropicKey,
                    imageGeneration: hasImageGen,
                  },
                  availableStrategies: [
                    hasNousKey ? "auto-claim" : null,
                    hasNousKey ? "launch-monitor" : null,
                    hasNousKey ? "graduation-watch" : null,
                    hasAnthropicKey ? "scout" : null,
                    hasAnthropicKey ? "fee-optimizer" : null,
                    hasNousKey ? "sniper" : null,
                  ].filter(Boolean),
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
