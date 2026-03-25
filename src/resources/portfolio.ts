/** pump://portfolio/{wallet} — Wallet holdings and SOL balance. */

import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { cache, CACHE_TTL } from "../client/cache.js";
import { lamportsToSol, formatSol } from "../utils/formatting.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

/**
 * Register the pump://portfolio/{wallet} resource template on the given MCP server.
 * @param server - The McpServer instance.
 */
export function registerPortfolioResource(server: McpServer): void {
  server.resource(
    "portfolio",
    new ResourceTemplate("pump://portfolio/{wallet}", { list: undefined }),
    { description: "Wallet SOL balance and all SPL token holdings", mimeType: "application/json" },
    async (uri, params) => {
      const wallet = String(params.wallet);
      const cacheKey = `resource:portfolio:${wallet}`;
      const cached = cache.get<string>(cacheKey);
      if (cached) return { contents: [{ uri: uri.href, text: cached, mimeType: "application/json" }] };

      const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

      const [balRes, tokenRes] = await Promise.all([
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [wallet] }),
        }),
        fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "getTokenAccountsByOwner",
            params: [wallet, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }],
          }),
        }),
      ]);

      const balData = (await balRes.json()) as { result?: { value: number } };
      const tokenData = (await tokenRes.json()) as {
        result?: {
          value: Array<{
            account: {
              data: {
                parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number; uiAmount: number } } };
              };
            };
          }>;
        };
      };

      const sol = lamportsToSol(balData.result?.value ?? 0);
      const holdings = (tokenData.result?.value ?? [])
        .map((a) => {
          const info = a.account.data.parsed.info;
          return { mint: info.mint, amount: info.tokenAmount.amount, uiAmount: info.tokenAmount.uiAmount };
        })
        .filter((h) => h.amount !== "0");

      const data = {
        wallet,
        solBalance: formatSol(sol),
        tokenCount: holdings.length,
        holdings,
      };

      const text = JSON.stringify(data, null, 2);
      cache.set(cacheKey, text, CACHE_TTL.volatile);
      return { contents: [{ uri: uri.href, text, mimeType: "application/json" }] };
    },
  );
}
