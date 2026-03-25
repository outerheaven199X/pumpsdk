/** Sniper strategy: auto-detect new tokens matching criteria and propose buy transactions. */

import { Buffer } from "node:buffer";
import { pumpWs } from "../../client/pump-ws.js";
import { portalPostBinary } from "../../client/pump-rest.js";
import { createSigningSession } from "../../signing/serve.js";
import { routedChat } from "../orchestrator.js";
import type { SniperConfig, LlmMessage } from "../types.js";

/**
 * Run the sniper strategy: listen for new tokens matching keywords, build buy txs.
 * Opens signing sessions for the operator to approve with minimal interaction.
 * @param config - Sniper configuration.
 */
export async function sniperLoop(config: SniperConfig): Promise<void> {
  console.error("[sniper] Starting sniper strategy...");
  console.error(`[sniper] Keywords: ${config.keywords?.join(", ") || "any"}`);
  console.error(`[sniper] Max buy: ${config.maxBuySol} SOL`);

  pumpWs.connect();
  pumpWs.subscribeNewTokens();

  const processed = new Set<string>();

  pumpWs.on("newToken", async (token) => {
    if (processed.has(token.mint)) return;
    processed.add(token.mint);

    const keywords = config.keywords ?? [];
    const matchesKeyword =
      keywords.length === 0 ||
      keywords.some(
        (kw) =>
          token.name.toLowerCase().includes(kw.toLowerCase()) || token.symbol.toLowerCase().includes(kw.toLowerCase()),
      );

    if (!matchesKeyword) return;

    console.error(`[sniper] Match: ${token.name} ($${token.symbol})`);

    try {
      /* Ask LLM for quick assessment */
      const messages: LlmMessage[] = [
        {
          role: "system",
          content:
            "You are a Pump.fun sniper bot assistant. Evaluate tokens for quick buys. Respond with YES or NO and one sentence why.",
        },
        {
          role: "user",
          content: `New token: ${token.name} ($${token.symbol}). Initial buy: ${token.initialBuy} lamports. Should I buy?`,
        },
      ];

      const decision = await routedChat("evaluate snipe opportunity", messages);
      console.error(`[sniper] Decision: ${decision.content.slice(0, 100)}`);

      if (decision.content.toUpperCase().startsWith("YES")) {
        const txBytes = await portalPostBinary("/trade-local", {
          publicKey: config.walletAddress,
          action: "buy",
          mint: token.mint,
          amount: config.maxBuySol,
          denominatedInSol: "true",
          slippage: config.slippage,
          priorityFee: 0.001,
          pool: "pump",
        });

        const txBase64 = Buffer.from(txBytes).toString("base64");
        const signingUrl = await createSigningSession(
          [txBase64],
          `Snipe: Buy $${token.symbol} for ${config.maxBuySol} SOL`,
          {
            action: "Snipe Buy",
            token: `${token.name} ($${token.symbol})`,
            amount: `${config.maxBuySol} SOL`,
            mint: token.mint,
          },
        );

        console.error(`[sniper] SIGNING URL: ${signingUrl}`);
        console.error(`[sniper] Open the URL above to approve the snipe buy.`);
      }
    } catch (err) {
      console.error(`[sniper] Failed: ${err}`);
    }

    /* Prune old entries */
    if (processed.size > 5000) {
      const entries = [...processed];
      entries.slice(0, entries.length - 1000).forEach((e) => processed.delete(e));
    }
  });

  /* Keep alive */
  await new Promise(() => {});
}

/**
 * Create a default sniper config.
 * @returns SniperConfig.
 */
export function defaultSniperConfig(): SniperConfig {
  const wallet = process.env.AGENT_WALLET_PUBKEY;
  if (!wallet) throw new Error("AGENT_WALLET_PUBKEY required for sniper strategy.");

  return {
    walletAddress: wallet,
    keywords: process.env.SNIPER_KEYWORDS?.split(",").map((k) => k.trim()) ?? [],
    maxBuySol: Number(process.env.SNIPER_MAX_BUY_SOL ?? "0.01"),
    slippage: Number(process.env.SNIPER_SLIPPAGE ?? "15"),
  };
}
