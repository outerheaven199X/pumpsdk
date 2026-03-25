/** pump_token_holdings — List all SPL token holdings for a Solana wallet. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";

const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

interface TokenAccount {
  mint: string;
  amount: string;
  decimals: number;
}

const inputSchema = {
  wallet: z.string().describe("Base58 Solana wallet address"),
};

/**
 * Register the pump_token_holdings tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerTokenHoldings(server: McpServer) {
  server.tool(
    "pump_token_holdings",
    "List all SPL token holdings for a Solana wallet. Returns mint addresses and balances.",
    inputSchema,
    async ({ wallet }) => {
      try {
        requireValidAddress(wallet, "wallet");

        const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "getTokenAccountsByOwner",
            params: [wallet, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }],
          }),
        });

        const data = (await res.json()) as {
          result?: {
            value: Array<{
              account: {
                data: { parsed: { info: { mint: string; tokenAmount: { amount: string; decimals: number } } } };
              };
            }>;
          };
          error?: { message: string };
        };
        if (data.error) throw new Error(data.error.message);

        const holdings: TokenAccount[] = (data.result?.value ?? [])
          .map((acct) => {
            const info = acct.account.data.parsed.info;
            return {
              mint: info.mint,
              amount: info.tokenAmount.amount,
              decimals: info.tokenAmount.decimals,
            };
          })
          .filter((h) => h.amount !== "0");

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ wallet, count: holdings.length, holdings }, null, 2),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
