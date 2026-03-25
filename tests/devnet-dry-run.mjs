/**
 * Devnet Dry Run — end-to-end test of every tool and subsystem against Solana devnet.
 *
 * What CAN be tested on devnet:
 *   - Solana RPC tools (balance, holdings, send-tx)
 *   - Signing server lifecycle (create session, serve HTML, API endpoints)
 *   - Fee config building via @pump-fun/pump-sdk
 *   - Session store persistence
 *   - Cache layer
 *   - Formatting/validation utils
 *
 * What CANNOT be tested on devnet (mainnet only):
 *   - Pump.fun REST API (/coins, /coins/{mint})
 *   - PumpPortal /trade-local
 *   - PumpPortal WebSocket
 *   - IPFS upload
 *
 * Usage:
 *   SOLANA_RPC_URL=https://api.devnet.solana.com node tests/devnet-dry-run.mjs
 *   SOLANA_RPC_URL=https://api.devnet.solana.com DEVNET_WALLET=<funded_pubkey> node tests/devnet-dry-run.mjs
 */

const DEVNET_RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const DEVNET_WALLET = process.env.DEVNET_WALLET || "G8f52YVLEHen8NRqqzzqKLh3FJQDYJSNyHiusVvFdA1B";

const issues = [];
let passes = 0;
let skipped = 0;

function pass(msg) { passes++; console.log("  PASS: " + msg); }
function fail(msg) { issues.push(msg); console.log("  FAIL: " + msg); }
function skip(msg) { skipped++; console.log("  SKIP: " + msg); }

console.log("==============================================");
console.log("DEVNET DRY RUN");
console.log("RPC:    " + DEVNET_RPC);
console.log("Wallet: " + DEVNET_WALLET);
console.log("==============================================\n");

