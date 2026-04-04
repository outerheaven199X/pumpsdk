/** CLI diagnostics: check environment, connectivity, and configuration. */

const CHECKS = [
  { name: "SOLANA_RPC_URL", check: () => process.env.SOLANA_RPC_URL ?? "(default: mainnet-beta)" },
  { name: "NOUS_API_KEY", check: () => (process.env.NOUS_API_KEY ? "set" : "not set (needed for agent mode)") },
  {
    name: "ANTHROPIC_API_KEY",
    check: () => (process.env.ANTHROPIC_API_KEY ? "set" : "not set (needed for agent mode)"),
  },
  {
    name: "AGENT_WALLET_PUBKEY",
    check: () => process.env.AGENT_WALLET_PUBKEY ?? "not set (needed for agent strategies)",
  },
  { name: "FAL_API_KEY", check: () => (process.env.FAL_API_KEY ? "set" : "not set (optional: image gen)") },
  { name: "REPLICATE_API_KEY", check: () => (process.env.REPLICATE_API_KEY ? "set" : "not set (optional: image gen)") },
  { name: "MCP_HTTP_TOKEN", check: () => (process.env.MCP_HTTP_TOKEN ? "set" : "not set (optional: HTTP auth)") },
];

/**
 * Run all diagnostic checks and print results.
 */
export async function runDoctor(): Promise<void> {
  console.log("PumpFun MCP — Diagnostics\n");
  console.log("=== Environment ===");

  for (const { name, check } of CHECKS) {
    console.log(`  ${name}: ${check()}`);
  }

  console.log("\n=== Connectivity ===");

  try {
    const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
    });
    const data = (await res.json()) as { result?: string };
    console.log(`  Solana RPC: ${data.result === "ok" ? "healthy" : "degraded"}`);
  } catch (err) {
    console.log(`  Solana RPC: FAILED (${err})`);
  }

  try {
    const res = await fetch("https://frontend-api-v3.pump.fun/coins?limit=1&offset=0");
    console.log(`  Pump.fun API: ${res.ok ? "reachable" : `HTTP ${res.status}`}`);
  } catch (err) {
    console.log(`  Pump.fun API: FAILED (${err})`);
  }

  try {
    const res = await fetch("https://pumpportal.fun/api/trade-local", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    console.log(`  PumpPortal API: reachable (${res.status})`);
  } catch (err) {
    console.log(`  PumpPortal API: FAILED (${err})`);
  }

  console.log("\n=== Signing Server ===");
  console.log(`  Port: 3142 (binds to 127.0.0.1 only)`);
  console.log(`  Session TTL: 10 minutes`);
  console.log(`  Store: file-backed (.sessions/sessions.json)`);

  console.log("\n=== Server Info ===");
  console.log(`  Version: 2.0.0`);
  console.log(`  Tools: 36`);
  console.log(`  Resources: 4`);
  console.log(`  Prompts: 6`);
  console.log(`  Agent strategies: 6`);
  console.log(`  Transports: stdio, http`);
}
