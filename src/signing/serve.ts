/** Local signing server — serves wallet-connect pages for transaction signing and token launches. */

import express from "express";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFeeConfigTxs, buildLaunchTx } from "./launch-builder.js";
import { SIGNING_PORT, SESSION_TTL_MS, WALLET_PLACEHOLDER } from "../utils/constants.js";

/** Pre-built signing session — transactions already exist. */
interface SigningSession {
  type: "sign";
  id: string;
  transactions: string[];
  description: string;
  meta: Record<string, string>;
  rpcUrl: string;
  signatures: string[];
  complete: boolean;
  createdAt: number;
}

/** Two-phase launch session — transactions built after wallet connects. */
interface LaunchSession {
  type: "launch";
  id: string;
  metadataUri: string;
  tokenName: string;
  tokenSymbol: string;
  claimersArray: string[];
  basisPointsArray: number[];
  initialBuySol: number;
  slippage: number;
  priorityFee: number;
  description: string;
  meta: Record<string, string>;
  rpcUrl: string;
  phase: "connect" | "fee_config" | "launch" | "complete";
  wallet: string | null;
  mintAddress: string | null;
  feeConfigTxs: string[];
  launchTx: string | null;
  signatures: string[];
  createdAt: number;
}

type Session = SigningSession | LaunchSession;

const sessions = new Map<string, Session>();
let serverRunning = false;

/**
 * Remove expired sessions older than SESSION_TTL_MS.
 */
function pruneExpired(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

/**
 * Resolve the HTML page path relative to this module.
 */
function loadPageHtml(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(thisDir, "page.html"), "utf-8");
}

/**
 * Register all signing and launch API routes on the Express app.
 * @param app - Express app instance.
 * @param pageHtml - Pre-loaded HTML page content.
 */
function registerRoutes(app: express.Express, pageHtml: string): void {
  registerSignRoutes(app, pageHtml);
  registerLaunchRoutes(app, pageHtml);
}

/**
 * Register routes for pre-built signing sessions (/sign/:id).
 * @param app - Express app instance.
 * @param pageHtml - Pre-loaded HTML page content.
 */
function registerSignRoutes(app: express.Express, pageHtml: string): void {
  app.get("/sign/:sessionId", (_req, res) => {
    res.type("html").send(pageHtml);
  });

  app.get("/api/sign/:sessionId", (req, res) => {
    pruneExpired();
    const session = sessions.get(req.params.sessionId);
    if (!session || session.type !== "sign") {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    res.json({
      transactions: session.transactions,
      description: session.description,
      meta: session.meta,
      rpcUrl: session.rpcUrl,
    });
  });

  app.post("/api/sign/:sessionId/complete", (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || session.type !== "sign") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    session.signatures = req.body.signatures || [];
    session.complete = true;
    res.json({ ok: true });
  });
}

/**
 * Register routes for two-phase launch sessions (/launch/:id).
 * Flow: connect → fee_config → launch → complete.
 * @param app - Express app instance.
 * @param pageHtml - Pre-loaded HTML page content.
 */
