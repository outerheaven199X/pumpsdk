/** Local signing server — serves wallet-connect pages for transaction signing and token launches. */

import express from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

import helmet from "helmet";
import rateLimit from "express-rate-limit";

import { buildFeeConfigTxs, buildLaunchTx, buildDevBuyTx } from "./launch-builder.js";
import { getSession, setSession, pruneAll } from "./session-store.js";
import { generateTokenImage, buildImagePrompt } from "../client/imagegen.js";
import { uploadToIpfs } from "../client/ipfs.js";
import { SIGNING_PORT, WALLET_PLACEHOLDER, ALLOWED_ORIGIN, CSRF_TOKEN_BYTES } from "../utils/constants.js";
import { FLAGS } from "../utils/flags.js";

const keypairStore = new Map<string, Uint8Array>();

/** Pre-built signing session — transactions already exist. */
interface SigningSession {
  type: "sign";
  id: string;
  csrfToken: string;
  transactions: string[];
  description: string;
  meta: Record<string, string>;
  rpcUrl: string;
  signatures: string[];
  complete: boolean;
  createdAt: number;
}

/**
 * Two-phase launch session — transactions built after wallet connects.
 * Flow: connect → launch (create token) → fee_config (set up fee sharing) → complete.
 * Launch must come before fee_config because the Pump.fun fee program requires
 * an already-initialized mint account, which only exists after the launch tx confirms.
 */
interface LaunchSession {
  type: "launch";
  id: string;
  csrfToken: string;
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
  phase: "connect" | "launch" | "fee_config" | "complete";
  wallet: string | null;
  mintPublicKey: string;
  mintKeypairSecret: string;
  feeConfigTxs: string[];
  launchTx: string | null;
  signatures: string[];
  createdAt: number;
}

/**
 * Scout session — AI-generated token with image preview, SOL slider, and multi-phase signing.
 * Flow: preview → approve (wallet + SOL amount) → launch → fee_config → complete.
 */
interface ScoutSession {
  type: "scout";
  id: string;
  csrfToken: string;
  tokenName: string;
  tokenSymbol: string;
  description: string;
  imageUrl: string | null;
  imagePrompt: string;
  claimersArray: string[];
  basisPointsArray: number[];
  slippage: number;
  priorityFee: number;
  meta: Record<string, string>;
  rpcUrl: string;
  phase: "preview" | "launch" | "dev_buy" | "fee_config" | "complete";
  wallet: string | null;
  mintPublicKey: string;
  mintKeypairSecret: string;
  metadataUri: string | null;
  initialBuySol: number;
  signatures: string[];
  regenerationCount: number;
  createdAt: number;
}

/** Maximum image regenerations allowed per scout session. */
const MAX_REGENERATIONS_PER_SESSION = 5;

type Session = SigningSession | LaunchSession | ScoutSession;

let serverRunning = false;

/**
 * Generate a cryptographically random CSRF token (64-char hex string).
 * @returns Hex-encoded CSRF token.
 */
function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_BYTES).toString("hex");
}

/**
 * Stricter origin validation for POST requests.
 * Requires either a matching Origin header OR a Referer starting with the allowed origin.
 * Non-browser clients that omit both headers are rejected.
 * @param req - Express request.
 * @returns True if the request can be trusted as originating from the signing page.
 */
function isValidOriginForPost(req: express.Request): boolean {
  if (FLAGS.DEV_NO_CSRF) return true;
  const origin = req.headers.origin;
  if (origin === ALLOWED_ORIGIN) return true;
  const referer = req.headers.referer;
  if (referer && referer.startsWith(ALLOWED_ORIGIN)) return true;
  return false;
}

/**
 * Validate the CSRF token from the request body against the session's stored token.
 * @param req - Express request with parsed JSON body.
 * @param session - The session containing the expected CSRF token.
 * @returns True if the tokens match.
 */
function isValidCsrf(req: express.Request, session: Session): boolean {
  const clientToken = req.body?.csrfToken;
  return typeof clientToken === "string" && clientToken === session.csrfToken;
}

