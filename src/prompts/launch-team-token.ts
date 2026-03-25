/** pump_launch_team_token — Guided multi-party token launch with fee splits. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the pump_launch_team_token prompt.
 * @param server - The McpServer instance.
 */
export function registerLaunchTeamTokenPrompt(server: McpServer): void {
  server.prompt(
    "pump_launch_team_token",
    "Launch a token with multiple team members sharing creator fees",
    {},
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to launch a token with a team, where multiple wallets share creator fees.

Walk me through it:
1. Collect token details (name, symbol, description, image)
2. Ask how many team members will share fees
3. For each member, ask for their wallet address and what percentage they get
4. Validate that percentages add up to 100%
5. Ask about initial buy amount
6. Show a summary with the fee split breakdown
7. After confirmation, launch with the fee split configured

Fee splits: max 10 shareholders, must total 100%. Use 'self' for my wallet (resolved when I connect).
Keep it conversational. Handle the basis-points math silently.`,
          },
        },
      ],
    }),
  );
}
