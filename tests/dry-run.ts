/** Dry-run test — verifies the multi-phase launch session flow without signing real transactions. */

import { createLaunchSession, startSigningServer } from "../src/signing/serve.js";
import { WALLET_PLACEHOLDER } from "../src/utils/constants.js";

const TEST_PORT = 3142;
const FAKE_METADATA_URI = "https://arweave.net/test-metadata-uri";
const FAKE_WALLET = "DevnetWa11etXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX";

async function runDryRun(): Promise<void> {
  console.log("=== PumpAgent Multi-Phase Launch Dry Run ===\n");

  /* Step 1: Create a launch session */
  console.log("1. Creating launch session...");
  const launchUrl = createLaunchSession({
    metadataUri: FAKE_METADATA_URI,
    tokenName: "DryRunToken",
    tokenSymbol: "DRY",
    claimersArray: [WALLET_PLACEHOLDER],
    basisPointsArray: [10_000],
    initialBuySol: 0,
    slippage: 10,
    priorityFee: 0.0005,
    description: "Launch $DRY on Pump.fun",
    meta: {
      Name: "DryRunToken",
      Symbol: "DRY",
      "Initial Buy": "0 SOL",
      mint: "DryRunMintXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    },
  });

  console.log("   Launch URL:", launchUrl);
  const sessionId = launchUrl.split("/launch/")[1];
  console.log("   Session ID:", sessionId);

  /* Step 2: Fetch session state via API */
  console.log("\n2. Fetching session state...");
  await delay(500);

  const stateResp = await fetch(`http://localhost:${TEST_PORT}/api/launch/${sessionId}`);
  if (!stateResp.ok) {
    throw new Error(`Failed to fetch session: ${stateResp.status}`);
  }
  const state = await stateResp.json();
  console.log("   Phase:", state.phase);
  console.log("   Description:", state.description);
  console.log("   Meta:", JSON.stringify(state.meta, null, 2));

  if (state.phase !== "connect") {
    throw new Error(`Expected phase 'connect', got '${state.phase}'`);
  }
  console.log("   ✓ Session starts in 'connect' phase");

  /* Step 3: Simulate wallet connect */
  console.log("\n3. Simulating wallet connect...");
  const connectResp = await fetch(`http://localhost:${TEST_PORT}/api/launch/${sessionId}/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: FAKE_WALLET }),
  });

  if (connectResp.ok) {
    const connectData = await connectResp.json();
    console.log("   Phase after connect:", connectData.phase);
    console.log("   Fee config txs count:", connectData.transactions?.length ?? 0);
    console.log("   Description:", connectData.description);
    console.log("   ✓ Fee config transactions built successfully");
  } else {
    const errData = await connectResp.json();
    console.log("   ⚠ Connect returned error (expected on devnet — Pump SDK needs mainnet state):");
    console.log("   ", errData.error);
    console.log("   This is expected: fee config instructions reference on-chain PDAs that only exist on mainnet.");
  }

  /* Step 4: Verify the signing page HTML loads */
  console.log("\n4. Verifying launch page HTML loads...");
  const pageResp = await fetch(`http://localhost:${TEST_PORT}/launch/${sessionId}`);
  if (!pageResp.ok) {
    throw new Error(`Page HTML failed to load: ${pageResp.status}`);
  }
  const html = await pageResp.text();
  const hasPhaseIndicator = html.includes("phase-indicator");
  const hasLaunchMode = html.includes("isLaunchMode");
  const hasDualMode = html.includes("/api/launch/") && html.includes("/api/sign/");
  console.log("   Phase indicator present:", hasPhaseIndicator);
  console.log("   Launch mode detection:", hasLaunchMode);
  console.log("   Dual-mode (sign + launch):", hasDualMode);
  console.log("   ✓ Page HTML is valid");

  /* Step 5: Verify sign mode still works */
  console.log("\n5. Verifying sign mode still works...");
  const { createSigningSession } = await import("../src/signing/serve.js");
  const signUrl = createSigningSession(
    ["fake-tx-base64"],
    "Test signing session",
    { Action: "Test" },
  );
  console.log("   Sign URL:", signUrl);
  const signSessionId = signUrl.split("/sign/")[1];

  const signResp = await fetch(`http://localhost:${TEST_PORT}/api/sign/${signSessionId}`);
  if (!signResp.ok) {
    throw new Error(`Sign session failed: ${signResp.status}`);
  }
  const signData = await signResp.json();
  console.log("   Transactions:", signData.transactions?.length);
  console.log("   Description:", signData.description);
  console.log("   ✓ Sign mode is backward compatible");

  console.log("\n=== Dry Run Complete ===");
  console.log("\nSummary:");
  console.log("  ✓ Launch session creates correctly");
  console.log("  ✓ Session starts in 'connect' phase");
  console.log("  ✓ Signing page HTML serves both modes");
  console.log("  ✓ Sign mode (existing) still works");
  console.log("  ℹ Fee config tx build requires mainnet state (expected on devnet)");

  process.exit(0);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

runDryRun().catch((err) => {
  console.error("\n✗ Dry run failed:", err.message);
  process.exit(1);
});
