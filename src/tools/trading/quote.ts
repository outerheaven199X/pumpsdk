/** pump_quote — Estimate buy/sell output using on-chain bonding curve reserves. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { pumpGet } from "../../client/pump-rest.js";
import { mcpError } from "../../utils/errors.js";
import { requireValidAddress } from "../../utils/validation.js";
import { LAMPORTS_PER_SOL } from "../../utils/constants.js";

const TOKEN_DECIMALS = 6;
const SOL_MINT = "So11111111111111111111111111111111111111112";

interface CoinData {
  mint: string;
  virtual_sol_reserves: number;
  virtual_token_reserves: number;
  complete: boolean;
  raydium_pool: string | null;
}

const inputSchema = {
  quote_type: z.enum(["buy", "sell"]).describe("Quote direction: buy (SOL→token) or sell (token→SOL)"),
  mint: z.string().describe("Base58 token mint address"),
  amount: z.number().describe("Amount in lamports"),
  slippage: z.number().optional().describe("Slippage tolerance as integer percentage (default: 10)"),
};

/**
 * Calculate output from constant-product bonding curve (x * y = k).
 * @param inputAmount - Input amount in lamports.
 * @param inputReserve - Reserve of input token.
 * @param outputReserve - Reserve of output token.
 * @returns Estimated output amount.
 */
function calcOutput(inputAmount: number, inputReserve: number, outputReserve: number): number {
  if (inputReserve <= 0 || outputReserve <= 0) return 0;
  const numerator = inputAmount * outputReserve;
  const denominator = inputReserve + inputAmount;
  return Math.floor(numerator / denominator);
}

/**
 * Register the pump_quote tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerQuote(server: McpServer) {
  server.tool(
    "pump_quote",
    "Get a buy or sell quote for a Pump.fun token. Returns estimated output amount for a given input.",
    inputSchema,
    async ({ quote_type, mint, amount, slippage }) => {
      try {
        requireValidAddress(mint, "mint");

        const coin = await pumpGet<CoinData>(`/coins/${mint}`);

        if (coin.complete && coin.raydium_pool) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    error: "Token has graduated to Raydium. Use a DEX aggregator for quotes.",
                    raydiumPool: coin.raydium_pool,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        const solReserves = coin.virtual_sol_reserves;
        const tokenReserves = coin.virtual_token_reserves;

        let inputMint: string;
        let outputMint: string;
        let outputAmount: number;

        if (quote_type === "buy") {
          inputMint = SOL_MINT;
          outputMint = mint;
          outputAmount = calcOutput(amount, solReserves, tokenReserves);
        } else {
          inputMint = mint;
          outputMint = SOL_MINT;
          outputAmount = calcOutput(amount, tokenReserves, solReserves);
        }

        const slippagePct = slippage ?? 10;
        const minOutput = Math.floor(outputAmount * (1 - slippagePct / 100));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  quoteType: quote_type,
                  inputMint,
                  outputMint,
                  inputAmount: amount,
                  outputAmount,
                  minimumOutput: minOutput,
                  slippagePct,
                  solAmount: (quote_type === "buy" ? amount : outputAmount) / LAMPORTS_PER_SOL,
                  tokenAmount: (quote_type === "buy" ? outputAmount : amount) / 10 ** TOKEN_DECIMALS,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return mcpError(error);
      }
    },
  );
}
