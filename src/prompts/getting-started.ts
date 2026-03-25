/** pump_getting_started — Onboarding prompt for new users. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the pump_getting_started prompt.
 * @param server - The McpServer instance.
 */
export function registerGettingStarted(server: McpServer): void {
  server.prompt("pump_getting_started", "Onboarding guide for Pump.fun MCP — shows what you can do", {}, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I just connected to PumpFun MCP. Walk me through what I can do.

Show me a short menu:
1. Launch a token — walk me through creating and launching a new token on Pump.fun
2. Check my wallet — show my SOL balance and token holdings
3. Browse launches — see what's trending on Pump.fun right now
4. Watch graduations — find tokens about to graduate the bonding curve
5. Scout mode — find trending topics and auto-generate launch packages

Ask which I'd like to do and guide me step by step. Keep it conversational, no jargon.`,
        },
      },
    ],
  }));
}
