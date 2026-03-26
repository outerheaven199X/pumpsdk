# PumpSDK

> **Status: WIP (90%)** — Core launch pipeline works end-to-end. Signing, image gen, and PumpPortal integration are functional. Dev buy with low-balance wallets, slider UX, and some edge cases are being ironed out. Should be solid by morning.

```bash
npx -y pumpsdk
```

Launch tokens on Pump.fun from Claude. Trade them. Watch the market. Generate the art. Your keys never leave your browser.

PumpSDK is an MCP server. It gives Claude (or any MCP-compatible client) 30+ tools for interacting with Pump.fun on Solana. You describe a token in plain language. Claude builds it, generates artwork, configures fees, and hands you a signing URL. You approve the transaction in your browser wallet. Done.

No private keys on the server. No custody. No RPC node to run. One dependency: Node 20+.

---

## What you can do with it

**Launch tokens** from a conversation. Describe your token, set the supply and fee split, and Claude handles the rest. It generates a mint keypair, builds the transaction, and opens a browser page where your wallet signs it.

**Trade on existing tokens.** Buy, sell, check price, pull holder distribution, read the bonding curve. Claude can look up any token by mint address or by name and walk you through a position.

**Generate token art** during the launch flow. If you have a FAL API key, Claude writes an image prompt from your token concept and generates artwork before launch. Skip it if you already have an image.

**Stream the market** over WebSocket. PumpSDK connects to PumpPortal's feed and can surface new token launches, large trades, and migration events in real time. The agent strategies (sniper, scout) use this feed to find opportunities and present them for your approval.

**Run agent strategies.** The sniper watches for new launches matching criteria you set and builds buy transactions when it finds something. The scout monitors graduation candidates. Both require your wallet signature before any SOL moves.

**Manage fee splits.** Configure up to 10 fee claimers with percentage allocations. Claim accrued fees. Check balances. All through conversation.

---

## Quick start

You need Node 20+ and a Solana wallet browser extension (Phantom, Solflare, Backpack, etc.).

### 1. Install and run

```bash
npx -y pumpsdk
```

This starts the MCP server on stdio and a local signing server on port 3142.

If you'd rather clone it:

```bash
git clone https://github.com/outerheaven199X/pumpsdk.git
cd pumpsdk
npm install
npm run build
node dist/src/index.js
```

### 2. Connect to Claude Desktop

Add this to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json` on Linux, `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "pumpsdk": {
      "command": "npx",
      "args": ["-y", "pumpsdk"],
      "env": {
        "SOLANA_RPC_URL": "https://mainnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY",
        "FAL_API_KEY": "your-fal-key-here"
      }
    }
  }
}
```

The FAL key is optional. Without it, image generation is skipped and you supply your own token art.

### 3. Talk to Claude

> "Launch a token called CATFISH with a fish-cat hybrid theme, 1B supply, 2% creator fee"

Claude takes it from there.

---

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `SOLANA_RPC_URL` | Yes | Your Solana RPC endpoint. **Use Helius (free tier) or QuickNode.** The public mainnet RPC blocks `sendTransaction`. |
| `FAL_API_KEY` | No | Enables AI image generation for token art. Get one at fal.ai. |
| `HERMES_API_KEY` | No | Enables dual-model agent mode (routes between Hermes and Sonnet). |
| `PUMP_PORTAL_API_KEY` | No | Required for PumpPortal's transaction building API. |

---

## Feature flags

All flags are environment variables. Set them in your shell, `.env` file, or Claude Desktop config.

| Flag | Default | What it does |
|---|---|---|
| `PUMPSDK_AGENT_DRY_RUN=1` | off | Agent strategies log decisions but don't build transactions. Good for testing sniper criteria without risking SOL. |
| `PUMPSDK_DEVNET=1` | off | Points at devnet RPC. Disables mainnet-only features. |
| `PUMPSDK_NO_WS=1` | off | Skips the PumpPortal WebSocket connection. Saves bandwidth if you only need MCP tools. |
| `PUMPSDK_NO_IMAGE_GEN=1` | off | Disables image generation even if `FAL_API_KEY` is set. |
| `PUMPSDK_DEBUG_API=1` | off | Logs all outbound API requests and responses. Verbose. |
| `PUMPSDK_SESSION_TTL` | `3600000` | Session timeout in milliseconds. Default is 1 hour. |
| `PUMPSDK_DEV_NO_CSRF=1` | off | Disables CSRF validation on the signing server. Development only. Never in production. |
| `PUMPSDK_ENCRYPT_SESSIONS=1` | off | Encrypts session data at rest. |

---

## How signing works

PumpSDK never touches your private keys. Here's the actual flow:

1. Claude builds a transaction (launch, buy, sell, claim fees, whatever).
2. PumpSDK generates a session with a CSRF token and opens a URL in your browser.
3. The browser page connects to your wallet extension.
4. You review the transaction details and click approve.
5. Your wallet signs it. The signed bytes go back to the server. The server submits to the network.
6. The session expires.

The signing page runs on `localhost:3142`. It only binds to `127.0.0.1` so nothing outside your machine can reach it.

---

## Tools

PumpSDK registers 30+ MCP tools. Here are the ones you'll use most:

| Tool | What it does |
|---|---|
| `launch_token` | Full token launch flow with signing |
| `buy_token` / `sell_token` | Trade on any Pump.fun token |
| `get_token_info` | Price, supply, bonding curve, holder count |
| `get_holders` | Top holders and distribution |
| `generate_image` | AI art generation for token launches |
| `configure_fees` | Set fee claimers and percentages |
| `claim_fees` | Claim accrued creator fees |
| `search_tokens` | Find tokens by name or symbol |
| `get_trades` | Recent trade history for a token |
| `start_sniper` / `start_scout` | Activate agent strategies |
| `doctor` | Server health check and diagnostics |

Run `doctor` if something feels off. It checks your RPC connection, API keys, WebSocket status, and tool registration.

---

## Project structure

```
src/
  index.ts              Entry point, MCP server setup
  tools/                 30+ MCP tool definitions
  resources/             MCP resource providers (market data, sessions)
  prompts/               System prompts for agent strategies
  signing/
    serve.ts             Local Express server for browser signing
    page.html            Launch signing page
    scout-page.html      Scout/sniper signing page
    session-store.ts     Session persistence
  agent/
    strategies/          Sniper, scout, and other autonomous strategies
    router.ts            Dual-model orchestrator (Hermes + Sonnet)
  api/                   PumpPortal and Pump.fun API clients
  utils/                 Cache, constants, helpers
