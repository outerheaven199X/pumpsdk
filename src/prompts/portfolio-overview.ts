/** pump_portfolio_overview — Wallet and portfolio analysis prompt. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the pump_portfolio_overview prompt.
 * @param server - The McpServer instance.
 */
export function registerPortfolioOverviewPrompt(server: McpServer): void {
  server.prompt(
    "pump_portfolio_overview",
    "Full overview of your wallet: SOL balance, token holdings, and created tokens",
    {},
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Give me a full overview of my Pump.fun portfolio.

Steps:
1. Ask for my wallet address
2. Check my SOL balance with pump_wallet_balance
3. List my token holdings with pump_token_holdings
4. Find tokens I created with pump_creator_tokens
5. For created tokens, check bonding curve status

Present everything in a clean summary:
- SOL balance
- Token holdings (sorted by value if possible)
- Created tokens with their bonding curve progress
- Any tokens close to graduating

Keep it concise and scannable.`,
          },
        },
      ],
    }),
  );
}
