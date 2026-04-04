# PumpSDK Security Audit

**Date:** 2026-04-04
**Scope:** Full codebase audit — security, correctness, architecture, developer experience

## Summary

A comprehensive audit was performed covering six categories:

1. **Security (ship-blocking)** — Removed hardcoded debug paths, implemented CSRF token rotation, tightened origin validation for POST requests, implemented AES-256-GCM session encryption, added per-session regeneration rate limits, removed RPC API keys from client-served HTML.

2. **Correctness** — Fixed SESSION_TTL inconsistency (standardized to 10 minutes), added missing `await` calls in dry-run tests, fixed WebSocket import to use the `ws` package, documented solAmount units as lamports.

3. **Architecture** — Added graceful shutdown handler (SIGINT/SIGTERM), documented sync I/O + lock pattern tradeoff in session store.

4. **Developer experience** — Fixed `.env.example` with missing keys and comments, updated express version constraint, standardized solana-web3.js loading to local copies across all HTML pages.

5. **Documentation** — Fixed HERMES_HANDOFF launch flow description to match code (Connect → Launch → Fee Config), corrected tool count to 36 across all references, created this AUDIT.md.

6. **Cleanup** — Consolidated FLAGS usage (already centralized in flags.ts), removed dead `appendFileSync` import.

## Verification

```bash
npm run build          # Must compile with zero errors
node --env-file=.env dist/tests/dry-run.js   # Must pass
```

Then manually verify:
1. `http://localhost:3142/dashboard` loads without RPC key visible in page source
2. Creating a scout session and regenerating image works (max 5 per session)
3. The signing page flow still works end-to-end