```

---

## Troubleshooting

**"Connection refused on port 3142"**
The signing server didn't start. Check that nothing else is using port 3142 (`netstat -ano | findstr :3142` on Windows, `lsof -i :3142` on Mac/Linux). Kill zombie node processes: `taskkill /F /IM node.exe` (Windows) or `pkill -f node` (Mac/Linux). PumpSDK starts it automatically, but stale processes from prior runs can hold the port.

**"Session expired" / 410 when trying to sign**
Default TTL is 1 hour. If you're getting 410s immediately, the issue is likely a stale server process running old code. Kill all node processes, rebuild, and restart. The session keypair is stored in `.sessions/sessions.json` and survives restarts.

**PumpPortal returns 400: Bad Request**
PumpPortal validates your wallet balance before building the transaction. If your dev buy amount + rent (~0.02 SOL) + priority fee exceeds your wallet balance, you get a silent 400. Fix: lower the dev buy, or set it to 0 and buy separately after launch. Also: do NOT include `isMayhemMode` in the payload — PumpPortal rejects unknown fields.

**Transaction built but Phantom signing fails / "Blockhash not found"**
The public Solana RPC (`api.mainnet-beta.solana.com`) rate-limits and blocks `sendTransaction`. Use a real RPC provider. Helius has a free tier: set `SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=YOUR_KEY` in your `.env`.

**CSP blocks RPC requests in the browser**
If you use a custom RPC (Helius, QuickNode, etc.), its domain must be in the Content-Security-Policy `connect-src` directive in both `page.html` and `scout-page.html`. By default, `*.helius-rpc.com` is whitelisted. Add your provider's domain if you use a different one.

**Wallet not detected on signing page**
The page checks for Phantom, Solflare, Backpack, Coinbase, Trust, Brave, Exodus, Slope, Torus, and MathWallet. Make sure your wallet extension is installed, unlocked, and set to mainnet.

**Image generation fails or times out**
PumpSDK uses fal.ai Nano Banana 2 Pro for token logos. Check your `FAL_API_KEY`. The sync endpoint at `fal.run` is used (no polling). If fal.ai is down, launch proceeds without a logo.

**WebSocket disconnects**
PumpPortal's WebSocket can drop under load. PumpSDK reconnects automatically. Set `PUMPSDK_NO_WS=1` to disable it and use polling tools instead.

**Agent strategy bought something I didn't want**
It shouldn't — every transaction requires your wallet signature. Run with `PUMPSDK_AGENT_DRY_RUN=1` first to see what the agent would do without building real transactions.

**Claude says the tools aren't available**
Make sure the MCP server config points at the right command. Run `npx -y pumpsdk` in a terminal first to confirm it starts. Node 20+ required.

### Best practices

- **Use a real RPC.** Helius free tier is fine. The public mainnet RPC will reject your transactions.
- **Kill stale servers.** If you're iterating, always kill old node processes before restarting. Zombie servers serve stale code.
- **Start with 0 dev buy** to prove the pipeline works, then add a dev buy once you've confirmed your wallet has enough SOL.
- **Keep `.env` out of git.** It's in `.gitignore` by default. Never commit RPC keys or API keys.

---

## Security notes

PumpSDK is zero-custody. Private keys stay in your browser wallet. The server builds unsigned transactions and hands them to you.

That said, the signing server runs on localhost without TLS. This is fine for local use. Don't expose port 3142 to the internet.

Session data (not private keys, but mint keypairs for pending launches) is written to `.sessions/` in the project directory. Keep that directory private. The `PUMPSDK_ENCRYPT_SESSIONS=1` flag adds encryption at rest.

For a full security audit of this codebase, see [AUDIT.md](./AUDIT.md).

---

## License

MIT
