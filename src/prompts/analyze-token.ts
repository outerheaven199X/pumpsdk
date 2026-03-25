/** pump_analyze_token — Guided token analysis: bonding curve, holders, trades. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Register the pump_analyze_token prompt.
 * @param server - The McpServer instance.
 */
export function registerAnalyzeTokenPrompt(server: McpServer): void {
  server.prompt(
    "pump_analyze_token",
    "Deep analysis of a Pump.fun token: bonding curve, holders, trade activity",
    {},
    async () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to analyze a Pump.fun token in depth.

Steps:
1. Ask for the token mint address (or search by name/symbol)
2. Fetch metadata with pump_metadata
3. Check bonding curve status with pump_bonding_curve_status
4. Get top holders with pump_token_holders
5. Check recent trades with pump_latest_trades for that token
6. Subscribe to real-time trades with pump_stream_trades

Present a comprehensive analysis:
- Token overview (name, symbol, market cap)
- Bonding curve progress (% to graduation, SOL remaining)
- Holder concentration (top 5 holders, whale %)
- Trade velocity (recent buy/sell ratio, volume)
- Graduation outlook (estimate based on current momentum)

Flag any red flags: high concentration, low activity, potential rug indicators.`,
          },
        },
      ],
    }),
  );
}
