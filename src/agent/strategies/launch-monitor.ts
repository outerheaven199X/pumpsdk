/** Launch monitor strategy: WebSocket-driven instant alerts for new token creations. */

import { pumpWs } from "../../client/pump-ws.js";
import { routedChat } from "../orchestrator.js";
import type { LaunchMonitorConfig, LlmMessage } from "../types.js";

const DEFAULT_CHECK_INTERVAL_MS = 10_000;

/**
 * Run the launch monitor using PumpPortal WebSocket for instant notifications.
 * Filters by keywords and escalates interesting launches to Sonnet for analysis.
 * @param config - Monitor configuration.
 */
export async function launchMonitorLoop(config: LaunchMonitorConfig): Promise<void> {
  console.error("[monitor] Starting WebSocket-driven launch monitor...");

  pumpWs.connect();
  pumpWs.subscribeNewTokens();

  const keywords = config.keywords ?? [];
  const seen = new Set<string>();

  pumpWs.on("newToken", async (token) => {
    if (seen.has(token.mint)) return;
    seen.add(token.mint);

    const matchesKeyword =
      keywords.length === 0 ||
      keywords.some(
        (kw) =>
          token.name.toLowerCase().includes(kw.toLowerCase()) || token.symbol.toLowerCase().includes(kw.toLowerCase()),
      );

    if (!matchesKeyword) return;

    console.error(`[monitor] New token: ${token.name} ($${token.symbol}) - ${token.mint}`);
    console.error(`[monitor]   Creator: ${token.traderPublicKey}`);
    console.error(`[monitor]   Initial buy: ${token.initialBuy}`);

    try {
      const messages: LlmMessage[] = [
        {
          role: "system",
          content: "You are a Pump.fun token analyst. Evaluate new token launches for potential. Be concise.",
        },
        {
          role: "user",
          content: `New token launched on Pump.fun:\n- Name: ${token.name}\n- Symbol: ${token.symbol}\n- Initial buy: ${token.initialBuy} lamports\n- Creator: ${token.traderPublicKey}\n\nQuick assessment: is this worth watching? Consider the name, initial buy size, and any red flags.`,
        },
      ];

      const analysis = await routedChat("analyze new token launch", messages);
      console.error(`[monitor] Analysis (${analysis.model}): ${analysis.content.slice(0, 200)}`);
    } catch (err) {
      console.error(`[monitor] Analysis failed: ${err}`);
    }
  });

  /* Keep the loop alive */
  while (true) {
    await new Promise((r) => setTimeout(r, config.checkIntervalMs));

    /* Prune old seen entries (keep last 1000) */
    if (seen.size > 1000) {
      const entries = [...seen];
      entries.slice(0, entries.length - 1000).forEach((e) => seen.delete(e));
    }
  }
}

/**
 * Create a default monitor config.
 * @returns LaunchMonitorConfig.
 */
export function defaultMonitorConfig(): LaunchMonitorConfig {
  return {
    keywords: process.env.MONITOR_KEYWORDS?.split(",").map((k) => k.trim()) ?? [],
    checkIntervalMs: DEFAULT_CHECK_INTERVAL_MS,
  };
}
