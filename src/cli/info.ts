/** CLI info: print server version and configuration summary. */

/**
 * Print server information and exit.
 */
export function printInfo(): void {
  console.log("PumpFun MCP Server v2.0.0\n");
  console.log("Tools:      30 across 8 domains");
  console.log("Resources:  4 (launches, token, portfolio, graduating)");
  console.log("Prompts:    6 guided workflows");
  console.log("Agent:      6 autonomous strategies");
  console.log("Transport:  stdio (default), http (--http)");
  console.log("");
  console.log("Domains:");
  console.log("  trading    - Quotes, swaps, signing pages");
  console.log("  tokens     - Launch, metadata, feeds, creator tokens");
  console.log("  fees       - Claim, batch claim, positions, config");
  console.log("  analytics  - Top tokens, trades, holders, bonding curve");
  console.log("  stream     - Real-time WebSocket mint/trade/graduation events");
  console.log("  solana     - Balance, holdings, send transaction");
  console.log("  scout      - Trend scanning, launch packages, image gen");
  console.log("  meta       - Tool catalog");
  console.log("");
  console.log("Agent strategies:");
  console.log("  --auto-claim        Periodically claim creator fees");
  console.log("  --monitor           Watch new launches via WebSocket");
  console.log("  --graduation-watch  Alert on tokens near graduation");
  console.log("  --sniper            Auto-detect and propose buys");
  console.log("  --scout             Scan trends, generate launch ideas");
  console.log("  --fee-optimize      One-shot fee analysis (Sonnet)");
}
