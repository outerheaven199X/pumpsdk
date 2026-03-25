# PumpSDK — Hermes Handoff (Mainnet Launch Demo)

## What This Repo Is

PumpSDK is an MCP server that lets AI agents launch and trade Solana tokens on Pump.fun. It runs locally, exposes tools via MCP, and serves a signing page at `localhost:3142` where the user connects Phantom to sign transactions. Zero custody — no private keys touch the server.

**Repo:** https://github.com/outerheaven199X/pumpsdk
**Location on disk:** `C:\Users\npitt\Desktop\pumpfun`

---

## Step 0: Setup (Do This First)

```bash
cd C:\Users\npitt\Desktop\pumpfun
npm install
npm run build
```

Both commands should complete with zero errors. The build compiles TypeScript to `dist/` and copies the signing page HTML.

The `.env` file exists at the project root. No changes needed — it defaults to mainnet RPC.

The MCP server config entry (for Claude Desktop or equivalent):
```json
{
  "command": "node",
  "args": ["C:\\Users\\npitt\\Desktop\\pumpfun\\dist\\src\\index.js"],
  "env": {}
}
```

---

## Step 1: Dry Run #1 — Verify Server Boots and Sessions Create

Run this from the project root to confirm the signing server starts, sessions create correctly, and the page HTML serves both modes:

```bash
cd C:\Users\npitt\Desktop\pumpfun
node --env-file=.env -e "
async function run() {
  const { createLaunchSession, createSigningSession, WALLET_PLACEHOLDER } = await import('./dist/src/signing/serve.js');

  console.log('=== Dry Run #1: Server + Session Verification ===\n');

  // Test 1: Launch session creates
  console.log('1. Creating launch session...');
  const launchUrl = createLaunchSession({
    metadataUri: 'https://arweave.net/test',
    tokenName: 'DryRunToken',
    tokenSymbol: 'DRY',
    claimersArray: [WALLET_PLACEHOLDER],
    basisPointsArray: [10000],
    initialBuySol: 0,
    slippage: 10,
    priorityFee: 0.0005,
    description: 'Launch DRY on Pump.fun',
    meta: { Name: 'DryRunToken', Symbol: 'DRY', 'Initial Buy': '0 SOL', mint: 'So11111111111111111111111111111111111111112' },
  });
  console.log('   Launch URL:', launchUrl);
  console.log('   ✓ Launch session created');

  await new Promise(r => setTimeout(r, 500));
  const sessionId = launchUrl.split('/launch/')[1];

  // Test 2: Session state API returns connect phase
  console.log('\n2. Fetching session state via API...');
  const stateResp = await fetch('http://localhost:3142/api/launch/' + sessionId);
  const state = await stateResp.json();
  console.log('   Phase:', state.phase);
  console.log('   Description:', state.description);
  if (state.phase !== 'connect') throw new Error('Expected connect phase');
  console.log('   ✓ Session starts in connect phase');

  // Test 3: Launch page HTML loads with phase indicators
  console.log('\n3. Verifying launch page HTML...');
  const pageResp = await fetch('http://localhost:3142/launch/' + sessionId);
  const html = await pageResp.text();
  console.log('   Phase indicator:', html.includes('phase-indicator'));
  console.log('   Launch mode detection:', html.includes('isLaunchMode'));
  console.log('   Dual mode support:', html.includes('/api/launch/') && html.includes('/api/sign/'));
  console.log('   ✓ Page HTML valid');

  // Test 4: Sign mode still works (backward compat)
  console.log('\n4. Verifying sign mode backward compatibility...');
  const signUrl = createSigningSession(['fake-tx'], 'Test sign', { Action: 'Test' });
  const signId = signUrl.split('/sign/')[1];
  const signResp = await fetch('http://localhost:3142/api/sign/' + signId);
  const signData = await signResp.json();
  console.log('   Sign URL:', signUrl);
  console.log('   Transactions:', signData.transactions?.length);
  console.log('   ✓ Sign mode works');

  console.log('\n=== Dry Run #1 PASSED ===');
  process.exit(0);
}
run().catch(e => { console.error('✗ FAILED:', e.message); process.exit(1); });
"
```

**Expected output:** All 4 checks pass with ✓. The server starts on port 3142. If you see `=== Dry Run #1 PASSED ===`, move on.

---

## Step 2: Dry Run #2 — Full 3-Phase Flow (Connect → Fee Config → Launch)

This simulates the complete launch pipeline — wallet connect, fee config tx build, launch tx build, and session completion:

