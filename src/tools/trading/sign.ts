/** pump_open_signing_page — Open a local signing page for Pump.fun transactions. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { createSigningSession } from "../../signing/serve.js";

const inputSchema = {
  transactions: z.array(z.string()).describe("Base58-encoded unsigned transactions to sign"),
  description: z.string().describe("What the user is signing (shown on the page)"),
  meta: z.record(z.string()).optional().describe("Optional key-value pairs to display as details"),
};

/**
 * Register the pump_open_signing_page tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerOpenSigningPage(server: McpServer) {
  server.tool(
    "pump_open_signing_page",
    "Open a local signing page where the user can connect their wallet and sign Pump.fun transactions. Zero-custody: no private keys are touched.",
    inputSchema,
    async ({ transactions, description, meta }) => {
      try {
        if (transactions.length === 0) {
          throw new Error("No transactions provided");
        }

        const signingUrl = await createSigningSession(transactions, description, meta ?? {});

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  signingUrl,
                  message: `Signing page ready. Direct the user to: ${signingUrl}`,
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
