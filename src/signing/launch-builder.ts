/** Builds fee config and launch transactions for the two-phase signing flow. */

import { Keypair, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { PUMP_SDK } from "@pump-fun/pump-sdk";

import { portalPostBinary } from "../client/pump-rest.js";

const MAX_SHAREHOLDERS = 10;
const BPS_TOTAL = 10_000;

/** Result from building fee config transactions. */
export interface FeeConfigResult {
  transactions: string[];
}

/** Result from building the launch transaction. */
export interface LaunchTxResult {
  transaction: string;
  mintAddress: string;
}

/**
 * Validate that basis points sum to 10000 and contain no invalid entries.
 * @param basisPoints - Array of BPS values.
 * @returns Object with valid flag and error messages.
 */
function validateBps(basisPoints: number[]): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (basisPoints.length === 0) {
    errors.push("At least one shareholder required");
  }
  if (basisPoints.length > MAX_SHAREHOLDERS) {
    errors.push(`Maximum ${MAX_SHAREHOLDERS} shareholders allowed`);
  }

  for (let i = 0; i < basisPoints.length; i++) {
    if (basisPoints[i] <= 0) {
      errors.push(`Shareholder ${i} has zero or negative BPS`);
    }
  }

  const sum = basisPoints.reduce((a, b) => a + b, 0);
  if (sum !== BPS_TOTAL) {
    errors.push(`BPS total is ${sum}, must be exactly ${BPS_TOTAL}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Find duplicate wallet addresses in the claimers array.
 * @param claimers - Wallet addresses to check.
 * @returns Array of duplicated addresses.
 */
function findDuplicates(claimers: string[]): string[] {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const addr of claimers) {
    if (seen.has(addr)) dupes.push(addr);
    seen.add(addr);
  }
  return dupes;
}

/**
 * Build fee sharing config transactions using @pump-fun/pump-sdk.
 * Creates a SharingConfig PDA and sets up fee distribution for the token.
 * @param wallet - The creator wallet address (from signing page connect).
 * @param tokenMint - Token mint address.
 * @param claimersArray - Resolved wallet addresses for fee claimers.
 * @param basisPointsArray - BPS allocations summing to 10000.
 * @returns Fee config transactions as base64-encoded strings.
 */
export async function buildFeeConfigTxs(
  wallet: string,
  tokenMint: string,
  claimersArray: string[],
  basisPointsArray: number[],
): Promise<FeeConfigResult> {
  const bpsCheck = validateBps(basisPointsArray);
  if (!bpsCheck.valid) {
    throw new Error(`Invalid fee config: ${bpsCheck.errors.join(", ")}`);
  }

  const dupes = findDuplicates(claimersArray);
  if (dupes.length > 0) {
    throw new Error(`Duplicate wallet addresses: ${dupes.join(", ")}`);
  }

  const creatorKey = new PublicKey(wallet);
  const mintKey = new PublicKey(tokenMint);

  const createConfigIx = await PUMP_SDK.createFeeSharingConfig({
    creator: creatorKey,
    mint: mintKey,
    pool: null,
  });

  const shareholders = claimersArray.map((addr, i) => ({
    address: new PublicKey(addr),
    shareBps: basisPointsArray[i],
  }));

  const updateSharesIx = await PUMP_SDK.updateFeeShares({
    authority: creatorKey,
    mint: mintKey,
    currentShareholders: [creatorKey],
    newShareholders: shareholders,
  });

  const { blockhash } = await getRecentBlockhash();

  const message = new TransactionMessage({
    payerKey: creatorKey,
    recentBlockhash: blockhash,
    instructions: [createConfigIx, updateSharesIx],
  }).compileToV0Message();

  const tx = new VersionedTransaction(message);
  const txBase64 = Buffer.from(tx.serialize()).toString("base64");

  return { transactions: [txBase64] };
}

/**
 * Build the create-token transaction via PumpPortal, partially signed with a mint keypair.
 * Uses the provided keypair if given, otherwise generates a fresh one.
 * @param wallet - The creator wallet address.
 * @param metadataUri - IPFS URI for token metadata.
 * @param name - Token name.
 * @param symbol - Token symbol.
 * @param initialBuySol - Initial dev buy in SOL.
 * @param slippage - Slippage tolerance percentage.
 * @param priorityFee - Priority fee in SOL.
 * @param existingMintKeypair - Pre-generated keypair from session (ensures mint matches fee config).
 * @returns The partially-signed transaction and mint address.
 */
export async function buildLaunchTx(
  wallet: string,
  metadataUri: string,
  name: string,
  symbol: string,
  initialBuySol: number,
  slippage: number,
  priorityFee: number,
  existingMintKeypair?: Keypair,
): Promise<LaunchTxResult> {
  const mintKeypair = existingMintKeypair ?? Keypair.generate();
  const mintAddress = mintKeypair.publicKey.toBase58();

  const body = {
    publicKey: wallet,
    action: "create",
    tokenMetadata: { name, symbol, uri: metadataUri },
    mint: mintAddress,
    denominatedInSol: "true",
    amount: 0,
    slippage,
    priorityFee,
    pool: "pump",
  };

  console.error("[buildLaunchTx] POST /trade-local body:", JSON.stringify(body));
  const txBytes = await portalPostBinary("/trade-local", body);
  const tx = VersionedTransaction.deserialize(txBytes);
  tx.sign([mintKeypair]);

  const txBase64 = Buffer.from(tx.serialize()).toString("base64");
  return { transaction: txBase64, mintAddress };
}

/**
 * Build a dev-buy transaction for an already-created token.
 * Called after the create tx is confirmed on-chain.
 * @param wallet - The buyer wallet address.
 * @param mintAddress - The token mint address.
 * @param buySol - Amount of SOL to spend on the dev buy.
 * @param slippage - Slippage tolerance percentage.
 * @param priorityFee - Priority fee in SOL.
 * @returns Base64-encoded serialized transaction.
 */
export async function buildDevBuyTx(
  wallet: string,
  mintAddress: string,
  buySol: number,
  slippage: number,
  priorityFee: number,
): Promise<string> {
  const body = {
    publicKey: wallet,
    action: "buy",
    mint: mintAddress,
    denominatedInSol: "true",
    amount: buySol,
    slippage,
    priorityFee,
    pool: "pump",
  };

  console.error("[buildDevBuyTx] POST /trade-local body:", JSON.stringify(body));
  const txBytes = await portalPostBinary("/trade-local", body);
  const tx = VersionedTransaction.deserialize(txBytes);
  const txBase64 = Buffer.from(tx.serialize()).toString("base64");
  return txBase64;
}

/**
 * Fetch a recent blockhash from the configured RPC endpoint.
 * @returns The blockhash and last valid block height.
 */
async function getRecentBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "confirmed" }],
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC getLatestBlockhash failed: HTTP ${res.status}`);
  }

  const json = (await res.json()) as { result: { value: { blockhash: string; lastValidBlockHeight: number } } };
  return json.result.value;
}
