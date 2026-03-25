/** Hermes 4 client via Nous API (OpenAI-compatible) for fast routine decisions. */

import type { LlmMessage, LlmResponse } from "./types.js";

const NOUS_API_BASE = "https://inference-api.nousresearch.com/v1";
const HERMES_MODEL = "hermes-4";

/**
 * Send a chat completion request to Hermes 4 via the Nous API.
 * @param messages - Conversation messages in OpenAI chat format.
 * @returns The assistant's response content.
 */
export async function hermesChat(messages: LlmMessage[]): Promise<LlmResponse> {
  const apiKey = process.env.NOUS_API_KEY;
  if (!apiKey) throw new Error("NOUS_API_KEY required for agent mode.");

  const res = await fetch(`${NOUS_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: HERMES_MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    throw new Error(`Hermes API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return { content: data.choices[0].message.content, model: "hermes" };
}
