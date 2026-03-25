/** pump_launch_token — Guided solo token launch workflow. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the pump_launch_token prompt.
 * @param server - The McpServer instance.
 */
export function registerLaunchTokenPrompt(server: McpServer): void {
  server.prompt("pump_launch_token", "Step-by-step guide to launch a new token on Pump.fun", {}, async () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `I want to launch a new token on Pump.fun. Walk me through it step by step.

Collect these details one at a time:
1. Token name (max 32 chars)
2. Token symbol/ticker
3. Description (what's the token about?)
4. Token image — do I have one or need to generate one?
5. Initial buy — how much SOL to buy at launch (can be 0)
6. Optional: Twitter, Telegram, or website links

Once I've provided everything, show me a summary and ask to confirm.
After confirmation, upload to IPFS and open the launch page.

Keep it conversational. No technical jargon. Fee split defaults to 100% to me.`,
        },
      },
    ],
  }));
}
