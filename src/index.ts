#!/usr/bin/env node
/** PumpSDK MCP server — token trading, launching, and fee claiming on Pump.fun via MCP. */

import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerAllTools } from "./tools/_registry.js";
import { registerAllResources } from "./resources/_registry.js";
import { registerAllPrompts } from "./prompts/_registry.js";
import { SERVER_INSTRUCTIONS } from "./server-instructions.js";
import { pumpWs } from "./client/pump-ws.js";

const SERVER_NAME = "pumpsdk";
const SERVER_VERSION = "2.0.0";

/**
 * Create and configure an MCP server with all tools, resources, and prompts.
 * @returns Configured McpServer instance ready for transport connection.
 */
export function createServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: SERVER_INSTRUCTIONS });

  registerAllTools(server);
  registerAllResources(server);
  registerAllPrompts(server);

  return server;
}

/**
 * Start the MCP server on stdio transport.
 * Only runs when this file is the main entry point.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  registerShutdownHandler();
  console.error(`[${SERVER_NAME}] Server started (v${SERVER_VERSION})`);
}

/** Graceful shutdown — close WebSocket and exit cleanly on SIGINT/SIGTERM. */
function registerShutdownHandler(): void {
  const shutdown = () => {
    console.error(`[${SERVER_NAME}] Shutting down...`);
    pumpWs.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/* Only auto-start when executed directly, not when imported */
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1];
if (entryFile && thisFile.includes(entryFile.replace(/\\/g, "/"))) {
  main().catch((err) => {
    console.error("[pumpsdk] Fatal error:", err);
    process.exit(1);
  });
}