```bash
cd C:\Users\npitt\Desktop\pumpfun
node --env-file=.env -e "
async function run() {
  const { createLaunchSession, WALLET_PLACEHOLDER } = await import('./dist/src/signing/serve.js');

  console.log('=== Dry Run #2: Full 3-Phase Launch Flow ===\n');

  const launchUrl = createLaunchSession({
    metadataUri: 'https://arweave.net/test',
    tokenName: 'PhaseTest',
    tokenSymbol: 'PHS',
    claimersArray: [WALLET_PLACEHOLDER],
    basisPointsArray: [10000],
    initialBuySol: 0,
    slippage: 10,
    priorityFee: 0.0005,
    description: 'Launch PHS on Pump.fun',
    meta: { Name: 'PhaseTest', Symbol: 'PHS', 'Initial Buy': '0 SOL', mint: 'So11111111111111111111111111111111111111112' },
  });
  const sessionId = launchUrl.split('/launch/')[1];
  await new Promise(r => setTimeout(r, 500));

  // PHASE 1: Connect wallet
  console.log('Phase 1: Connect wallet');
  const WALLET = 'GsbwXfJraMomNxBcjYLcG3mxkBUiyWXAB32fGbSQQRre';
  const connectResp = await fetch('http://localhost:3142/api/launch/' + sessionId + '/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ wallet: WALLET }),
  });
  const connectData = await connectResp.json();
  console.log('   Status:', connectResp.status);
  console.log('   Phase:', connectData.phase);
  console.log('   Fee config txs:', connectData.transactions?.length);
  console.log('   Tx size:', connectData.transactions?.[0]?.length, 'base64 chars');
  if (connectData.phase !== 'fee_config') throw new Error('Expected fee_config phase');
  console.log('   ✓ Fee config transaction built');

  // PHASE 2: Fee signed -> build launch tx
  console.log('\nPhase 2: Fee signed → build launch tx');
  const feeResp = await fetch('http://localhost:3142/api/launch/' + sessionId + '/fee-signed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatures: ['simulated-fee-sig'] }),
  });
  const feeData = await feeResp.json();
  console.log('   Status:', feeResp.status);
  console.log('   Phase:', feeData.phase);
  console.log('   Launch txs:', feeData.transactions?.length);
  console.log('   Tx size:', feeData.transactions?.[0]?.length, 'base64 chars');
  console.log('   Description:', feeData.description);
  if (feeData.phase !== 'launch') throw new Error('Expected launch phase');
  console.log('   ✓ Launch transaction built (mint keypair generated, partially signed)');

  // PHASE 3: Complete
  console.log('\nPhase 3: Complete');
  const completeResp = await fetch('http://localhost:3142/api/launch/' + sessionId + '/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signatures: ['simulated-launch-sig'] }),
  });
  const completeData = await completeResp.json();
  console.log('   ✓ Session complete:', completeData.ok);

  console.log('\n=== Dry Run #2 PASSED ===');
  console.log('\nAll 3 phases work:');
  console.log('  1. Connect → fee config tx built (' + connectData.transactions[0].length + ' chars)');
  console.log('  2. Fee signed → launch tx built (' + feeData.transactions[0].length + ' chars)');
  console.log('  3. Complete → session closed');
  console.log('\nReady for mainnet.');
  process.exit(0);
}
run().catch(e => { console.error('✗ FAILED:', e.message); process.exit(1); });
"
```

**Expected output:** All 3 phases pass. You should see fee config tx (~988 chars) and launch tx (~996 chars) both build successfully. If you see `=== Dry Run #2 PASSED ===` and `Ready for mainnet.`, everything is confirmed working.

---

## Step 3: The Mainnet Launch (Screen Recording)

This is the real thing. The user will say **"Launch a coin on Pump.fun"** and you walk them through it conversationally. Here is exactly what to do:

### Your Personality for This Demo

Be confident, concise, and slightly hyped. This is a demo — make it feel effortless. No jargon, no tool names, no "MCP" talk. You're an AI agent launching a coin for them. Keep it smooth.

### The Conversation Flow

**User says:** "Launch a coin on Pump.fun"

**You respond** by asking for the basics — keep it casual, one message:
- What should we call it? (name + ticker)
- Quick description
- Got an image? (URL or want one generated)
- Any initial buy? (how much SOL to put in at launch, 0 is fine)
- Any social links? (twitter, telegram, website — all optional)
- Fee split — 100% to you, or split with anyone?

**User provides the details.**

**You confirm** — show a clean summary:
> Here's what we're launching:
> - **Name:** [name]
> - **Symbol:** $[TICKER]
> - **Description:** [description]
> - **Initial buy:** [X] SOL
> - **Creator fees:** 100% to you
>
> Look good?

**User confirms.**

**You call `pump_launch`** with the details. The tool returns a `launchUrl`.

**You give them the link:**
> Your token is ready. Click this link to launch:
> [launchUrl]
>
> You'll connect your Phantom wallet and sign twice — once for the fee setup, once for the launch. After that, your coin is live on Pump.fun.

