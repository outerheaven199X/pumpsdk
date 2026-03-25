/** Central resource registry — registers all MCP resources on a McpServer instance. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerLaunchFeedResource } from "./launch-feed.js";
import { registerTokenResource } from "./token.js";
import { registerPortfolioResource } from "./portfolio.js";
import { registerGraduatingResource } from "./graduating.js";

/**
 * Register all MCP resources on the given server.
 * @param server - The McpServer instance to register resources on.
 */
export function registerAllResources(server: McpServer): void {
  registerLaunchFeedResource(server);
  registerTokenResource(server);
  registerPortfolioResource(server);
  registerGraduatingResource(server);
}
