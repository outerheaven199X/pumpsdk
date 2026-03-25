/** File-backed session store with in-memory mutex to prevent TOCTOU races. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { SESSION_TTL_MS } from "../utils/constants.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(THIS_DIR, "../../.sessions");
const STORE_PATH = resolve(STORE_DIR, "sessions.json");

type StoreData = Record<string, unknown>;

/** Process-level mutex — serialises all read-modify-write cycles. */
let lockPromise: Promise<void> = Promise.resolve();

/**
 * Acquire the store lock, run the critical section, then release.
 * @param fn - Function that reads and/or writes the store.
 * @returns Whatever fn returns.
 */
function withLock<T>(fn: () => T): Promise<T> {
  let release: () => void;
  const next = new Promise<void>((res) => {
    release = res;
  });
  const prev = lockPromise;
  lockPromise = next;

  return prev.then(() => {
    try {
      return fn();
    } finally {
      release!();
    }
  });
}

/**
 * Read the full store from disk. Returns empty object if file missing or corrupt.
 */
function readStore(): StoreData {
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as StoreData;
  } catch {
    return {};
  }
}

/**
 * Write the full store to disk.
 * @param data - The session map to persist.
 */
function writeStore(data: StoreData): void {
  mkdirSync(STORE_DIR, { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(data), "utf-8");
}

/**
 * Remove expired sessions from a store object (mutates in place).
 * @param store - The store data to prune.
 * @returns True if any entries were removed.
 */
function pruneExpiredEntries(store: StoreData): boolean {
  const now = Date.now();
  let changed = false;
  for (const [id, session] of Object.entries(store)) {
    const record = session as Record<string, unknown> | null;
    if (now - ((record?.createdAt as number) ?? 0) > SESSION_TTL_MS) {
      delete store[id];
      changed = true;
    }
  }
  return changed;
}

/**
 * Get a session by ID, pruning expired entries first.
 * @param id - Session UUID.
 * @returns The session object or undefined if not found/expired.
 */
export function getSession<T>(id: string): Promise<T | undefined> {
  return withLock(() => {
    const store = readStore();
    const pruned = pruneExpiredEntries(store);
    if (pruned) writeStore(store);
    return store[id] as T | undefined;
  });
}

/**
 * Save or update a session by ID.
 * @param id - Session UUID.
 * @param session - The session data to persist.
 */
export function setSession(id: string, session: unknown): Promise<void> {
  return withLock(() => {
    const store = readStore();
    pruneExpiredEntries(store);
    store[id] = session;
    writeStore(store);
  });
}

/**
 * Delete a session by ID.
 * @param id - Session UUID.
 */
export function deleteSession(id: string): Promise<void> {
  return withLock(() => {
    const store = readStore();
    delete store[id];
    writeStore(store);
  });
}

/**
 * Remove all expired sessions from the store.
 */
export function pruneAll(): Promise<void> {
  return withLock(() => {
    const store = readStore();
    if (pruneExpiredEntries(store)) writeStore(store);
  });
}
