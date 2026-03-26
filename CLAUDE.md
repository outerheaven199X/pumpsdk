# PRD: Claude Code Debugging Discipline

**Author:** Nikki Kaelar
**Date:** 2026-03-26
**Context:** 3-hour debugging session where Claude Code looped on a signing server bug that had five distinct root causes stacked on top of each other. Every fix was correct in isolation but the wrong order, wrong timing, or stale binary made it look like it failed.

---

## Problem

Claude Code treats debugging like a slot machine. It makes a change, rebuilds, tries again, and if it fails, makes another change. It doesn't isolate variables, doesn't verify its own fixes took effect, and doesn't read its own error output before guessing at the next fix. On long sessions with stateful servers, this produces spirals where correct fixes appear broken because the running process doesn't match the source code.

The failure mode is specific: Claude Code is good at writing code and bad at operating it. It writes the fix, forgets to kill the old process, doesn't check the build output, and moves on to the next hypothesis when the real problem was that the fix never ran.

---

## Rules

### 1. Isolate before integrating

Never debug a problem through the full stack when you can reproduce it with a single fetch call.

If an external API returns an error, extract the request into a standalone `node -e` or `curl` command and test it directly. Don't round-trip through the signing server, the session store, the browser page, and the wallet just to see if PumpPortal accepts a field.

**Test:** Before wiring any external API call into application code, prove it works in isolation with a 5-line script. Paste the working script in a comment above the integration point.

### 2. Happy path before hardening

Do not implement security improvements, encryption, in-memory-only stores, or any defensive pattern until the basic flow works end to end with real user interaction.

Ship the dumb version first. Keypair in plaintext JSON on disk? Fine. CSRF disabled? Fine for the first successful launch. Harden after the happy path is proven, not before.

**Test:** Can a human click through the entire flow and see a success message? If no, don't touch security.

### 3. Verify the binary matches the source

After every edit-build-restart cycle, confirm the running server reflects the change. Add a temporary log line like `console.error("[BUILD MARKER] 2026-03-26T00:45Z")` with a timestamp, rebuild, restart, and check stderr. If you don't see the marker, the old binary is still running.

On Windows:
```
cmd.exe /c "taskkill /F /IM node.exe" 2>nul
npm run build
node --env-file=.env dist/src/index.js
```

This is a single atomic sequence. Do not split it across multiple tool calls. Do not background it. Do not let 10 seconds pass between kill and start.

**Test:** After restart, the build marker appears in stderr within 2 seconds.

### 4. Read the error before hypothesizing

When a request fails:
1. Read the HTTP response body (not just the status code)
2. Read the server's stderr output for that request
3. Read any debug log files that were written

Do all three before forming a hypothesis. If you skip this and guess, you will guess wrong 80% of the time. The error message is almost always sufficient to identify the problem.

**Anti-pattern:** "The 500 might be because..." followed by a code change, without ever reading what the 500 said.

### 5. One variable at a time

When multiple things could be wrong, change one thing and test. Do not:
- Add `isMayhemMode` AND change the amount AND switch the endpoint in the same edit
- Fix the session store AND add encryption AND change the TTL in the same commit
- Edit source AND restart the server AND create a new session AND ask the user to approve in rapid succession without checking each step

**Test:** Can you state exactly which single variable you changed and predict what the test result will be?

### 6. Server state survives you; you don't survive the server

Express servers, session files, WebSocket connections, and in-memory Maps all persist between your tool calls. But they don't persist between process restarts. Know which is which.

If you store something in a `Map<string, Uint8Array>` and then restart the server to apply a code change, that Map is empty. The session JSON on disk still references the old session ID. The browser tab still has the old signing URL. All three are now out of sync.

**Rule:** If your architecture has in-memory state that must survive restarts, it doesn't work yet. Use disk or accept the constraint.

### 7. Don't fight the user's observations

When the human says "the server is stale" or "that error string doesn't exist in the source," they're giving you ground truth. They can see things you can't (browser network tab, terminal output, the actual running process). Treat their observations as facts, not hypotheses.

**Anti-pattern:** User says "this is a stale binary." Claude Code responds by editing the source again instead of killing the process.

### 8. Windows process management

On Windows under Git Bash or MSYS2:
- `taskkill /f /im node.exe` doesn't work in bash. Use `cmd.exe /c "taskkill /F /IM node.exe"`
- `lsof` doesn't exist. Use `netstat -ano | findstr :3142` to find the PID, then `taskkill /F /PID <pid>`
- Background tasks (`&`) in bash don't always clean up. Prefer foreground processes where you can see the output
- `2>&1` redirection works differently. Use `2>&1 | tee debug.txt` to capture stderr while still seeing it

### 9. CSP is part of the deployment surface

When the application serves HTML pages that make fetch/WebSocket calls, the Content-Security-Policy must match every domain the page will contact. When you change an RPC URL or add a new API endpoint, update the CSP in the HTML files. This is not optional and not a "we'll fix it later" item — the browser will silently block the request and the error will look like a network failure.

**Checklist for every RPC/API change:**
- [ ] Updated `.env` or constants
- [ ] Updated CSP `connect-src` in all HTML files (both `https://` and `wss://` if WebSocket)
- [ ] Rebuilt and verified

### 10. Log what you send, not just what you receive

Every outbound API call should log its request body at debug level. When an external API returns a 400 with no detail, the only way to debug is to see exactly what you sent. Add `console.error("[functionName] request:", JSON.stringify(body))` before every `fetch` to an external service. Remove it later if you want. But during development, always log outbound payloads.

---

## How to use this document

Add it as `CLAUDE.md` in the project root or include it in the Claude Code system prompt. These rules should override default behavior when they conflict. The goal is not to slow Claude Code down — it's to prevent 3-hour loops that could have been 10-minute fixes.

---

## Summary

The pipeline works. The code was correct hours before it shipped. The time was lost to process management, stale binaries, and debugging through the full stack instead of isolating variables. Every rule above exists because we violated it tonight and paid for it in wall clock time.
