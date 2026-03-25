/** Detect installed MCP client applications and their config paths. */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";

interface McpClient {
  name: string;
  configPath: string;
  detected: boolean;
}

/**
 * Detect which MCP clients are installed and return their config paths.
 * Supports Claude Desktop, Cursor, and Claude Code.
 * @returns Array of detected clients with config paths.
 */
export function detectClients(): McpClient[] {
  const home = homedir();
  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";

  const clients: McpClient[] = [];

  /* Claude Desktop */
  const claudeDesktopPath = isWindows
    ? resolve(process.env.APPDATA ?? "", "Claude", "claude_desktop_config.json")
    : isMac
      ? resolve(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : resolve(home, ".config", "Claude", "claude_desktop_config.json");

  clients.push({
    name: "Claude Desktop",
    configPath: claudeDesktopPath,
    detected: existsSync(claudeDesktopPath.replace("claude_desktop_config.json", "")),
  });

  /* Cursor */
  const cursorPath = resolve(".", ".cursor", "mcp.json");
  clients.push({
    name: "Cursor",
    configPath: cursorPath,
    detected: existsSync(resolve(".", ".cursor")),
  });

  /* Claude Code */
  const claudeCodePath = resolve(".", ".mcp.json");
  clients.push({
    name: "Claude Code",
    configPath: claudeCodePath,
    detected: existsSync(claudeCodePath),
  });

  return clients;
}