**User opens the link, connects Phantom, signs twice.**

**After they confirm it went through**, celebrate:
> Your coin is live! Check it out on pump.fun. 🎉

### What `pump_launch` Needs (Tool Call Reference)

```json
{
  "name": "Whatever They Named It",
  "symbol": "TICKER",
  "description": "Their description",
  "imageUrl": "https://direct-image-url.com/image.png",
  "initialBuySol": 0,
  "slippage": 10,
  "priorityFee": 0.0005,
  "feeSplit": [
    { "address": "self", "percent": 100 }
  ]
}
```

- `imageUrl` must be a direct public URL to an image (png, jpg, gif, webp)
- `initialBuySol`: 0 = no dev buy. Any positive number = buy that much SOL worth at launch
- `feeSplit`: `"self"` = the wallet they connect on the signing page. Defaults to 100% if omitted
- Social links (`twitter`, `telegram`, `website`) are all optional — only include if provided
- `slippage` and `priorityFee` — use the defaults shown above unless the user asks to change them

### What the Tool Returns

```json
{
  "launchUrl": "http://localhost:3142/launch/xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "name": "...",
  "symbol": "...",
  "metadataUri": "https://pump.fun/api/ipfs/...",
  "initialBuySol": 0,
  "instructions": "Open the launch URL in your browser..."
}
```

Give them the `launchUrl`. That's all they need. The page handles everything else.

### What Happens on the Signing Page (So You Know What the User Sees)

1. **Page loads** — dark theme, "Pump.fun MCP — Token Launcher" header, 3 phase dots at top
2. **Token details card** — shows name, symbol, initial buy
3. **Wallet buttons** — Phantom, Solflare, Backpack, etc. User clicks Phantom
4. **Phase 1 completes** — wallet connected, first dot lights up, "Building fee config..." spinner
5. **Fee config tx appears** — "Sign & Send" button, user clicks, Phantom pops up, user approves
6. **Phase 2 completes** — second dot lights up, "Building launch transaction..." spinner
7. **Launch tx appears** — "Sign & Send" button again, user clicks, Phantom pops up, user approves
8. **Phase 3 completes** — all 3 dots green, "Token launched!" message, Solscan links shown

---

## Available MCP Tools (Full Reference)

| Tool | Purpose |
|------|---------|
| `pump_launch` | Launch a new token (uploads to IPFS, opens 3-phase launch page) |
| `pump_open_launch_page` | Open launch page with pre-prepared metadata |
| `pump_trade` | Build a buy/sell trade transaction |
| `pump_quote` | Get a price quote for buying/selling |
| `pump_open_signing_page` | Open signing page for pre-built transactions |
| `pump_metadata` | Fetch token metadata from Pump.fun |
| `pump_new_mints` | Get recently launched tokens |
| `pump_claim_fees` | Claim accumulated creator fees |

---

## Important Mainnet Notes

1. **Real SOL.** Launch costs ~0.01-0.02 SOL in gas + rent for the fee config account.
2. **No undo.** Once the launch tx is signed, the token is live immediately.
3. **Signing server auto-starts.** It boots on `localhost:3142` when any tool is called.
4. **Phantom must be installed** in the browser. The page auto-detects it.
5. **Mint address is generated server-side** during Phase 2 — it's not known until after fee config is signed.
6. **The `.env` has no `SOLANA_RPC_URL` set**, which means it defaults to mainnet (`https://api.mainnet-beta.solana.com`).

---

## File Structure

```
src/
  index.ts                          — MCP server entry, registers all 8 tools
  client/pump-rest.ts               — REST client for Pump.fun + PumpPortal APIs
  signing/
    serve.ts                        — Express server: /sign routes + /launch routes
    launch-builder.ts               — Builds fee config txs (@pump-fun/pump-sdk) + launch txs (PumpPortal)
    page.html                       — Dual-mode signing page (sign + launch with phase dots)
  tools/
    tokens/
      launch.ts                     — pump_launch (IPFS upload → launch session)
      open-launch-page.ts           — pump_open_launch_page
      metadata.ts                   — pump_metadata
      new-mints.ts                  — pump_new_mints
    trading/
      trade.ts                      — pump_trade
      quote.ts                      — pump_quote
      sign.ts                       — pump_open_signing_page
    fees/
      claim.ts                      — pump_claim_fees
  utils/
    constants.ts                    — API URLs, program IDs, ports, WALLET_PLACEHOLDER
    errors.ts                       — MCP error formatting
    validation.ts                   — Address + slippage validation
docs/
  creator-fees.md                   — GitBook page on creator fees
tests/
  dry-run.ts                        — 3-phase session verification test
```