function registerLaunchRoutes(app: express.Express, pageHtml: string): void {
  app.get("/launch/:sessionId", (_req, res) => {
    res.type("html").send(pageHtml);
  });

  app.get("/api/launch/:sessionId", (req, res) => {
    pruneExpired();
    const session = sessions.get(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    res.json({
      description: session.description,
      meta: session.meta,
      rpcUrl: session.rpcUrl,
      phase: session.phase,
    });
  });

  app.post("/api/launch/:sessionId/connect", async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (session.phase !== "connect") {
      res.status(400).json({ error: `Expected phase 'connect', got '${session.phase}'.` });
      return;
    }

    const { wallet } = req.body;
    if (!wallet || typeof wallet !== "string") {
      res.status(400).json({ error: "Missing wallet address." });
      return;
    }

    try {
      const claimers = session.claimersArray.map((c) => c === WALLET_PLACEHOLDER ? wallet : c);
      const result = await buildFeeConfigTxs(wallet, session.meta.mint || "", claimers, session.basisPointsArray);

      session.wallet = wallet;
      session.feeConfigTxs = result.transactions;
      session.phase = "fee_config";

      res.json({
        phase: "fee_config",
        transactions: result.transactions,
        description: `Fee setup for $${session.tokenSymbol}`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/launch/:sessionId/fee-signed", async (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (session.phase !== "fee_config") {
      res.status(400).json({ error: `Expected phase 'fee_config', got '${session.phase}'.` });
      return;
    }

    session.signatures.push(...(req.body.signatures || []));

    try {
      const result = await buildLaunchTx(
        session.wallet!,
        session.metadataUri,
        session.tokenName,
        session.tokenSymbol,
        session.initialBuySol,
        session.slippage,
        session.priorityFee,
      );

      session.launchTx = result.transaction;
      session.mintAddress = result.mintAddress;
      session.phase = "launch";

      res.json({
        phase: "launch",
        transactions: [result.transaction],
        description: `Launch $${session.tokenSymbol} (initial buy: ${session.initialBuySol} SOL)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/launch/:sessionId/complete", (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    session.signatures.push(...(req.body.signatures || []));
    session.phase = "complete";
    res.json({ ok: true });
  });
}

/**
 * Start the signing server (idempotent — only starts once).
 * Binds to 127.0.0.1 only for security.
 */
export function startSigningServer(): void {
  if (serverRunning) return;
  serverRunning = true;

  const pageHtml = loadPageHtml();
  const app = express();
  app.use(express.json());
  registerRoutes(app, pageHtml);

  app.listen(SIGNING_PORT, "127.0.0.1", () => {
    console.error(`[pumpfun-mcp] Signing server at http://localhost:${SIGNING_PORT}`);
  });
}

/**
 * Create a new pre-built signing session and return its URL.
 * @param transactions - Base64 or base58 encoded transactions.
 * @param description - What the user is signing (shown on the page).
 * @param meta - Key-value pairs displayed as token details.
 * @returns The localhost URL for the signing page.
 */
export function createSigningSession(
  transactions: string[],
  description: string,
  meta: Record<string, string>,
): string {
  startSigningServer();
  pruneExpired();

  const id = randomUUID();
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  sessions.set(id, {
    type: "sign",
    id,
    transactions,
    description,
    meta,
    rpcUrl,
    signatures: [],
    complete: false,
    createdAt: Date.now(),
  });

  return `http://localhost:${SIGNING_PORT}/sign/${id}`;
}

/** Parameters for creating a two-phase launch session. */
export interface LaunchSessionParams {
  metadataUri: string;
  tokenName: string;
  tokenSymbol: string;
  claimersArray: string[];
  basisPointsArray: number[];
  initialBuySol: number;
  slippage: number;
  priorityFee: number;
  description: string;
  meta: Record<string, string>;
}

/**
 * Create a two-phase launch session — wallet comes from the page, not from chat.
 * @param params - Token details and fee split info.
 * @returns The localhost URL for the launch page.
 */
export function createLaunchSession(params: LaunchSessionParams): string {
  startSigningServer();
  pruneExpired();

  const id = randomUUID();
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  sessions.set(id, {
    type: "launch",
    id,
    metadataUri: params.metadataUri,
    tokenName: params.tokenName,
    tokenSymbol: params.tokenSymbol,
    claimersArray: params.claimersArray,
    basisPointsArray: params.basisPointsArray,
    initialBuySol: params.initialBuySol,
    slippage: params.slippage,
    priorityFee: params.priorityFee,
    description: params.description,
    meta: params.meta,
    rpcUrl,
    phase: "connect",
    wallet: null,
    mintAddress: null,
    feeConfigTxs: [],
    launchTx: null,
    signatures: [],
    createdAt: Date.now(),
  });

  return `http://localhost:${SIGNING_PORT}/launch/${id}`;
}

/**
 * Check whether a session has been completed.
 * @param sessionId - The session UUID.
 * @returns The session if complete, null otherwise.
 */
export function getSessionStatus(sessionId: string): Session | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.type === "sign") return session.complete ? session : null;
  return session.phase === "complete" ? session : null;
}

export { WALLET_PLACEHOLDER };
