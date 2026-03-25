/** pump_compose_fee_config — Build and validate a fee split configuration. */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { mcpError } from "../../utils/errors.js";
import { FeeConfigBuilder } from "../../composer/fee-config.js";
import { WALLET_PLACEHOLDER } from "../../utils/constants.js";

const BPS_PER_PERCENT = 100;

const inputSchema = {
  template: z
    .enum(["solo", "team", "creator_plus_split"])
    .optional()
    .describe("Preset template: 'solo' (100% deployer), 'team' (even split), 'creator_plus_split' (creator + others)"),
  creatorPercent: z
    .number()
    .optional()
    .describe("Creator percentage when using 'creator_plus_split' template (default: 50)"),
  recipients: z
    .array(
      z.object({
        address: z.string().describe("Wallet address or 'self' for deployer"),
        percent: z.number().describe("Fee percentage (1-100)"),
      }),
    )
    .optional()
    .describe("Custom recipient list. Used when no template is specified."),
};

/**
 * Register the pump_compose_fee_config tool on the given MCP server.
 * @param server - The McpServer instance to register on.
 */
export function registerComposeFeeConfig(server: McpServer) {
  server.tool(
    "pump_compose_fee_config",
    "Build and validate a fee split configuration. Returns claimers and BPS arrays ready for token launch. Supports preset templates or custom recipient lists.",
    inputSchema,
    async ({ template, creatorPercent, recipients }) => {
      try {
        let builder: FeeConfigBuilder;

        if (template === "solo") {
          builder = FeeConfigBuilder.soloCreator();
        } else if (template === "team") {
          if (!recipients || recipients.length === 0) {
            return mcpError(new Error("Team template requires at least one recipient in the recipients array."));
          }
          const addresses = recipients.map((r) => (r.address === "self" ? WALLET_PLACEHOLDER : r.address));
          builder = FeeConfigBuilder.teamSplit(addresses);
        } else if (template === "creator_plus_split") {
          if (!recipients || recipients.length === 0) {
            return mcpError(new Error("Creator+split template requires other recipients."));
          }
          const bps = (creatorPercent ?? 50) * BPS_PER_PERCENT;
          const others = recipients.map((r) => (r.address === "self" ? WALLET_PLACEHOLDER : r.address));
          builder = FeeConfigBuilder.creatorPlusSplit(bps, others);
        } else {
          builder = FeeConfigBuilder.create();
          if (!recipients || recipients.length === 0) {
            builder = FeeConfigBuilder.soloCreator();
          } else {
            for (const r of recipients) {
              const addr = r.address === "self" ? WALLET_PLACEHOLDER : r.address;
              builder.addRecipient(addr, r.percent * BPS_PER_PERCENT);
            }
          }
        }

        const validation = builder.validate();
        if (!validation.valid) {
          return mcpError(new Error(`Fee config validation failed: ${validation.errors.join(", ")}`));
        }

        const config = builder.build();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  claimersArray: config.claimersArray,
                  basisPointsArray: config.basisPointsArray,
                  recipientCount: config.claimersArray.length,
                  valid: true,
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
