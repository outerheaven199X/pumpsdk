/** pump_claim_all — Guided batch fee claiming workflow. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the pump_claim_all prompt.
 * @param server - The McpServer instance.
 */
export function registerClaimAllPrompt(server: McpServer): void {
  server.prompt("pump_claim_all", "Claim all accumulated creator fees across your Pump.fun tokens", {}, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to claim all my creator fees from Pump.fun.

Steps:
1. Ask for my wallet address
2. Find all tokens I created using pump_creator_tokens
3. For each token, attempt to build a fee claim transaction
4. Bundle all successful claims into one signing session using pump_claim_all_fees
5. Give me one link to sign everything at once

Show me which tokens had claimable fees and which didn't.
If nothing is claimable, tell me that clearly.`,
        },
      },
    ],
  }));
}
