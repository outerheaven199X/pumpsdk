/** Dual-model agent orchestrator — routes tasks to Hermes (fast) or Sonnet (strategic). */

import { hermesChat } from "./hermes.js";
import { sonnetChat } from "./sonnet.js";
import type { LlmMessage, LlmResponse, ModelChoice } from "./types.js";

const ROUTINE_PATTERNS = [
  /claim/i,
  /balance/i,
  /check/i,
  /list/i,
  /monitor/i,
  /status/i,
  /positions/i,
  /feed/i,
  /quote/i,
  /price/i,
  /holdings/i,
];

const STRATEGIC_PATTERNS = [
  /evaluate/i,
  /analyze/i,
  /recommend/i,
  /optimize/i,
  /compare/i,
  /strategy/i,
  /report/i,
  /should/i,
  /graduation/i,
  /snipe/i,
  /scout/i,
  /launch.*idea/i,
  /trend/i,
];

/**
 * Determine which model should handle a given task based on complexity patterns.
 * @param task - Natural language description of the task.
 * @returns "hermes" for routine ops, "sonnet" for strategic decisions.
 */
export function routeDecision(task: string): ModelChoice {
  if (STRATEGIC_PATTERNS.some((p) => p.test(task))) return "sonnet";
  if (ROUTINE_PATTERNS.some((p) => p.test(task))) return "hermes";
  return "hermes";
}

/**
 * Send a task to the appropriate model based on routing logic.
 * @param task - The task description for routing.
 * @param messages - Full conversation context.
 * @returns The LLM response with model attribution.
 */
export async function routedChat(task: string, messages: LlmMessage[]): Promise<LlmResponse> {
  const model = routeDecision(task);
  return model === "sonnet" ? sonnetChat(messages) : hermesChat(messages);
}
