/** JSON-backed local store for partner/referral configurations. */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const STORE_DIR = ".partners";
const STORE_FILE = "partners.json";

/** A partner configuration with wallet and fee allocation. */
export interface PartnerConfig {
  partnerId: string;
  walletAddress: string;
  feeBps: number;
  label: string;
  createdAt: number;
}

type StoreData = Record<string, PartnerConfig>;

let lock: Promise<void> = Promise.resolve();

/**
 * Serialize store access to prevent TOCTOU races.
 * @param fn - Async function to run inside the lock.
 * @returns The result of fn.
 */
function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = lock.then(fn, fn);
  lock = next.then(
    () => {},
    () => {},
  );
  return next;
}

/**
 * Resolve the store file path relative to the process working directory.
 * @returns Absolute path to partners.json.
 */
function storePath(): string {
  return resolve(process.cwd(), STORE_DIR, STORE_FILE);
}

/**
 * Read the entire store from disk.
 * @returns All partner configs keyed by partnerId.
 */
function readStore(): StoreData {
  const fp = storePath();
  if (!existsSync(fp)) return {};
  const raw = readFileSync(fp, "utf-8");
  return JSON.parse(raw) as StoreData;
}

/**
 * Write the entire store to disk atomically.
 * @param data - Full store data.
 */
function writeStore(data: StoreData): void {
  const fp = storePath();
  const dir = resolve(process.cwd(), STORE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fp, JSON.stringify(data, null, 2));
}

/**
 * Get a partner config by ID.
 * @param partnerId - The partner identifier.
 * @returns The partner config or undefined.
 */
export function getPartner(partnerId: string): Promise<PartnerConfig | undefined> {
  return withLock(async () => {
    const store = readStore();
    return store[partnerId];
  });
}

/**
 * Save or update a partner config.
 * @param config - The partner config to save.
 */
export function setPartner(config: PartnerConfig): Promise<void> {
  return withLock(async () => {
    const store = readStore();
    store[config.partnerId] = config;
    writeStore(store);
  });
}

/**
 * List all partner configs.
 * @returns Array of all stored partner configs.
 */
export function listPartners(): Promise<PartnerConfig[]> {
  return withLock(async () => {
    const store = readStore();
    return Object.values(store);
  });
}

/**
 * Delete a partner config by ID.
 * @param partnerId - The partner identifier to remove.
 */
export function deletePartner(partnerId: string): Promise<void> {
  return withLock(async () => {
    const store = readStore();
    delete store[partnerId];
    writeStore(store);
  });
}