/**
 * Rotate the CSRF token on a session after a successful POST.
 * Returns the new token so it can be included in the response.
 * @param session - The session to rotate the token on.
 * @param sessionId - Session ID for persistence.
 * @returns The newly generated CSRF token.
 */
async function rotateCsrfToken(session: Session, sessionId: string): Promise<string> {
  const newToken = generateCsrfToken();
  session.csrfToken = newToken;
  await setSession(sessionId, session);
  return newToken;
}

/**
 * Load HTML page templates relative to this module.
 */
function loadPages(): { page: string; scoutPage: string; dashboardPage: string } {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return {
    page: readFileSync(resolve(thisDir, "page.html"), "utf-8"),
    scoutPage: readFileSync(resolve(thisDir, "scout-page.html"), "utf-8"),
    dashboardPage: readFileSync(resolve(thisDir, "dashboard.html"), "utf-8"),
  };
}

/**
 * Register all signing, launch, and scout API routes on the Express app.
 * @param app - Express app instance.
 * @param pages - Pre-loaded HTML page content.
 */
function registerRoutes(app: express.Express, pages: { page: string; scoutPage: string; dashboardPage: string }): void {
  registerSignRoutes(app, pages.page);
  registerLaunchRoutes(app, pages.page);
  registerScoutRoutes(app, pages.scoutPage);
  registerDashboardRoutes(app, pages.dashboardPage);
}

/**
 * Register dashboard routes: serves the dashboard page and provides
 * a browser-callable session creation endpoint for the launch flow.
 * @param app - Express app instance.
 * @param dashboardHtml - Pre-loaded dashboard HTML with %%RPC_URL%% placeholder.
 */
