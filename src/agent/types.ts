/** Type definitions for the autonomous agent layer. */

export type ModelChoice = "hermes" | "sonnet";

export interface AgentConfig {
  strategies: string[];
}

export interface AutoClaimConfig {
  walletAddress: string;
  minClaimThresholdSol: number;
  checkIntervalMs: number;
}

export interface LaunchMonitorConfig {
  keywords?: string[];
  checkIntervalMs: number;
}

export interface GraduationWatchConfig {
  walletAddress: string;
  minProgressPercent: number;
  checkIntervalMs: number;
}

export interface SniperConfig {
  walletAddress: string;
  keywords?: string[];
  maxBuySol: number;
  slippage: number;
}

export interface ScoutConfig {
  sources: string[];
  maxIdeas: number;
  scanIntervalMs: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmResponse {
  content: string;
  model: ModelChoice;
}
