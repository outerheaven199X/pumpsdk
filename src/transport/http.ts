/** HTTP transport — streamable HTTP for remote connections and monitoring. */

import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "../index.js";

const DEFAULT_PORT = 3000;
const MAX_REQUESTS_PER_HOUR = 1000;

/** Simple per-IP rate limiter. */
const requestCounts = new Map<string, { count: number; resetAt: number }>();

/**
 * Rate limit middleware: 1000 requests per hour per IP.
 */
function rateLimiter(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 3600_000 });
    next();
    return;
  }

  entry.count++;
  if (entry.count > MAX_REQUESTS_PER_HOUR) {
    res.status(429).json({ error: "Rate limit exceeded. Max 1000 requests per hour." });
    return;
  }
  next();
}

/**
 * Optional bearer token auth middleware.
 */
function bearerAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const token = process.env.MCP_HTTP_TOKEN;
  if (!token) {
    next();
    return;
  }

  const auth = req.headers.authorization;
  if (auth !== `Bearer ${token}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

/**
 * Start the MCP server on HTTP transport.
 * @param port - Port to listen on (default: 3000, or --port=N).
 */
export async function startHttp(port?: number): Promise<void> {
  const listenPort = port ?? DEFAULT_PORT;
  const app = express();

  app.use(rateLimiter);
  app.use(bearerAuth);

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "pumpfun-mcp", transport: "http" });
  });

  const mcpServer = createServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  app.post("/mcp", async (req, res) => {
    await transport.handleRequest(req, res, req.body);
  });

  await mcpServer.connect(transport);

  app.listen(listenPort, () => {
    console.error(`[pumpfun-mcp] HTTP transport at http://localhost:${listenPort}`);
    console.error(`[pumpfun-mcp] MCP endpoint: POST /mcp`);
    console.error(`[pumpfun-mcp] Health check: GET /health`);
  });
}