function registerDashboardRoutes(app: express.Express, dashboardHtml: string): void {
  /* Never embed the full RPC URL (may contain API keys) — use the /api/rpc proxy instead. */
  const renderedHtml = dashboardHtml.replaceAll("%%RPC_URL%%", "/api/rpc");

  app.get("/dashboard", (_req, res) => {
    res.type("html").send(renderedHtml);
  });

  /** Proxy price data via CryptoCompare (free, no key). */
  app.get("/api/dashboard/prices", async (_req, res) => {
    try {
      const ccRes = await fetch(
        "https://min-api.cryptocompare.com/data/pricemultifull?fsyms=BTC,ETH,SOL,DOGE&tsyms=USD",
      );
      const raw = await ccRes.json();
      const result: Record<string, { usd: number; usd_24h_change: number }> = {};
      const syms = raw.RAW as Record<string, Record<string, { PRICE: number; CHANGEPCT24HOUR: number }>>;
      const idMap: Record<string, string> = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana", DOGE: "dogecoin" };
      for (const [sym, data] of Object.entries(syms)) {
        const usdData = data.USD;
        result[idMap[sym] || sym.toLowerCase()] = { usd: usdData.PRICE, usd_24h_change: usdData.CHANGEPCT24HOUR };
      }
      res.json(result);
    } catch {
      res.status(502).json({ error: "Price fetch failed" });
    }
  });

  /** Proxy CryptoCompare chart data (returns CoinGecko-compatible format). */
  app.get("/api/dashboard/chart", async (req, res) => {
    try {
      const days = Number(req.query.days || 1);
      const sym = String(req.query.coin || "solana") === "solana" ? "SOL" : "BTC";
      const limit = Math.min(Math.max(Math.round(days * 24), 12), 720);
      const ccRes = await fetch(
        `https://min-api.cryptocompare.com/data/v2/histohour?fsym=${sym}&tsym=USD&limit=${limit}`,
      );
      const raw = await ccRes.json();
      const prices = (raw.Data?.Data || []).map((d: { time: number; close: number }) => [d.time * 1000, d.close]);
      res.json({ prices });
    } catch {
      res.status(502).json({ error: "Chart fetch failed" });
    }
  });

  /** Generate token image via fal.ai Nano Banana. */
  app.post("/api/dashboard/generate-image", async (req, res) => {
    if (!isValidOriginForPost(req)) { res.status(403).json({ error: "Invalid origin." }); return; }
    const { tokenName, tokenSymbol, description } = req.body;
    if (!tokenName) { res.status(400).json({ error: "tokenName required." }); return; }
    try {
      const prompt = buildImagePrompt(String(tokenName), String(tokenSymbol || ""), String(description || ""));
      const imageUrl = await generateTokenImage(prompt);
      res.json({ imageUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /** Proxy Pump.fun trending coins. */
  app.get("/api/dashboard/trending", async (_req, res) => {
    try {
      const pfRes = await fetch(
        "https://frontend-api-v3.pump.fun/coins/currently-live?limit=10&offset=0&includeNsfw=false",
      );
      const data = await pfRes.json();
      res.json(data);
    } catch {
      res.status(502).json({ error: "Pump.fun fetch failed" });
    }
  });

  app.post("/api/dashboard/create-session", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }

    const { tokenName, tokenSymbol, description, imageUrl, initialBuySol } = req.body;
    if (!tokenName || !tokenSymbol) {
      res.status(400).json({ error: "tokenName and tokenSymbol are required." });
      return;
    }

    const mintKeypair = Keypair.generate();
    const mintPublicKey = mintKeypair.publicKey.toBase58();
    const mintKeypairSecret = Buffer.from(mintKeypair.secretKey).toString("base64");
    const csrfToken = randomBytes(32).toString("hex");
    const id = randomUUID();

    const session: ScoutSession = {
      id,
      type: "scout",
      phase: "preview",
      tokenName: String(tokenName),
      tokenSymbol: String(tokenSymbol),
      description: String(description || ""),
      imageUrl: imageUrl ? String(imageUrl) : null,
      imagePrompt: "",
      claimersArray: [],
      basisPointsArray: [],
      slippage: 10,
      priorityFee: 0.0005,
      meta: {},
      rpcUrl: process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com",
      wallet: null,
      mintPublicKey,
      mintKeypairSecret,
      metadataUri: null,
      csrfToken,
      initialBuySol: Number(initialBuySol) || 0,
      signatures: [],
      regenerationCount: 0,
      createdAt: Date.now(),
    };

    await setSession(id, session);
    res.json({ sessionId: id, csrfToken, mintPublicKey });
  });
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

  app.get("/api/sign/:sessionId", async (req, res) => {
    await pruneAll();
    const session = await getSession<SigningSession>(req.params.sessionId);
    if (!session || session.type !== "sign") {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    res.json({
      transactions: session.transactions,
      description: session.description,
      meta: session.meta,
      rpcUrl: session.rpcUrl,
      csrfToken: session.csrfToken,
    });
  });

  app.post("/api/sign/:sessionId/complete", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<SigningSession>(req.params.sessionId);
    if (!session || session.type !== "sign") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    session.signatures = req.body.signatures || [];
    session.complete = true;
    await setSession(req.params.sessionId, session);
    res.json({ ok: true });
  });
}

/**
 * Register routes for launch sessions.
 * Flow: connect → launch (create token on-chain) → fee_config (set up fee sharing) → complete.
 * The mint must exist on-chain before fee config can reference it.
 * @param app - Express app instance.
 * @param pageHtml - Pre-loaded HTML page content.
 */
function registerLaunchRoutes(app: express.Express, pageHtml: string): void {
  app.get("/launch/:sessionId", (_req, res) => {
    res.type("html").send(pageHtml);
  });

  app.get("/api/launch/:sessionId", async (req, res) => {
    await pruneAll();
    const session = await getSession<LaunchSession>(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    res.json({
      description: session.description,
      meta: session.meta,
      rpcUrl: session.rpcUrl,
      phase: session.phase,
      csrfToken: session.csrfToken,
    });
  });

  /* Phase 1: Wallet connects → build launch tx (token creation). */
  app.post("/api/launch/:sessionId/connect", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<LaunchSession>(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
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
      const secretBytes = Buffer.from(session.mintKeypairSecret, "base64");
      if (secretBytes.length !== 64) {
        res.status(410).json({ error: `Invalid keypair: expected 64 bytes, got ${secretBytes.length}` });
        return;
      }
      const mintKeypair = Keypair.fromSecretKey(new Uint8Array(secretBytes));

      const result = await buildLaunchTx(
        wallet,
        session.metadataUri,
        session.tokenName,
        session.tokenSymbol,
        session.initialBuySol,
        session.slippage,
        session.priorityFee,
        mintKeypair,
      );

      session.wallet = wallet;
      session.launchTx = result.transaction;
      session.phase = "launch";
      const newCsrf = await rotateCsrfToken(session, req.params.sessionId);

      res.json({
        phase: "launch",
        transactions: [result.transaction],
        description: `Launch $${session.tokenSymbol} (initial buy: ${session.initialBuySol} SOL)`,
        csrfToken: newCsrf,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /* Phase 2: Launch tx signed & confirmed → build fee config txs. */
  app.post("/api/launch/:sessionId/launch-signed", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<LaunchSession>(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    if (session.phase !== "launch") {
      res.status(400).json({ error: `Expected phase 'launch', got '${session.phase}'.` });
      return;
    }

    session.signatures.push(...(req.body.signatures || []));

    try {
      const claimers = session.claimersArray.map((c) => (c === WALLET_PLACEHOLDER ? session.wallet! : c));
      const result = await buildFeeConfigTxs(
        session.wallet!,
        session.mintPublicKey,
        claimers,
        session.basisPointsArray,
      );

      session.feeConfigTxs = result.transactions;
      session.phase = "fee_config";
      const newCsrf = await rotateCsrfToken(session, req.params.sessionId);

      res.json({
        phase: "fee_config",
        transactions: result.transactions,
        description: `Fee setup for $${session.tokenSymbol}`,
        csrfToken: newCsrf,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /* Phase 3: Fee config signed → done. */
  app.post("/api/launch/:sessionId/complete", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<LaunchSession>(req.params.sessionId);
    if (!session || session.type !== "launch") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    session.signatures.push(...(req.body.signatures || []));
    session.phase = "complete";
    session.mintKeypairSecret = "0".repeat(session.mintKeypairSecret.length);
    keypairStore.delete(req.params.sessionId);
    await setSession(req.params.sessionId, session);
    res.json({ ok: true });
  });
}

/** Whitelisted Solana RPC methods safe for browser-side calls. */
const ALLOWED_RPC_METHODS = [
  "getBalance",
  "getTokenAccountsByOwner",
  "getTransaction",
  "getSignaturesForAddress",
  "sendTransaction",
  "confirmTransaction",
  "getLatestBlockhash",
  "getRecentBlockhash",
] as const;

/** Session cleanup interval in milliseconds (5 minutes). */
const SESSION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Register proxy routes for RPC and news endpoints.
 * Keeps API keys and RPC URLs server-side, exposes only whitelisted methods.
 * @param app - Express app instance.
 */
function registerProxyRoutes(app: express.Express): void {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  app.post("/api/rpc", express.json(), async (req, res) => {
    const { method, params } = req.body;
    if (!ALLOWED_RPC_METHODS.includes(method)) {
      res.status(403).json({ error: "Method not allowed" });
      return;
    }
    try {
      const rpcRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      res.json(await rpcRes.json());
    } catch {
      res.status(502).json({ error: "RPC call failed" });
    }
  });

  app.get("/api/news", async (_req, res) => {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/news?page=1");
      const data = await r.json();
      res.json(data);
    } catch {
      res.status(502).json({ data: [] });
    }
  });

  app.get("/api/proxy/trending", async (_req, res) => {
    try {
      const r = await fetch("https://frontend-api-v3.pump.fun/coins/currently-live?limit=30&offset=0&includeNsfw=false");
      res.json(await r.json());
    } catch {
      res.status(502).json([]);
    }
  });

  app.get("/api/proxy/coingecko", async (req, res) => {
    try {
      const qs = new URLSearchParams(req.query as Record<string, string>).toString();
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?${qs}`);
      res.json(await r.json());
    } catch {
      res.status(502).json({ error: "CoinGecko fetch failed" });
    }
  });

  app.get("/api/proxy/token/:mint", async (req, res) => {
    try {
      const mintParam = req.params.mint.replace(/[^A-Za-z0-9]/g, "");
      const r = await fetch(`https://frontend-api-v3.pump.fun/coins/${mintParam}`);
      if (r.ok) {
        res.json(await r.json());
      } else {
        res.status(r.status).json({ error: "Not found" });
      }
    } catch {
      res.status(502).json({ error: "Fetch failed" });
    }
  });

  app.get("/api/proxy/wallet-history/:wallet", async (req, res) => {
    const wallet = req.params.wallet.replace(/[^A-Za-z0-9]/g, "");
    const heliusKey = (process.env.SOLANA_RPC_URL || "").match(/api-key=([^&]+)/)?.[1];
    if (!heliusKey) {
      res.status(500).json({ error: "No Helius API key configured" });
      return;
    }
    try {
      const r = await fetch(
        `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${heliusKey}&type=SWAP&limit=50`,
      );
      if (r.ok) {
        res.json(await r.json());
      } else {
        res.status(r.status).json({ error: "Helius error" });
      }
    } catch {
      res.status(502).json([]);
    }
  });
}

/**
 * Start a recurring session cleanup interval.
 * Overwrites keypair material before deleting expired sessions.
 */
function startSessionCleanup(): void {
  setInterval(async () => {
    try {
      for (const [id] of keypairStore) {
        const session = await getSession<Session>(id);
        if (!session || Date.now() - session.createdAt > FLAGS.SESSION_TTL) {
          const secret = keypairStore.get(id);
          if (secret) secret.fill(0);
          keypairStore.delete(id);
        }
      }
      await pruneAll();
    } catch {
      /* cleanup is best-effort */
    }
  }, SESSION_CLEANUP_INTERVAL_MS);
}

/**
 * Start the signing server (idempotent — only starts once).
 * Binds to 127.0.0.1 only for security.
 */
export function startSigningServer(): void {
  if (serverRunning) return;
  serverRunning = true;

  const pages = loadPages();
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false, hsts: false }));
  app.use(rateLimit({ windowMs: 60_000, max: 120, message: { error: "Rate limit exceeded" } }));
  app.use("/api/scout", rateLimit({ windowMs: 60_000, max: 30 }));
  app.use("/api/rpc", rateLimit({ windowMs: 60_000, max: 120 }));

  app.use(express.json());
  app.use("/static", express.static(resolve(dirname(fileURLToPath(import.meta.url)), ".")));
  app.use("/fonts", express.static(resolve(dirname(fileURLToPath(import.meta.url)), "fonts")));
  registerProxyRoutes(app);
  registerRoutes(app, pages);

  startSessionCleanup();

   
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const debugLog = `[express-error] ${new Date().toISOString()}\n${err.message}\n${err.stack}\n---\n`;
    process.stderr.write(debugLog);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });

  app.listen(SIGNING_PORT, "127.0.0.1", () => {
    console.error(`[pumpsdk] Signing server at http://localhost:${SIGNING_PORT}`);
  });
}

/**
 * Create a new pre-built signing session and return its URL.
 * @param transactions - Base64 or base58 encoded transactions.
 * @param description - What the user is signing (shown on the page).
 * @param meta - Key-value pairs displayed as token details.
 * @returns The localhost URL for the signing page.
 */
export async function createSigningSession(
  transactions: string[],
  description: string,
  meta: Record<string, string>,
): Promise<string> {
  startSigningServer();
  await pruneAll();

  const id = randomUUID();
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  await setSession(id, {
    type: "sign",
    id,
    csrfToken: generateCsrfToken(),
    transactions,
    description,
    meta,
    rpcUrl,
    signatures: [],
    complete: false,
    createdAt: Date.now(),
  } satisfies SigningSession);

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
 * Create a launch session — wallet comes from the page, not from chat.
 * Generates a mint keypair upfront so the same mint is used for launch and fee config.
 * @param params - Token details and fee split info.
 * @returns The localhost URL for the launch page.
 */
export async function createLaunchSession(params: LaunchSessionParams): Promise<string> {
  startSigningServer();
  await pruneAll();

  const id = randomUUID();
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  const mintKeypair = Keypair.generate();
  const mintPublicKey = mintKeypair.publicKey.toBase58();
  keypairStore.set(id, mintKeypair.secretKey);

  await setSession(id, {
    type: "launch",
    id,
    csrfToken: generateCsrfToken(),
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
    mintPublicKey,
    mintKeypairSecret: Buffer.from(mintKeypair.secretKey).toString("base64"),
    feeConfigTxs: [],
    launchTx: null,
    signatures: [],
    createdAt: Date.now(),
  } satisfies LaunchSession);

  return `http://localhost:${SIGNING_PORT}/launch/${id}`;
}

/**
 * Register routes for scout sessions (image preview + SOL slider + multi-phase signing).
 * Flow: preview → approve → launch → fee_config → complete.
 * @param app - Express app instance.
 * @param scoutPageHtml - Pre-loaded scout page HTML.
 */
function registerScoutRoutes(app: express.Express, scoutPageHtml: string): void {
  app.get("/scout/:sessionId", (_req, res) => {
    res.type("html").send(scoutPageHtml);
  });

  app.get("/api/scout/:sessionId", async (req, res) => {
    await pruneAll();
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }
    res.json({
      tokenName: session.tokenName,
      tokenSymbol: session.tokenSymbol,
      description: session.description,
      meta: session.meta,
      imageUrl: session.imageUrl,
      rpcUrl: session.rpcUrl,
      phase: session.phase,
      csrfToken: session.csrfToken,
      mintPublicKey: session.mintPublicKey,
      initialBuySol: session.initialBuySol,
    });
  });

  app.post("/api/scout/:sessionId/regenerate", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    if (session.regenerationCount >= MAX_REGENERATIONS_PER_SESSION) {
      res.status(429).json({ error: `Maximum ${MAX_REGENERATIONS_PER_SESSION} image regenerations per session.` });
      return;
    }

    try {
      session.regenerationCount += 1;
      const imageUrl = await generateTokenImage(session.imagePrompt);
      session.imageUrl = imageUrl;
      const newCsrf = await rotateCsrfToken(session, req.params.sessionId);
      res.json({ imageUrl, csrfToken: newCsrf });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/scout/:sessionId/update", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    if (session.phase !== "preview") {
      res.status(400).json({ error: "Cannot update after preview phase." });
      return;
    }

    const { tokenName, tokenSymbol, description, generateImage, customPrompt } = req.body;
    if (typeof tokenName === "string") session.tokenName = tokenName.trim();
    if (typeof tokenSymbol === "string") session.tokenSymbol = tokenSymbol.trim().toUpperCase();
    if (typeof description === "string") session.description = description.trim();

    session.meta = { Name: session.tokenName, Symbol: session.tokenSymbol };

    if (generateImage && session.tokenName && session.tokenSymbol && process.env.FAL_API_KEY) {
      try {
        session.imagePrompt =
          typeof customPrompt === "string" && customPrompt.trim().length > 0
            ? customPrompt.trim()
            : buildImagePrompt(session.tokenName, session.tokenSymbol, session.description);
        session.imageUrl = await generateTokenImage(session.imagePrompt);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await setSession(req.params.sessionId, session);
        res.status(500).json({ error: `Image generation failed: ${msg}` });
        return;
      }
    }

    const newCsrf = await rotateCsrfToken(session, req.params.sessionId);
    res.json({
      tokenName: session.tokenName,
      tokenSymbol: session.tokenSymbol,
      description: session.description,
      imageUrl: session.imageUrl,
      csrfToken: newCsrf,
    });
  });

  app.post("/api/scout/:sessionId/approve", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }

    const { wallet } = req.body;
    if (!wallet || typeof wallet !== "string") {
      res.status(400).json({ error: "Missing wallet." });
      return;
    }

    try {
      const metadataUri = await uploadToIpfs({
        name: session.tokenName,
        symbol: session.tokenSymbol,
        description: session.description,
        imageUrl: session.imageUrl || "",
      });

      const secretBytes = Buffer.from(session.mintKeypairSecret, "base64");
      if (secretBytes.length !== 64) {
        res.status(410).json({ error: `Invalid keypair: expected 64 bytes, got ${secretBytes.length}` });
        return;
      }
      const mintKeypair = Keypair.fromSecretKey(new Uint8Array(secretBytes));
      const buySol = session.initialBuySol;

      const result = await buildLaunchTx(
        wallet,
        metadataUri,
        session.tokenName,
        session.tokenSymbol,
        buySol,
        session.slippage,
        session.priorityFee,
        mintKeypair,
      );

      session.wallet = wallet;
      session.metadataUri = metadataUri;
      session.initialBuySol = buySol;
      session.phase = "launch";
      const newCsrf = await rotateCsrfToken(session, req.params.sessionId);

      res.json({
        phase: "launch",
        transactions: [result.transaction],
        description: `Launch $${session.tokenSymbol} (dev buy: ${buySol} SOL)`,
        csrfToken: newCsrf,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : "";
      const debugLog = `[approve] ${new Date().toISOString()}\nError: ${msg}\nStack: ${stack}\n---\n`;
      process.stderr.write(debugLog);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/scout/:sessionId/launch-signed", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    if (session.phase !== "launch") {
      res.status(400).json({ error: `Expected phase 'launch', got '${session.phase}'.` });
      return;
    }

    session.signatures.push(...(req.body.signatures || []));

    try {
      /* If dev buy > 0, chain a buy tx before fee config */
      if (session.initialBuySol > 0) {
        const buyTx = await buildDevBuyTx(
          session.wallet!,
          session.mintPublicKey,
          session.initialBuySol,
          session.slippage,
          session.priorityFee,
        );

        session.phase = "dev_buy";
        const newCsrf = await rotateCsrfToken(session, req.params.sessionId);

        res.json({
          phase: "dev_buy",
          transactions: [buyTx],
          description: `Dev buy ${session.initialBuySol} SOL of $${session.tokenSymbol}`,
          csrfToken: newCsrf,
        });
        return;
      }

      const claimers = session.claimersArray.map((c) => (c === WALLET_PLACEHOLDER ? session.wallet! : c));
      const result = await buildFeeConfigTxs(
        session.wallet!,
        session.mintPublicKey,
        claimers,
        session.basisPointsArray,
      );

      session.phase = "fee_config";
      const newCsrf = await rotateCsrfToken(session, req.params.sessionId);

      res.json({
        phase: "fee_config",
        transactions: result.transactions,
        description: `Fee setup for $${session.tokenSymbol}`,
        csrfToken: newCsrf,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  /* After dev buy is signed, chain to fee config */
  app.post("/api/scout/:sessionId/dev-buy-signed", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    if (session.phase !== "dev_buy") {
      res.status(400).json({ error: `Expected phase 'dev_buy', got '${session.phase}'.` });
      return;
    }

    session.signatures.push(...(req.body.signatures || []));

    try {
      const claimers = session.claimersArray.map((c) => (c === WALLET_PLACEHOLDER ? session.wallet! : c));
      const result = await buildFeeConfigTxs(
        session.wallet!,
        session.mintPublicKey,
        claimers,
        session.basisPointsArray,
      );

      session.phase = "fee_config";
      const newCsrf = await rotateCsrfToken(session, req.params.sessionId);

      res.json({
        phase: "fee_config",
        transactions: result.transactions,
        description: `Fee setup for $${session.tokenSymbol}`,
        csrfToken: newCsrf,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/scout/:sessionId/complete", async (req, res) => {
    if (!isValidOriginForPost(req)) {
      res.status(403).json({ error: "Invalid origin." });
      return;
    }
    const session = await getSession<ScoutSession>(req.params.sessionId);
    if (!session || session.type !== "scout") {
      res.status(404).json({ error: "Session not found." });
      return;
    }
    if (!isValidCsrf(req, session)) {
      res.status(403).json({ error: "Invalid CSRF token." });
      return;
    }
    session.signatures.push(...(req.body.signatures || []));
    session.phase = "complete";
    session.mintKeypairSecret = "0".repeat(session.mintKeypairSecret.length);
    keypairStore.delete(req.params.sessionId);
    await setSession(req.params.sessionId, session);
    res.json({ ok: true });
  });
}

/** Parameters for creating a scout session. */
export interface ScoutSessionParams {
  tokenName?: string;
  tokenSymbol?: string;
  description?: string;
  imageUrl?: string;
  initialBuySol?: number;
  claimersArray?: string[];
  basisPointsArray?: number[];
  slippage?: number;
  priorityFee?: number;
  meta?: Record<string, string>;
}

/**
 * Create a scout session — AI-generated token with image preview and SOL slider.
 * Optionally generates an image via fal.ai if no imageUrl is provided.
 * @param params - Token details.
 * @returns The localhost URL for the scout page.
 */
export async function createScoutSession(params: ScoutSessionParams = {}): Promise<string> {
  startSigningServer();
  await pruneAll();

  const id = randomUUID();
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  const mintKeypair = Keypair.generate();
  const mintPublicKey = mintKeypair.publicKey.toBase58();
  keypairStore.set(id, mintKeypair.secretKey);

  const tokenName = params.tokenName || "";
  const tokenSymbol = params.tokenSymbol || "";
  const description = params.description || "";
  const hasToken = tokenName.length > 0 && tokenSymbol.length > 0;

  const imagePrompt = hasToken ? buildImagePrompt(tokenName, tokenSymbol, description) : "";

  let imageUrl = params.imageUrl || null;
  if (!imageUrl && hasToken && process.env.FAL_API_KEY) {
    try {
      imageUrl = await generateTokenImage(imagePrompt);
    } catch {
      /* image gen is optional — proceed without */
    }
  }

  const FULL_BPS = 10_000;
  await setSession(id, {
    type: "scout",
    id,
    csrfToken: generateCsrfToken(),
    tokenName,
    tokenSymbol,
    description,
    imageUrl,
    imagePrompt,
    claimersArray: params.claimersArray || [WALLET_PLACEHOLDER],
    basisPointsArray: params.basisPointsArray || [FULL_BPS],
    slippage: params.slippage ?? 10,
    priorityFee: params.priorityFee ?? 0.0005,
    meta: params.meta || (hasToken ? { Name: tokenName, Symbol: tokenSymbol.toUpperCase() } : {}),
    rpcUrl,
    phase: "preview",
    wallet: null,
    mintPublicKey,
    mintKeypairSecret: Buffer.from(mintKeypair.secretKey).toString("base64"),
    metadataUri: null,
    initialBuySol: params.initialBuySol ?? 0,
    signatures: [],
    regenerationCount: 0,
    createdAt: Date.now(),
  } satisfies ScoutSession);

  return `http://localhost:${SIGNING_PORT}/scout/${id}`;
}

/**
 * Check whether a session has been completed.
 * @param sessionId - The session UUID.
 * @returns The session if complete, null otherwise.
 */
export async function getSessionStatus(sessionId: string): Promise<Session | null> {
  const session = await getSession<Session>(sessionId);
  if (!session) return null;
  if (session.type === "sign") return session.complete ? session : null;
  return session.phase === "complete" ? session : null;
}

export { WALLET_PLACEHOLDER };
