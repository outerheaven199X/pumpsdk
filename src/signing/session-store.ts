/** File-backed session store with in-memory mutex to prevent TOCTOU races. */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

import { FLAGS } from "../utils/flags.js";

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const STORE_DIR = resolve(THIS_DIR, "../../.sessions");
const STORE_PATH = resolve(STORE_DIR, "sessions.json");

/** AES-256-GCM parameters. */
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const SALT = "pumpsdk-session-store";

type StoreData = Record<string, unknown>;

/** Process-level mutex — serialises all read-modify-write cycles. */
let lockPromise: Promise<void> = Promise.resolve();

/**
 * Derive a 256-bit key from the PUMPSDK_SESSION_KEY env var using scrypt.
 * Cached after first call to avoid repeated key derivation.
 */
let derivedKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (derivedKey) return derivedKey;
  const raw = process.env.PUMPSDK_SESSION_KEY;
  if (!raw) {
    throw new Error("PUMPSDK_SESSION_KEY is required when PUMPSDK_ENCRYPT_SESSIONS=1");
  }
  derivedKey = scryptSync(raw, SALT, KEY_LENGTH);
  return derivedKey;
}

/**
 * Encrypt a UTF-8 string with AES-256-GCM.
 * @param plaintext - The JSON string to encrypt.
 * @returns Base64-encoded string: iv + authTag + ciphertext.
 */
function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

/**
 * Decrypt an AES-256-GCM encrypted string.
 * @param encoded - Base64-encoded string: iv + authTag + ciphertext.
 * @returns Decrypted UTF-8 plaintext.
 */
function decrypt(encoded: string): string {
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf-8");
}

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
 * When encryption is enabled, decrypts the file contents before parsing.
 */
function readStore(): StoreData {
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const json = FLAGS.ENCRYPT_SESSIONS ? decrypt(raw) : raw;
    return JSON.parse(json) as StoreData;
  } catch {
    return {};
  }
}

/**
 * Write the full store to disk.
 * When encryption is enabled, encrypts the JSON before writing.
 * @param data - The session map to persist.
 */
function writeStore(data: StoreData): void {
  mkdirSync(STORE_DIR, { recursive: true });
  const json = JSON.stringify(data);
  const output = FLAGS.ENCRYPT_SESSIONS ? encrypt(json) : json;
  writeFileSync(STORE_PATH, output, "utf-8");
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
    if (now - ((record?.createdAt as number) ?? 0) > FLAGS.SESSION_TTL) {
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
