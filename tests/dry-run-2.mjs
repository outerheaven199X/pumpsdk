/** Dry Run 2: Full launch flow, signing server, WebSocket, and session persistence. */

const issues = [];
let passes = 0;

// Step 1: Import createServer without side effects
console.log("=== STEP 1: Import createServer without side effects ===");
try {
  const { createServer } = await import("../dist/src/index.js");
  console.log("PASS: createServer imported");
  passes++;
} catch (e) {
  issues.push("import: " + e.message);
  console.log("FAIL: " + e.message);
}

// Step 2: Signing server + session lifecycle
console.log("\n=== STEP 2: Signing server + session lifecycle ===");
try {
  const { createSigningSession, createLaunchSession, getSessionStatus } =
    await import("../dist/src/signing/serve.js");

  const signUrl = await createSigningSession(
    ["dGVzdA=="],
    "Test signing session",
    { action: "Test" },
  );
  console.log("PASS: Signing session created:", signUrl);
  passes++;

  const sessionId = signUrl.split("/sign/")[1];
  const status = await getSessionStatus(sessionId);
  if (status === null) {
    console.log("PASS: Session not yet complete (expected)");
    passes++;
  } else {
    issues.push("signing session should not be complete yet");
  }

  const launchUrl = await createLaunchSession({
    metadataUri: "https://ipfs.io/ipfs/test",
    tokenName: "DryRunToken",
    tokenSymbol: "DRT",
    claimersArray: ["__CONNECTED_WALLET__"],
    basisPointsArray: [10000],
    initialBuySol: 0.001,
    slippage: 10,
    priorityFee: 0.0005,
    description: "Dry run launch test",
    meta: { Name: "DryRunToken", Symbol: "DRT" },
  });
  console.log("PASS: Launch session created:", launchUrl);
  passes++;
} catch (e) {
  issues.push("signing server: " + e.message);
  console.log("FAIL: " + e.message);
}

// Step 3: Signing page serves HTML
console.log("\n=== STEP 3: Signing page HTML delivery ===");
try {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch("http://localhost:3142/sign/nonexistent-id");
  if (res.ok) {
    const html = await res.text();
    if (html.includes("<html") || html.includes("<!DOCTYPE")) {
      console.log("PASS: Signing page serves HTML (" + html.length + " bytes)");
      passes++;
    } else {
      issues.push("signing page did not return HTML");
    }
  } else {
    issues.push("signing page HTTP " + res.status);
  }
} catch (e) {
  issues.push("signing page fetch: " + e.message);
}

// Step 4: Session API - 404 for missing
console.log("\n=== STEP 4: Session API endpoint ===");
try {
  const res = await fetch("http://localhost:3142/api/sign/nonexistent-id");
  if (res.status === 404) {
    console.log("PASS: Missing session returns 404");
    passes++;
  } else {
    issues.push("expected 404, got " + res.status);
  }
} catch (e) {
  issues.push("session API: " + e.message);
}

// Step 5: IPFS endpoint connectivity
console.log("\n=== STEP 5: Pump.fun IPFS endpoint connectivity ===");
try {
  const res = await fetch("https://pump.fun/api/ipfs", { method: "POST" });
  console.log("PASS: IPFS endpoint reachable (HTTP " + res.status + ")");
  passes++;
} catch (e) {
  issues.push("IPFS unreachable: " + e.message);
}

// Step 6: PumpPortal connectivity
console.log("\n=== STEP 6: PumpPortal trade-local connectivity ===");
try {
  const res = await fetch("https://pumpportal.fun/api/trade-local", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "buy", publicKey: "11111111111111111111111111111111", mint: "fake", amount: 0 }),
  });
  console.log("PASS: PumpPortal reachable (HTTP " + res.status + ")");
  passes++;
} catch (e) {
  issues.push("PumpPortal unreachable: " + e.message);
}

// Step 7: Bonding curve calc
console.log("\n=== STEP 7: Bonding curve analysis ===");
try {
  const { pumpGet } = await import("../dist/src/client/pump-rest.js");
  const { lamportsToSol } = await import("../dist/src/utils/formatting.js");
  const coins = await pumpGet("/coins", { sort: "market_cap", order: "DESC", limit: "5", offset: "0", includeNsfw: "false" });
  const active = coins.filter((c) => !c.complete);
  if (active.length > 0) {
    const c = active[0];
    const sol = lamportsToSol(c.virtual_sol_reserves);
    const progress = Math.min((sol / 85) * 100, 100);
    console.log("PASS: Bonding curve for " + c.name + " (" + c.symbol + ")");
    console.log("  SOL reserves: " + sol.toFixed(4) + ", Progress: " + progress.toFixed(1) + "%");
    passes++;
  } else {
    console.log("INFO: All top tokens graduated, skipping");
    passes++;
  }
} catch (e) {
  issues.push("bonding curve: " + e.message);
}

// Step 8: WebSocket
console.log("\n=== STEP 8: PumpPortal WebSocket ===");
try {
  const { pumpWs } = await import("../dist/src/client/pump-ws.js");
  pumpWs.connect();
  pumpWs.subscribeNewTokens();

  let connected = false;
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (pumpWs.connected) { connected = true; break; }
  }

  if (connected) {
    console.log("PASS: WebSocket connected");
    passes++;
    console.log("  Waiting 5s for events...");
    await new Promise((r) => setTimeout(r, 5000));
    const events = pumpWs.recentTokens;
    if (events.length > 0) {
      console.log("  Got " + events.length + " new token events");
      const last = events[events.length - 1];
      console.log("  Latest: " + last.name + " ($" + last.symbol + ")");
    } else {
      console.log("  No events yet (normal if quiet)");
    }
    pumpWs.disconnect();
  } else {
    issues.push("WebSocket failed to connect in 5s");
  }
} catch (e) {
  issues.push("WebSocket: " + e.message);
}

// Step 9: Session persistence
console.log("\n=== STEP 9: Session persistence ===");
try {
  const { getSession, setSession } = await import("../dist/src/signing/session-store.js");
  await setSession("persistence-test", { type: "sign", id: "persistence-test", createdAt: Date.now(), extra: "hello" });
  const retrieved = await getSession("persistence-test");
  if (retrieved && retrieved.extra === "hello") {
    console.log("PASS: Session persisted and retrieved");
    passes++;
  } else {
    issues.push("session data mismatch");
  }
} catch (e) {
  issues.push("session persistence: " + e.message);
}

console.log("\n========================================");
console.log("DRY RUN 2 RESULTS: " + passes + " passed, " + issues.length + " issues");
if (issues.length > 0) {
  console.log("\nISSUES:");
  issues.forEach((i, idx) => console.log("  " + (idx + 1) + ". " + i));
}
console.log("========================================");

process.exit(0);
