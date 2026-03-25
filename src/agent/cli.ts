/** CLI entry for agent mode: parses flags and starts the appropriate strategies. */

import type { AgentConfig } from "./types.js";
import { autoClaimLoop, defaultAutoClaimConfig } from "./strategies/auto-claim.js";
import { launchMonitorLoop, defaultMonitorConfig } from "./strategies/launch-monitor.js";
import { graduationWatchLoop, defaultGraduationWatchConfig } from "./strategies/graduation-watch.js";
import { sniperLoop, defaultSniperConfig } from "./strategies/sniper.js";
import { scoutLoop, defaultScoutConfig } from "./strategies/scout.js";
import { analyzeFeeOptimization } from "./strategies/fee-optimizer.js";

const WALLET_ENV = "AGENT_WALLET_PUBKEY";
const ANTHROPIC_ENV = "ANTHROPIC_API_KEY";

/**
 * Require an env var or exit with a clear message.
 * @param name - Environment variable name.
 * @returns The variable's value.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[agent] ${name} is required for this strategy. Set it in .env or environment.`);
    process.exit(1);
  }
  return value;
}

/**
 * Start the agent with the configured strategies.
 * Loop strategies run concurrently; one-shot strategies run and exit.
 * @param config - Agent configuration from CLI flags.
 */
export async function startAgent(config: AgentConfig): Promise<void> {
  if (config.strategies.includes("fee-optimize")) {
    const wallet = requireEnv(WALLET_ENV);
    requireEnv(ANTHROPIC_ENV);
    console.error("[agent] Running fee optimization analysis...");
    const result = await analyzeFeeOptimization(wallet);
    console.log(result);
    return;
  }

  console.error("[agent] Starting PumpFun autonomous agent...");
  const promises: Promise<void>[] = [];

  if (config.strategies.includes("auto-claim")) {
    console.error("[agent] Enabling auto-claim strategy");
    promises.push(autoClaimLoop(defaultAutoClaimConfig()));
  }

  if (config.strategies.includes("monitor")) {
    console.error("[agent] Enabling launch monitor strategy (WebSocket)");
    promises.push(launchMonitorLoop(defaultMonitorConfig()));
  }

  if (config.strategies.includes("graduation-watch")) {
    console.error("[agent] Enabling graduation watch strategy");
    promises.push(graduationWatchLoop(defaultGraduationWatchConfig()));
  }

  if (config.strategies.includes("sniper")) {
    console.error("[agent] Enabling sniper strategy (WebSocket)");
    promises.push(sniperLoop(defaultSniperConfig()));
  }

  if (config.strategies.includes("scout")) {
    console.error("[agent] Enabling scout strategy");
    promises.push(scoutLoop(defaultScoutConfig()));
  }

  if (promises.length === 0) {
    console.error("[agent] No strategies enabled. Available:");
    console.error("[agent]   --auto-claim      Periodically claim creator fees");
    console.error("[agent]   --monitor         Watch for new token launches (WebSocket)");
    console.error("[agent]   --graduation-watch Alert on tokens near graduation");
    console.error("[agent]   --sniper          Auto-detect and propose buy on matching tokens");
    console.error("[agent]   --scout           Scan trends and generate launch packages");
    console.error("[agent]   --fee-optimize    One-shot fee config analysis");
    console.error("[agent] Example: node dist/src/index.js --agent --scout --monitor");
    return;
  }

  await Promise.all(promises);
}
