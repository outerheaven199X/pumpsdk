/** PumpFun MCP server — token trading, launching, and fee claiming on Pump.fun via MCP. */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerQuote } from "./tools/trading/quote.js";
import { registerTrade } from "./tools/trading/trade.js";
import { registerOpenSigningPage } from "./tools/trading/sign.js";
import { registerMetadata } from "./tools/tokens/metadata.js";
import { registerNewMints } from "./tools/tokens/new-mints.js";
import { registerLaunch } from "./tools/tokens/launch.js";
import { registerClaimFees } from "./tools/fees/claim.js";

const SERVER_NAME = "pumpfun-mcp";
const SERVER_VERSION = "1.0.0";

/**
 * Register all tools on the MCP server.
 * @param server - The McpServer instance.
 */
function registerAllTools(server: McpServer): void {
  registerQuote(server);
  registerTrade(server);
  registerOpenSigningPage(server);
  registerMetadata(server);
  registerNewMints(server);
  registerLaunch(server);
  registerClaimFees(server);
}

/**
 * Start the MCP server on stdio transport.
 */
async function main(): Promise<void> {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });

  registerAllTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[${SERVER_NAME}] Server started (v${SERVER_VERSION})`);
}

main().catch((err) => {
  console.error("[pumpfun-mcp] Fatal error:", err);
  process.exit(1);
});
