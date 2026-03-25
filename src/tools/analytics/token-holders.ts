/** pump_token_holders — Fetch holder distribution for a Pump.fun token. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { cache, CACHE_TTL } from "../../client/cache.js";
import { truncateAddress } from "../../utils/formatting.js";

interface HolderInfo {
  address: string;
  displayAddress: string;
  amount: string;
  decimals: number;
  uiAmount: number;
}

const inputSchema = {
  mint: z.string().describe("Base58 token mint address"),
  limit: z.number().optional().describe("Max holders to return (default: 20, max: 50)"),
};

/**
 * Register the pump_token_holders tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerTokenHolders(server: McpServer) {
  server.tool(
    "pump_token_holders",
    "Fetch the top holders of a Pump.fun token. Shows wallet addresses and balances sorted by largest holdings.",
    inputSchema,
    async ({ mint, limit }) => {
      try {
        requireValidAddress(mint, "mint");
        const maxResults = Math.min(limit ?? 20, 50);
        const cacheKey = `holders:${mint}:${maxResults}`;

        const cached = cache.get<unknown>(cacheKey);
        if (cached) {
          return { content: [{ type: "text" as const, text: JSON.stringify(cached, null, 2) }] };
        }

        const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenLargestAccounts",
            params: [mint],
          }),
        });

        const data = (await res.json()) as {
          result?: { value: Array<{ address: string; amount: string; decimals: number; uiAmount: number }> };
          error?: { message: string };
        };
        if (data.error) throw new Error(data.error.message);

        const holders: HolderInfo[] = (data.result?.value ?? []).slice(0, maxResults).map((h) => ({
          address: h.address,
          displayAddress: truncateAddress(h.address),
          amount: h.amount,
          decimals: h.decimals,
          uiAmount: h.uiAmount,
        }));

        const result = { mint, count: holders.length, holders };
        cache.set(cacheKey, result, CACHE_TTL.moderate);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
