/** Stdio transport — default for Claude Desktop, Cursor, and CLI usage. */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "../index.js";

/**
 * Start the MCP server on stdio transport.
 * Reads JSON-RPC messages from stdin, writes to stdout.
 */
export async function startStdio(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[pumpfun-mcp] Server started on stdio transport");
}
