/** Local signing server — serves wallet-connect pages for transaction signing and token launches. */

import express from "express";
import { randomUUID, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

import { buildFeeConfigTxs, buildLaunchTx } from "./launch-builder.js";
import { getSession, setSession, pruneAll } from "./session-store.js";
import { generateTokenImage, buildImagePrompt } from "../client/imagegen.js";
import { uploadToIpfs } from "../client/ipfs.js";
import { SIGNING_PORT, WALLET_PLACEHOLDER, ALLOWED_ORIGIN, CSRF_TOKEN_BYTES } from "../utils/constants.js";

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
  phase: "preview" | "launch" | "fee_config" | "complete";
  wallet: string | null;
  mintPublicKey: string;
  mintKeypairSecret: string;
  metadataUri: string | null;
  initialBuySol: number;
  signatures: string[];
  createdAt: number;
}

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
 * Validate the request origin header against the allowed localhost origin.
 * @param req - Express request.
 * @returns True if origin is valid or absent (same-origin requests omit it).
 */
function isValidOrigin(req: express.Request): boolean {
  const origin = req.headers.origin;
  return !origin || origin === ALLOWED_ORIGIN;
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
 * Load HTML page templates relative to this module.
 */
function loadPages(): { page: string; scoutPage: string } {
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return {
    page: readFileSync(resolve(thisDir, "page.html"), "utf-8"),
    scoutPage: readFileSync(resolve(thisDir, "scout-page.html"), "utf-8"),
  };
}

/**
 * Register all signing, launch, and scout API routes on the Express app.
 * @param app - Express app instance.
 * @param pages - Pre-loaded HTML page content.
 */
function registerRoutes(app: express.Express, pages: { page: string; scoutPage: string }): void {
  registerSignRoutes(app, pages.page);
  registerLaunchRoutes(app, pages.page);
  registerScoutRoutes(app, pages.scoutPage);
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
    if (!isValidOrigin(req)) {
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
    if (!isValidOrigin(req)) {
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
      const secretKey = keypairStore.get(req.params.sessionId);
      if (!secretKey) {
        res.status(410).json({ error: "Session keypair expired." });
        return;
      }
      const mintKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));

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
      await setSession(req.params.sessionId, session);

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

  /* Phase 2: Launch tx signed & confirmed → build fee config txs. */
  app.post("/api/launch/:sessionId/launch-signed", async (req, res) => {
    if (!isValidOrigin(req)) {
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
      await setSession(req.params.sessionId, session);

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

  /* Phase 3: Fee config signed → done. */
  app.post("/api/launch/:sessionId/complete", async (req, res) => {
    if (!isValidOrigin(req)) {
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
    keypairStore.delete(req.params.sessionId);
    await setSession(req.params.sessionId, session);
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

  const pages = loadPages();
  const app = express();
  app.use(express.json());
  app.use("/static", express.static(resolve(dirname(fileURLToPath(import.meta.url)), ".")));
  registerRoutes(app, pages);

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
    mintKeypairSecret: "IN_MEMORY",
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
    });
  });

  app.post("/api/scout/:sessionId/regenerate", async (req, res) => {
    if (!isValidOrigin(req)) {
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

    try {
      const imageUrl = await generateTokenImage(session.imagePrompt);
      session.imageUrl = imageUrl;
      await setSession(req.params.sessionId, session);
      res.json({ imageUrl });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/scout/:sessionId/update", async (req, res) => {
    if (!isValidOrigin(req)) {
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

    await setSession(req.params.sessionId, session);
    res.json({
      tokenName: session.tokenName,
      tokenSymbol: session.tokenSymbol,
      description: session.description,
      imageUrl: session.imageUrl,
    });
  });

  app.post("/api/scout/:sessionId/approve", async (req, res) => {
    if (!isValidOrigin(req)) {
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

    const { wallet, initialBuySol } = req.body;
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

      const secretKey = keypairStore.get(req.params.sessionId);
      if (!secretKey) {
        res.status(410).json({ error: "Session keypair expired." });
        return;
      }
      const mintKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
      const buySol = typeof initialBuySol === "number" ? initialBuySol : 0;

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
      await setSession(req.params.sessionId, session);

      res.json({
        phase: "launch",
        transactions: [result.transaction],
        description: `Launch $${session.tokenSymbol} (dev buy: ${buySol} SOL)`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post("/api/scout/:sessionId/launch-signed", async (req, res) => {
    if (!isValidOrigin(req)) {
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
      const claimers = session.claimersArray.map((c) => (c === WALLET_PLACEHOLDER ? session.wallet! : c));
      const result = await buildFeeConfigTxs(
        session.wallet!,
        session.mintPublicKey,
        claimers,
        session.basisPointsArray,
      );

      session.phase = "fee_config";
      await setSession(req.params.sessionId, session);

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

  app.post("/api/scout/:sessionId/complete", async (req, res) => {
    if (!isValidOrigin(req)) {
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
    mintKeypairSecret: "IN_MEMORY",
    metadataUri: null,
    initialBuySol: 0,
    signatures: [],
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
