/** Central prompt registry — registers all MCP prompts on a McpServer instance. */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { registerGettingStarted } from "./getting-started.js";
import { registerLaunchTokenPrompt } from "./launch-token.js";
import { registerLaunchTeamTokenPrompt } from "./launch-team-token.js";
import { registerClaimAllPrompt } from "./claim-all.js";
import { registerPortfolioOverviewPrompt } from "./portfolio-overview.js";
import { registerAnalyzeTokenPrompt } from "./analyze-token.js";

/**
 * Register all MCP prompts on the given server.
 * @param server - The McpServer instance to register prompts on.
 */
export function registerAllPrompts(server: McpServer): void {
  registerGettingStarted(server);
  registerLaunchTokenPrompt(server);
  registerLaunchTeamTokenPrompt(server);
  registerClaimAllPrompt(server);
  registerPortfolioOverviewPrompt(server);
  registerAnalyzeTokenPrompt(server);
}
