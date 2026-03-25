/** Interactive setup wizard for configuring PumpSDK MCP in AI clients. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { detectClients } from "./detect.js";

/**
 * Prompt the user for input.
 * @param question - The question to ask.
 * @returns The user's answer.
 */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Run the interactive setup wizard.
 * Detects MCP clients and writes configuration.
 */
export async function runSetup(): Promise<void> {
  console.log("PumpSDK — Setup Wizard\n");

  const rpcUrl = await ask("Solana RPC URL (press Enter for default mainnet): ");
  const solanaRpc = rpcUrl || "https://api.mainnet-beta.solana.com";

  const clients = detectClients();
  const detected = clients.filter((c) => c.detected);

  if (detected.length === 0) {
    console.log("\nNo MCP clients detected. Install Claude Desktop, Cursor, or use Claude Code.");
    console.log("You can still configure manually by adding to your MCP config:");
    printManualConfig(solanaRpc);
    return;
  }

  console.log("\nDetected MCP clients:");
  detected.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${c.configPath})`));

  const choice = await ask(`\nInstall to which client? (1-${detected.length}, or 'all'): `);

  const targets = choice === "all" ? detected : [detected[parseInt(choice, 10) - 1]].filter(Boolean);

  for (const client of targets) {
    try {
      writeClientConfig(client.configPath, solanaRpc);
      console.log(`  Configured ${client.name} at ${client.configPath}`);
    } catch (err) {
      console.error(`  Failed to configure ${client.name}: ${err}`);
    }
  }

  console.log("\nDone. Restart your MCP client to connect.");
}

/**
 * Write the MCP server config to a client's config file.
 * @param configPath - Path to the client's MCP config.
 * @param rpcUrl - Solana RPC URL.
 */
function writeClientConfig(configPath: string, rpcUrl: string): void {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    /* File doesn't exist — start fresh */
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers["pumpsdk"] = {
    type: "stdio",
    command: "node",
    args: ["dist/src/index.js"],
    env: { SOLANA_RPC_URL: rpcUrl },
  };
  config.mcpServers = mcpServers;

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Print manual configuration instructions.
 * @param rpcUrl - Solana RPC URL.
 */
function printManualConfig(rpcUrl: string): void {
  console.log(`
Add this to your MCP config file:

{
  "mcpServers": {
    "pumpsdk": {
      "type": "stdio",
      "command": "node",
      "args": ["dist/src/index.js"],
      "env": {
        "SOLANA_RPC_URL": "${rpcUrl}"
      }
    }
  }
}
`);
}
