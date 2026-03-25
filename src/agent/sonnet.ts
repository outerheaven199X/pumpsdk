/** Sonnet client via Anthropic API for strategic decisions. */

import type { LlmMessage, LlmResponse } from "./types.js";

const ANTHROPIC_API_BASE = "https://api.anthropic.com/v1";
const SONNET_MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 2048;

/**
 * Send a message to Claude Sonnet for strategic analysis.
 * @param messages - Conversation messages.
 * @returns The assistant's response content.
 */
export async function sonnetChat(messages: LlmMessage[]): Promise<LlmResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY required for strategic agent decisions.");

  const systemMsg = messages.find((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const res = await fetch(`${ANTHROPIC_API_BASE}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: systemMsg?.content ?? "You are a Pump.fun trading analyst. Provide concise, actionable analysis.",
      messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  if (!res.ok) {
    throw new Error(`Sonnet API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { content: Array<{ text: string }> };
  return { content: data.content[0].text, model: "sonnet" };
}