// ──────────────────────────────────────────────
// SECTION 1: Devnet RPC Connectivity
// ──────────────────────────────────────────────
console.log("--- 1. Devnet RPC Connectivity ---");
try {
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
  });
  const data = await res.json();
  if (data.result === "ok") pass("Devnet RPC healthy");
  else fail("Devnet RPC not healthy: " + JSON.stringify(data));
} catch (e) {
  fail("Devnet RPC unreachable: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 2: pump_wallet_balance on devnet
// ──────────────────────────────────────────────
console.log("\n--- 2. pump_wallet_balance (devnet) ---");
let walletBalance = 0;
try {
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [DEVNET_WALLET] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  walletBalance = (data.result?.value || 0) / 1e9;
  pass("getBalance returned " + walletBalance + " SOL");
} catch (e) {
  fail("getBalance: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 3: pump_token_holdings on devnet
// ──────────────────────────────────────────────
console.log("\n--- 3. pump_token_holdings (devnet) ---");
try {
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getTokenAccountsByOwner",
      params: [DEVNET_WALLET, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const count = data.result?.value?.length || 0;
  pass("getTokenAccountsByOwner returned " + count + " token accounts");
} catch (e) {
  fail("getTokenAccountsByOwner: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 4: pump_send_transaction (will fail without real tx, but tests RPC path)
// ──────────────────────────────────────────────
console.log("\n--- 4. pump_send_transaction (devnet, expected failure) ---");
try {
  const res = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "sendTransaction",
      params: ["AAAA", { encoding: "base64", skipPreflight: true }],
    }),
  });
  const data = await res.json();
  if (data.error) {
    // Expected — bad tx data. But proves the RPC path works.
    pass("sendTransaction RPC reachable (expected error: " + data.error.message.slice(0, 50) + ")");
  } else {
    pass("sendTransaction unexpectedly succeeded");
  }
} catch (e) {
  fail("sendTransaction RPC: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 5: Signing server + full session lifecycle
// ──────────────────────────────────────────────
console.log("\n--- 5. Signing server lifecycle ---");
let signingSessionId = null;
let launchSessionId = null;
try {
  const { createSigningSession, createLaunchSession, getSessionStatus, startSigningServer } =
    await import("../dist/src/signing/serve.js");

  // 5a: Create signing session
  const signUrl = await createSigningSession(["dGVzdA=="], "Devnet test sign", { action: "test" });
  signingSessionId = signUrl.split("/sign/")[1];
  pass("Signing session created: " + signingSessionId.slice(0, 8) + "...");

  // 5b: Create launch session
  const launchUrl = await createLaunchSession({
    metadataUri: "https://ipfs.io/ipfs/devnet-test",
    tokenName: "DevnetTest",
    tokenSymbol: "DTEST",
    claimersArray: ["__CONNECTED_WALLET__"],
    basisPointsArray: [10000],
    initialBuySol: 0,
    slippage: 10,
    priorityFee: 0.0005,
    description: "Devnet dry run",
    meta: { Name: "DevnetTest", Symbol: "DTEST" },
  });
  launchSessionId = launchUrl.split("/launch/")[1];
  pass("Launch session created: " + launchSessionId.slice(0, 8) + "...");

  // 5c: Session should not be complete
  const status = await getSessionStatus(signingSessionId);
  if (status === null) pass("Session correctly not complete");
  else fail("Session should not be complete");
} catch (e) {
  fail("Signing server: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 6: HTTP API endpoints
// ──────────────────────────────────────────────
console.log("\n--- 6. HTTP API endpoints ---");
await new Promise((r) => setTimeout(r, 500));

// 6a: Sign page HTML
try {
  const res = await fetch("http://localhost:3142/sign/" + (signingSessionId || "test"));
  if (res.ok) {
    const html = await res.text();
    if (html.includes("<!DOCTYPE") || html.includes("<html")) {
      pass("GET /sign/:id serves HTML (" + html.length + " bytes)");
    } else {
      fail("Sign page returned non-HTML content");
    }
  } else {
    fail("GET /sign/:id returned HTTP " + res.status);
  }
} catch (e) {
  fail("Sign page: " + e.message);
}

// 6b: Launch page HTML
try {
  const res = await fetch("http://localhost:3142/launch/" + (launchSessionId || "test"));
  if (res.ok) pass("GET /launch/:id serves HTML");
  else fail("GET /launch/:id returned HTTP " + res.status);
} catch (e) {
  fail("Launch page: " + e.message);
}

// 6c: Sign API returns session data
try {
  const res = await fetch("http://localhost:3142/api/sign/" + signingSessionId);
  if (res.ok) {
    const data = await res.json();
    if (data.transactions && data.description) {
      pass("GET /api/sign/:id returns session data (txs: " + data.transactions.length + ")");
    } else {
      fail("Sign API missing fields: " + JSON.stringify(Object.keys(data)));
    }
  } else {
    fail("GET /api/sign/:id HTTP " + res.status);
  }
} catch (e) {
  fail("Sign API: " + e.message);
}

// 6d: Launch API returns session metadata
try {
  const res = await fetch("http://localhost:3142/api/launch/" + launchSessionId);
  if (res.ok) {
    const data = await res.json();
    if (data.phase === "connect" && data.description) {
      pass("GET /api/launch/:id returns phase=connect");
    } else {
      fail("Launch API unexpected: " + JSON.stringify(data));
    }
  } else {
    fail("GET /api/launch/:id HTTP " + res.status);
  }
} catch (e) {
  fail("Launch API: " + e.message);
}

// 6e: 404 for nonexistent session
try {
  const res = await fetch("http://localhost:3142/api/sign/nonexistent");
  if (res.status === 404) pass("Nonexistent session returns 404");
  else fail("Expected 404, got " + res.status);
} catch (e) {
  fail("404 check: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 7: Launch connect flow (simulate wallet connect)
// ──────────────────────────────────────────────
console.log("\n--- 7. Launch connect flow ---");
if (launchSessionId) {
  try {
    // Fetch CSRF token from the GET endpoint first
    const getResp = await fetch("http://localhost:3142/api/launch/" + launchSessionId);
    const sessionData = await getResp.json();
    const csrfToken = sessionData.csrfToken || "";

    const res = await fetch("http://localhost:3142/api/launch/" + launchSessionId + "/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: DEVNET_WALLET, csrfToken }),
    });
    const data = await res.json();
    if (res.ok && data.phase === "launch" && data.transactions) {
      pass("POST /connect returned launch phase with " + data.transactions.length + " txs");
    } else if (data.error) {
      // Launch tx build may fail on devnet (PumpPortal is mainnet-only)
      console.log("  INFO: Connect returned error (expected on devnet): " + data.error.slice(0, 100));
      skip("Launch tx building requires mainnet PumpPortal");
    } else {
      fail("Unexpected connect response: " + JSON.stringify(data).slice(0, 200));
    }
  } catch (e) {
    fail("Launch connect: " + e.message);
  }
} else {
  skip("No launch session to test connect flow");
}

// ──────────────────────────────────────────────
// SECTION 8: Session store persistence
// ──────────────────────────────────────────────
console.log("\n--- 8. Session store persistence ---");
try {
  const { getSession, setSession, deleteSession, pruneAll } = await import("../dist/src/signing/session-store.js");

  // Write
  const testSession = { type: "sign", id: "devnet-test", createdAt: Date.now(), devnet: true };
  await setSession("devnet-test", testSession);
  pass("setSession wrote to disk");

  // Read
  const retrieved = await getSession("devnet-test");
  if (retrieved && retrieved.devnet === true) {
    pass("getSession retrieved correctly");
  } else {
    fail("getSession mismatch: " + JSON.stringify(retrieved));
  }

  // Delete
  await deleteSession("devnet-test");
  const afterDelete = await getSession("devnet-test");
  if (!afterDelete) pass("deleteSession removed correctly");
  else fail("Session still exists after delete");

  // Prune
  await setSession("expired-test", { createdAt: 0 }); // Created at epoch = expired
  await pruneAll();
  const afterPrune = await getSession("expired-test");
  if (!afterPrune) pass("pruneAll removed expired session");
  else fail("Expired session survived prune");
} catch (e) {
  fail("Session store: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 9: Cache layer
// ──────────────────────────────────────────────
console.log("\n--- 9. Cache layer ---");
try {
  const { cache, CACHE_TTL } = await import("../dist/src/client/cache.js");

  cache.set("devnet:test", { value: 42 }, CACHE_TTL.moderate);
  const hit = cache.get("devnet:test");
  if (hit && hit.value === 42) pass("Cache hit works");
  else fail("Cache miss on fresh set");

  cache.set("devnet:zero", { value: 1 }, CACHE_TTL.none);
  const noStore = cache.get("devnet:zero");
  if (noStore === null) pass("TTL=0 items not stored (correct)");
  else fail("TTL=0 item was stored");

  cache.invalidate("devnet:");
  const afterInvalidate = cache.get("devnet:test");
  if (afterInvalidate === null) pass("invalidate() cleared prefixed entries");
  else fail("invalidate() did not clear entries");
} catch (e) {
  fail("Cache: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 10: Validation + Formatting
// ──────────────────────────────────────────────
console.log("\n--- 10. Validation + Formatting ---");
try {
  const { isValidSolanaAddress, requireValidAddress, requireValidSlippage } =
    await import("../dist/src/utils/validation.js");
  const { lamportsToSol, solToLamports, truncateAddress, formatSol } =
    await import("../dist/src/utils/formatting.js");

  // Validation
  if (isValidSolanaAddress(DEVNET_WALLET)) pass("Valid address recognized");
  else fail("Valid address rejected");

  if (!isValidSolanaAddress("not-an-address")) pass("Invalid address rejected");
  else fail("Invalid address accepted");

  try { requireValidSlippage(10); pass("Slippage 10% accepted"); }
  catch { fail("Slippage 10% rejected"); }

  try { requireValidSlippage(0); fail("Slippage 0% accepted (should reject)"); }
  catch { pass("Slippage 0% rejected correctly"); }

  try { requireValidSlippage(101); fail("Slippage 101% accepted (should reject)"); }
  catch { pass("Slippage 101% rejected correctly"); }

  // Formatting
  if (lamportsToSol(1_000_000_000) === 1) pass("lamportsToSol(1B) = 1");
  else fail("lamportsToSol broken");

  if (solToLamports(1) === 1_000_000_000) pass("solToLamports(1) = 1B");
  else fail("solToLamports broken");

  const trunc = truncateAddress("G8f52YVLEHen8NRqqzzqKLh3FJQDYJSNyHiusVvFdA1B");
  if (trunc === "G8f5...dA1B") pass("truncateAddress: " + trunc);
  else fail("truncateAddress returned: " + trunc);

  if (formatSol(1.5) === "1.5000 SOL") pass("formatSol: " + formatSol(1.5));
  else fail("formatSol returned: " + formatSol(1.5));
} catch (e) {
  fail("Validation/Formatting: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 11: Server instructions
// ──────────────────────────────────────────────
console.log("\n--- 11. Server instructions ---");
try {
  const { SERVER_INSTRUCTIONS } = await import("../dist/src/server-instructions.js");
  if (SERVER_INSTRUCTIONS.includes("PumpFun MCP") && SERVER_INSTRUCTIONS.length > 500) {
    pass("Server instructions loaded (" + SERVER_INSTRUCTIONS.length + " chars)");
  } else {
    fail("Server instructions missing or too short");
  }
} catch (e) {
  fail("Server instructions: " + e.message);
}

// ──────────────────────────────────────────────
// SECTION 12: createServer() (no stdio side effects)
// ──────────────────────────────────────────────
console.log("\n--- 12. createServer() ---");
try {
  const { createServer } = await import("../dist/src/index.js");
  const server = createServer();
  pass("createServer() returned without starting stdio");
} catch (e) {
  fail("createServer: " + e.message);
}

// ──────────────────────────────────────────────
// RESULTS
// ──────────────────────────────────────────────
console.log("\n==============================================");
console.log("DEVNET DRY RUN RESULTS");
console.log("  Passed:  " + passes);
console.log("  Failed:  " + issues.length);
console.log("  Skipped: " + skipped);
console.log("==============================================");

if (issues.length > 0) {
  console.log("\nFAILURES:");
  issues.forEach((i, idx) => console.log("  " + (idx + 1) + ". " + i));
}

if (walletBalance === 0) {
  console.log("\nNOTE: Wallet has 0 SOL. To test with a funded wallet:");
  console.log("  1. Visit https://faucet.solana.com");
  console.log("  2. Enter: " + DEVNET_WALLET);
  console.log("  3. Re-run: SOLANA_RPC_URL=https://api.devnet.solana.com DEVNET_WALLET=" + DEVNET_WALLET + " node tests/devnet-dry-run.mjs");
}

process.exit(issues.length > 0 ? 1 : 0);
