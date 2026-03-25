/** Real-time WebSocket client for PumpPortal — streams new token creations and trades. */

import { EventEmitter } from "node:events";

const PUMPPORTAL_WS_URL = "wss://pumpportal.fun/api/data";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
const RING_BUFFER_SIZE = 100;

/** A new token creation event from PumpPortal. */
export interface NewTokenEvent {
  signature: string;
  mint: string;
  traderPublicKey: string;
  initialBuy: number;
  bondingCurveKey: string;
  name: string;
  symbol: string;
  uri: string;
  timestamp: number;
}

/** A trade event from PumpPortal. */
export interface TradeEvent {
  signature: string;
  mint: string;
  traderPublicKey: string;
  txType: "buy" | "sell";
  tokenAmount: number;
  solAmount: number;
  newTokenBalance: number;
  bondingCurveKey: string;
  timestamp: number;
}

type EventMap = {
  newToken: [NewTokenEvent];
  trade: [TradeEvent];
  connected: [];
  disconnected: [];
  error: [Error];
};

/**
 * Singleton WebSocket client that connects to PumpPortal's data stream.
 * Maintains ring buffers of recent events and auto-reconnects on disconnect.
 */
class PumpWebSocket extends EventEmitter<EventMap> {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private subscribedTokens = new Set<string>();
  private subscribedNewTokens = false;

  readonly recentTokens: NewTokenEvent[] = [];
  readonly recentTrades: TradeEvent[] = [];

  /**
   * Connect to PumpPortal WebSocket and begin receiving events.
   * Idempotent — calling multiple times reuses the existing connection.
   */
  connect(): void {
    if (this.ws) return;

    try {
      this.ws = new WebSocket(PUMPPORTAL_WS_URL);
      this.ws.onopen = () => this.handleOpen();
      this.ws.onmessage = (event) => this.handleMessage(event);
      this.ws.onclose = () => this.handleClose();
      this.ws.onerror = (event) => this.handleError(event);
    } catch (err) {
      console.error("[pump-ws] Connection failed:", err);
      this.scheduleReconnect();
    }
  }

  /**
   * Subscribe to new token creation events.
   */
  subscribeNewTokens(): void {
    this.subscribedNewTokens = true;
    this.sendSubscription({ method: "subscribeNewToken" });
  }

  /**
   * Subscribe to trade events for a specific token mint.
   * @param mint - The token mint address to watch.
   */
  subscribeTokenTrades(mint: string): void {
    this.subscribedTokens.add(mint);
    this.sendSubscription({ method: "subscribeTokenTrade", keys: [mint] });
  }

  /**
   * Unsubscribe from trade events for a specific token mint.
   * @param mint - The token mint address to stop watching.
   */
  unsubscribeTokenTrades(mint: string): void {
    this.subscribedTokens.delete(mint);
    this.sendSubscription({ method: "unsubscribeTokenTrade", keys: [mint] });
  }

  /**
   * Disconnect and stop all subscriptions.
   */
  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  /** Whether the WebSocket is currently connected. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private handleOpen(): void {
    this.reconnectAttempts = 0;
    console.error("[pump-ws] Connected to PumpPortal");
    this.emit("connected");
    this.resubscribeAll();
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(String(event.data)) as Record<string, unknown>;

      if (data.txType === "create" || data.txType === "tokenCreation") {
        const token = this.parseNewToken(data);
        this.pushToRing(this.recentTokens, token);
        this.emit("newToken", token);
      } else if (data.txType === "buy" || data.txType === "sell") {
        const trade = this.parseTrade(data);
        this.pushToRing(this.recentTrades, trade);
        this.emit("trade", trade);
      }
    } catch {
      /* Silently ignore malformed messages */
    }
  }

  private handleClose(): void {
    this.ws = null;
    console.error("[pump-ws] Disconnected from PumpPortal");
    this.emit("disconnected");
    this.scheduleReconnect();
  }

  private handleError(_event: Event): void {
    this.emit("error", new Error("WebSocket error"));
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts), RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    console.error(`[pump-ws] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.ws = null;
      this.connect();
    }, delay);
  }

  private resubscribeAll(): void {
    if (this.subscribedNewTokens) {
      this.sendSubscription({ method: "subscribeNewToken" });
    }
    for (const mint of this.subscribedTokens) {
      this.sendSubscription({ method: "subscribeTokenTrade", keys: [mint] });
    }
  }

  private sendSubscription(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private parseNewToken(data: Record<string, unknown>): NewTokenEvent {
    return {
      signature: String(data.signature ?? ""),
      mint: String(data.mint ?? ""),
      traderPublicKey: String(data.traderPublicKey ?? ""),
      initialBuy: Number(data.initialBuy ?? 0),
      bondingCurveKey: String(data.bondingCurveKey ?? ""),
      name: String(data.name ?? ""),
      symbol: String(data.symbol ?? ""),
      uri: String(data.uri ?? ""),
      timestamp: Date.now(),
    };
  }

  private parseTrade(data: Record<string, unknown>): TradeEvent {
    return {
      signature: String(data.signature ?? ""),
      mint: String(data.mint ?? ""),
      traderPublicKey: String(data.traderPublicKey ?? ""),
      txType: data.txType === "sell" ? "sell" : "buy",
      tokenAmount: Number(data.tokenAmount ?? 0),
      solAmount: Number(data.solAmount ?? 0),
      newTokenBalance: Number(data.newTokenBalance ?? 0),
      bondingCurveKey: String(data.bondingCurveKey ?? ""),
      timestamp: Date.now(),
    };
  }

  private pushToRing<T>(buffer: T[], item: T): void {
    buffer.push(item);
    if (buffer.length > RING_BUFFER_SIZE) buffer.shift();
  }
}

/** Singleton instance shared across all consumers. */
export const pumpWs = new PumpWebSocket();
